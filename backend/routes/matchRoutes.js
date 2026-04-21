const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Initialize Backend Supabase Controller
const supabase = createClient(
    "https://bzrxpejjfzlecpugylqx.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6cnhwZWpqZnpsZWNwdWd5bHF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTkxNjksImV4cCI6MjA4NDgzNTE2OX0.tS3GgxA5L969XGQK9Uw4qxTcqco1Y2iytoKcfos0DNU"
);

function calculateDistanceKM(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;

    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

router.post('/', async (req, res) => {
    try {
        const { request_id } = req.body;
        if (!request_id) return res.status(400).json({ error: "Missing request_id payload" });

        // 9. AUTHENTICATION SECURE SOURCING
        const authHeader = req.headers['authorization'] || req.headers['Authorization'];
        if (!authHeader) return res.status(401).json({ error: "Unauthorized access intent." });
        const token = authHeader.replace("Bearer ", "");
        const { data: authData, error: authErr } = await supabase.auth.getUser(token);
        if (authErr || !authData?.user) return res.status(401).json({ error: "Integrity fault: Invalid session token" });

        const authed_hospital_id = authData.user.id;

        // **CRITICAL FIX**: Generate a scoped Supabase client specifically leveraging this user's JWT 
        // to bypass RLS violations natively when performing bulk inserts in the backend!
        const userSupabase = createClient(
            "https://bzrxpejjfzlecpugylqx.supabase.co",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6cnhwZWpqZnpsZWNwdWd5bHF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTkxNjksImV4cCI6MjA4NDgzNTE2OX0.tS3GgxA5L969XGQK9Uw4qxTcqco1Y2iytoKcfos0DNU",
            { global: { headers: { Authorization: `Bearer ${token}` } } }
        );

        // Extract Request Parameters
        const { data: v_req, error: reqErr } = await userSupabase
            .from('blood_requests')
            .select('*')
            .eq('id', request_id)
            .single();

        if (reqErr || !v_req) return res.status(400).json({ error: "Request identity tracking fault." });

        // Secure validation wrapper
        if (v_req.hospital_id !== authed_hospital_id) {
            return res.status(403).json({ error: "Forbidden cross-hospital matching triggers halted." });
        }

        if (['FULFILLED', 'TIMEOUT', 'CANCELLED'].includes(v_req.status)) return res.json({ status: "Already resolved." });

        const { data: activeAllocs } = await userSupabase
            .from('request_allocations')
            .select('units_allocated')
            .eq('request_id', request_id)
            .in('status', ['PENDING', 'ACCEPTED']);

        let v_allocated_total = activeAllocs ? activeAllocs.reduce((sum, val) => sum + val.units_allocated, 0) : 0;
        let v_remaining_units = v_req.units_required - v_allocated_total;

        if (v_remaining_units <= 0) {
            await userSupabase.from('blood_requests').update({ status: 'FULFILLED' }).eq('id', request_id);
            return res.json({ status: "Fulfilled" });
        }

        const { data: senderHosp } = await userSupabase
            .from('hospitals')
            .select('latitude, longitude')
            .eq('id', authed_hospital_id)
            .single();

        const req_lat = senderHosp?.latitude || 0;
        const req_lon = senderHosp?.longitude || 0;

        // 1. DATA FETCH OPTIMIZATION
        const validGroups = new Set([v_req.blood_group]);
        if (v_req.priority_level === 'Emergency') validGroups.add('O-');
        if (v_req.blood_group.includes('+')) validGroups.add(v_req.blood_group.replace('+', '-'));

        const { data: inventoryData, error: invErr } = await userSupabase
            .from('inventory_batches')
            .select(`
                id, hospital_id, blood_group, units, reserved_units, expiry_date,
                hospitals ( latitude, longitude, min_reserve_units )
            `)
            .in('blood_group', Array.from(validGroups))
            .neq('hospital_id', v_req.hospital_id)
            .eq('is_recalled', false);

        if (invErr || !inventoryData) throw new Error("Inventory database mapping failed.");

        // 2 & 3. HOSPITAL-LEVEL AGGREGATION & UNIT COMPUTATIONS
        const hospitalMap = new Map();

        inventoryData.forEach(ib => {
            if (!ib.expiry_date || new Date(ib.expiry_date) < new Date()) return;

            if (!hospitalMap.has(ib.hospital_id)) {
                hospitalMap.set(ib.hospital_id, {
                    hospital_id: ib.hospital_id,
                    lat: ib.hospitals?.latitude || 0,
                    lon: ib.hospitals?.longitude || 0,
                    min_reserve: ib.hospitals?.min_reserve_units || 0,
                    total_units: 0,
                    total_reserved: 0,
                    batches: []
                });
            }

            const h = hospitalMap.get(ib.hospital_id);
            h.total_units += ib.units;
            h.total_reserved += (ib.reserved_units || 0);
            h.batches.push(ib);
        });

        const sortedCandidates = [];
        hospitalMap.forEach(h => {
            const available = h.total_units - h.total_reserved - h.min_reserve;
            if (available > 0) {
                h.available_units = available;
                h.distance = calculateDistanceKM(req_lat, req_lon, h.lat, h.lon);
                sortedCandidates.push(h);
            }
        });

        // 5. RANKING SORT MECHANISMS
        sortedCandidates.sort((a, b) => {
            if (a.distance !== b.distance) return a.distance - b.distance;
            return b.available_units - a.available_units;
        });

        // 6. TOP 10 ISOLATION
        const top10 = sortedCandidates.slice(0, 10);

        // 7. CORRECT ALLOCATION DISTRIBUTION ACROSS BATCHES
        const insertions = [];

        for (const candidate of top10) {
            if (v_remaining_units <= 0) break;

            let hospital_takes_total = Math.min(candidate.available_units, v_remaining_units);

            for (const batch of candidate.batches) {
                if (hospital_takes_total <= 0) break;

                const batch_supply_capable = batch.units - (batch.reserved_units || 0);
                if (batch_supply_capable <= 0) continue;

                const take_from_batch = Math.min(batch_supply_capable, hospital_takes_total);
                if (take_from_batch <= 0) continue;

                insertions.push({
                    request_id: request_id,
                    supplier_id: candidate.hospital_id,
                    batch_id: batch.id,
                    units_allocated: take_from_batch,
                    status: 'PENDING'
                });

                hospital_takes_total -= take_from_batch;
                v_remaining_units -= take_from_batch;
                v_allocated_total += take_from_batch;
            }
        }

        let newAllocs = [];

        // 8. TRANSACTION SAFETY: INJECT BULK LOGICAL SEQUENCE
        if (insertions.length > 0) {
            const { data: dbAllocs, error: allocErr } = await userSupabase
                .from('request_allocations')
                .insert(insertions)
                .select();
            if (allocErr) throw new Error("Bulk transactional allocation array crash: " + JSON.stringify(allocErr));
            newAllocs = dbAllocs;
        }

        if (v_remaining_units <= 0) {
            await userSupabase.from('blood_requests').update({ status: 'FULFILLED' }).eq('id', request_id);
        } else if (v_allocated_total > 0) {
            await userSupabase.from('blood_requests').update({ status: 'PARTIAL' }).eq('id', request_id);
        }

        res.json({
            request_id,
            allocated: v_allocated_total,
            remaining: v_remaining_units,
            insertions: newAllocs.length
        });

    } catch (err) {
        console.error("Match Engine Node Trace Error:", err.message);
        res.status(500).json({ error: "Backend Node Execute Crash: " + err.message });
    }
});

module.exports = router;
