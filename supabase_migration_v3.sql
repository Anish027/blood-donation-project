-- ============================================================
-- Blood Buddy: Backend Intelligent Coordination Architecture 
-- ============================================================

-- 1. Create Batched Inventory Table
CREATE TABLE IF NOT EXISTS inventory_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    hospital_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
    blood_group TEXT NOT NULL,
    units INTEGER NOT NULL CHECK (units >= 0),
    expiry_date DATE NOT NULL,
    is_recalled BOOLEAN DEFAULT false,
    min_reserve INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add geo-coordinates to hospitals if not exists
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS latitude NUMERIC DEFAULT (19.0760 + (random() * 0.1 - 0.05));
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS longitude NUMERIC DEFAULT (72.8777 + (random() * 0.1 - 0.05));

-- 2. Modify Transfer and Request schemas
ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMP WITH TIME ZONE;
ALTER TABLE blood_requests ADD COLUMN IF NOT EXISTS search_radius INTEGER DEFAULT 40;

CREATE TABLE IF NOT EXISTS request_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID REFERENCES blood_requests(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES hospitals(id) ON DELETE CASCADE,
    blood_group TEXT NOT NULL,
    units_allocated INTEGER NOT NULL,
    status TEXT DEFAULT 'PENDING'
);

ALTER TABLE blood_transfers ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES inventory_batches(id) ON DELETE SET NULL;
ALTER TABLE blood_transfers ADD COLUMN IF NOT EXISTS request_id UUID REFERENCES blood_requests(id) ON DELETE CASCADE;
ALTER TABLE blood_transfers ADD COLUMN IF NOT EXISTS allocation_id UUID REFERENCES request_allocations(id) ON DELETE SET NULL;

-- Helper to calculate distance in km between two lat/long
CREATE OR REPLACE FUNCTION calc_distance_km(lat1 NUMERIC, lon1 NUMERIC, lat2 NUMERIC, lon2 NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
    R NUMERIC := 6371; -- Earth radius in km
    dLat NUMERIC;
    dLon NUMERIC;
    a NUMERIC;
    c NUMERIC;
BEGIN
    IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
       RETURN 9999;
    END IF;
    dLat := radians(lat2 - lat1);
    dLon := radians(lon2 - lon1);
    a := sin(dLat/2) * sin(dLat/2) +
         cos(radians(lat1)) * cos(radians(lat2)) *
         sin(dLon/2) * sin(dLon/2);
    c := 2 * atan2(sqrt(a), sqrt(1-a));
    RETURN R * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Drop old function format if it exists with different name
DROP FUNCTION IF EXISTS public.rpc_match_and_allocate_blood(UUID);

-- 4. Core RPC Engine (EXACT SIGNATURE REQUIRED: req_id UUID)
CREATE OR REPLACE FUNCTION public.rpc_match_and_allocate_blood(req_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $function$
DECLARE
    v_req RECORD;
    v_remaining_units INTEGER;
    v_allocated_total INTEGER := 0;
    v_batch RECORD;
    v_allocation_id UUID;
    v_results JSONB := '[]'::JSONB;
    v_current_radius INTEGER;
    v_sender_lat NUMERIC;
    v_sender_lon NUMERIC;
BEGIN
    -- 1. Load the request context using req_id
    SELECT * INTO v_req FROM blood_requests WHERE id = req_id FOR UPDATE;
    
    IF v_req IS NULL OR v_req.status IN ('FULFILLED', 'TIMEOUT', 'CANCELLED') THEN
        RETURN jsonb_build_object('error', 'Request not viable for engine matching.');
    END IF;

    -- Look up existing allocations
    SELECT COALESCE(SUM(units_allocated), 0) INTO v_allocated_total FROM request_allocations WHERE request_id = req_id AND status != 'EXPIRED';
    v_remaining_units := v_req.units_required - v_allocated_total;

    IF v_remaining_units <= 0 THEN
        UPDATE blood_requests SET status = 'FULFILLED' WHERE id = req_id;
        RETURN jsonb_build_object('status', 'Already Fulfilled');
    END IF;

    -- Get sender location
    SELECT latitude, longitude INTO v_sender_lat, v_sender_lon FROM hospitals WHERE id = v_req.hospital_id;
    v_current_radius := COALESCE(v_req.search_radius, 40);

    -- Progressive Radius Expansion (Desert Scenario Engine)
    WHILE v_current_radius <= 120 AND v_remaining_units > 0 LOOP
        FOR v_batch IN 
            SELECT ib.id, ib.hospital_id, ib.units, ib.min_reserve, ib.blood_group, h.latitude, h.longitude,
                   CASE 
                     WHEN ib.blood_group = v_req.blood_group THEN 1
                     WHEN ib.blood_group = 'O-' THEN 3
                     ELSE 2 
                   END as match_type,
                   calc_distance_km(v_sender_lat, v_sender_lon, h.latitude, h.longitude) as dist
            FROM inventory_batches ib
            JOIN hospitals h ON ib.hospital_id = h.id
            WHERE ib.hospital_id != v_req.hospital_id
              AND ib.is_recalled = false
              AND ib.expiry_date >= CURRENT_DATE
              AND (ib.units - ib.min_reserve) > 0
              AND (
                   ib.blood_group = v_req.blood_group 
                   OR (v_req.priority_level = 'Emergency' AND ib.blood_group = 'O-') 
                   OR (v_req.blood_group LIKE '%+' AND ib.blood_group = REPLACE(v_req.blood_group, '+', '-'))
              )
              AND calc_distance_km(v_sender_lat, v_sender_lon, h.latitude, h.longitude) <= v_current_radius
            ORDER BY match_type ASC, dist ASC, ib.expiry_date ASC
            FOR UPDATE SKIP LOCKED
        LOOP
            IF v_remaining_units <= 0 THEN
                EXIT;
            END IF;

            DECLARE
                v_take INTEGER;
                v_available INTEGER := v_batch.units - v_batch.min_reserve;
            BEGIN
                IF v_available > v_remaining_units THEN
                    v_take := v_remaining_units;
                ELSE
                    v_take := v_available;
                END IF;

                -- Insert pure match mapping logic
                INSERT INTO request_allocations (request_id, supplier_id, blood_group, units_allocated, status)
                VALUES (req_id, v_batch.hospital_id, v_batch.blood_group, v_take, 'PENDING')
                RETURNING id INTO v_allocation_id;

                v_results := v_results || jsonb_build_object(
                    'allocation_id', v_allocation_id,
                    'supplier_id', v_batch.hospital_id,
                    'blood_group', v_batch.blood_group,
                    'units_allocated', v_take,
                    'match_type', v_batch.match_type,
                    'distance_km', round(v_batch.dist::numeric, 2)
                );

                v_remaining_units := v_remaining_units - v_take;
                v_allocated_total := v_allocated_total + v_take;
            END;
        END LOOP;

        IF v_remaining_units > 0 THEN
            v_current_radius := v_current_radius + 40;
            UPDATE blood_requests SET search_radius = v_current_radius WHERE id = req_id;
        ELSE
            EXIT;
        END IF;
    END LOOP;
    
    -- Mark request status
    IF v_remaining_units <= 0 THEN
       UPDATE blood_requests SET status = 'FULFILLED' WHERE id = req_id;
    ELSIF v_allocated_total > 0 THEN
       UPDATE blood_requests SET status = 'PARTIAL' WHERE id = req_id;
    END IF;

    RETURN jsonb_build_object(
        'request_id', req_id,
        'requested', v_req.units_required,
        'allocated', v_allocated_total,
        'remaining', v_remaining_units,
        'allocations', v_results
    );
END;
$function$;

-- REFRESH SCHEMA CACHE FOR POSTGREST (CRITICAL FOR UI TO SEE FUNCTION)
NOTIFY pgrst, 'reload schema';
