import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// Supabase Connection
const SUPABASE_URL = "https://bzrxpejjfzlecpugylqx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6cnhwZWpqZnpsZWNwdWd5bHF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTkxNjksImV4cCI6MjA4NDgzNTE2OX0.tS3GgxA5L969XGQK9Uw4qxTcqco1Y2iytoKcfos0DNU";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

document.addEventListener('DOMContentLoaded', async () => {
    if (localStorage.getItem('bb_admin_auth') !== 'true') {
        window.location.href = 'admin-login.html';
        return;
    }
    console.log("Admin Dashboard initializing...");
    try {
        await loadPendingApprovals();
    } catch (e) {
        console.error("loadPendingApprovals failed:", e);
    }

    try {
        await loadHospitals();
    } catch (e) {
        console.error("loadHospitals failed:", e);
    }

    try {
        await loadTransfers();
    } catch (e) {
        console.error("loadTransfers failed:", e);
    }

    try {
        await loadAuditLogs();
    } catch (e) {
        console.error("loadAuditLogs failed:", e);
    }
});

// ============================================================
// PENDING HOSPITAL APPROVALS (verified = false)
// ============================================================
async function loadPendingApprovals() {
    const container = document.getElementById('pending-list');
    const countEl = document.getElementById('pending-count');

    if (!container) {
        console.warn("pending-list not found");
        return;
    }

    const { data: pending, error } = await supabase
        .from('hospitals')
        .select('*')
        .not('verified', 'eq', true);

    console.log("FETCH RESULT:", pending);
    console.log("ERROR:", error);

    if (error) {
        container.innerHTML = `<p style="color: #ef4444;">Error loading data</p>`;
        return;
    }

    if (!pending) {
        console.warn("No pending hospitals data");
        if (countEl) countEl.textContent = 0;
        container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 1rem;">No records found</p>`;
        return;
    }

    if (countEl) countEl.textContent = pending.length;

    if (pending.length === 0) {
        container.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 1rem;">No records found</p>`;
        return;
    }

    container.innerHTML = '';
    pending.forEach(h => {
        const card = document.createElement('div');
        card.style.cssText = 'background: var(--bg-main); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem;';

        const safeName = (h.name || 'Unknown Hospital').replace(/'/g, "\\'");

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--border-color);">
                <h3 style="margin: 0; color: var(--text-main); font-size: 1.4rem; font-weight: 700;">🏥 ${h.name || 'Unknown Hospital'}</h3>
                <span class="badge pending" style="font-size: 0.8rem;">Pending Review</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 2rem; margin-bottom: 1rem;">
                <div class="detail-row">
                    <span class="label">Email:</span>
                    <span class="value">${h.email || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="label">City:</span>
                    <span class="value">${h.city || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Address:</span>
                    <span class="value">${h.address || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Contact:</span>
                    <span class="value">${h.contact_number || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="label">Type:</span>
                    <span class="value">${h.type || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="label">License #:</span>
                    <span class="value" style="font-family: monospace;">${h.license_number || 'N/A'}</span>
                </div>
            </div>

            <div style="background: ${h.license_file_url ? 'rgba(79, 70, 229, 0.06)' : 'rgba(239, 68, 68, 0.05)'}; border: 1px solid ${h.license_file_url ? 'rgba(79, 70, 229, 0.2)' : 'rgba(239, 68, 68, 0.15)'}; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <div style="font-weight: 600; color: var(--text-main); font-size: 0.95rem;">📄 License Document</div>
                    <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 2px;">${h.license_file_url ? 'PDF uploaded — click to review' : '⚠️ No license document was uploaded'}</div>
                </div>
                ${h.license_file_url
                ? '<button class="action-btn view-license" onclick="viewLicense(\'' + h.license_file_url + '\')" style="padding: 0.6rem 1.2rem; font-size: 0.95rem;">Open PDF ↗</button>'
                : '<span style="color: #dc2626; font-weight: 600; font-size: 0.85rem;">Missing</span>'}
            </div>

            <div style="display: flex; gap: 0.75rem;">
                <button class="action-btn approve" onclick="approveHospital('${h.id}', '${safeName}')" style="flex: 1; padding: 0.6rem; font-size: 0.95rem;">✅ Approve</button>
                <button class="action-btn reject" onclick="rejectHospital('${h.id}', '${safeName}')" style="flex: 1; padding: 0.6rem; font-size: 0.95rem;">❌ Reject</button>
            </div>
        `;
        container.appendChild(card);
    });
}

window.viewLicense = async function (filePath) {
    const btn = event.target;
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Loading...';
    btn.disabled = true;

    console.log("Generating signed URL for exact path:", filePath);

    // Generate signed URL from Supabase Storage
    const { data, error } = await supabase.storage
        .from('hospital-licenses')
        .createSignedUrl(filePath, 60 * 60); // 1 hour expiry

    btn.innerHTML = originalText;
    btn.disabled = false;

    if (error) {
        alert('Failed to view license: ' + error.message);
        return;
    }

    window.open(data.signedUrl, '_blank');
};

// APPROVE HOSPITAL — sets verified = true
window.approveHospital = async function (hospitalId, hospitalName) {
    if (!confirm('Approve "' + hospitalName + '" and grant full system access?')) return;

    const { error } = await supabase
        .from('hospitals')
        .update({
            verified: true,
            approved_by: 'Admin',
            approved_at: new Date().toISOString()
        })
        .eq('id', hospitalId);

    if (error) {
        alert('Failed to approve hospital: ' + error.message);
        return;
    }

    await supabase.from('audit_logs').insert({
        hospital_id: hospitalId,
        action_type: 'HOSPITAL_APPROVED',
        description: 'Hospital "' + hospitalName + '" approved by administrator. Full system access granted.'
    });

    alert('✅ "' + hospitalName + '" has been approved!');
    loadPendingApprovals();
    loadHospitals();
    loadAuditLogs();
};

// REJECT HOSPITAL — deletes the hospital application completely
window.rejectHospital = async function (hospitalId, hospitalName) {
    if (!confirm('Reject "' + hospitalName + '"? This will permanently delete their application.')) return;

    // Delete hospital record
    const { error } = await supabase
        .from('hospitals')
        .delete()
        .eq('id', hospitalId);

    if (error) {
        alert('Failed to reject hospital: ' + error.message);
        return;
    }

    // Log the rejection
    await supabase.from('audit_logs').insert({
        hospital_id: hospitalId,
        action_type: 'HOSPITAL_REJECTED',
        description: 'Hospital "' + hospitalName + '" rejected by administrator. Record deleted.'
    });

    alert('Hospital rejected successfully');

    // Refresh pending requests
    loadPendingApprovals();
    loadAuditLogs();
};


// ============================================================
// REGISTERED HOSPITALS (all)
// ============================================================
async function loadHospitals() {
    const tbody = document.getElementById('hospitals-body');
    const countEl = document.getElementById('hospital-count');
    
    if (!tbody) {
        console.warn("hospitals-body not found");
        return;
    }

    const { data: hospitals, error } = await supabase.from('hospitals').select('*');
    console.log("FETCH RESULT:", hospitals);
    console.log("ERROR:", error);

    window.hospitalsMap = {};
    if (error) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#ef4444;">Error loading data</td></tr>';
        return;
    }

    if (!hospitals) {
        console.warn("No hospitals data");
        if (countEl) countEl.textContent = 0;
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No records found</td></tr>';
        return;
    }

    hospitals.forEach(h => { window.hospitalsMap[h.id] = h.name; });

    if (countEl) countEl.textContent = hospitals.length;
    if (hospitals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No records found</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    hospitals.forEach(h => {
        const isVerified = h.verified === true;
        const statusLabel = isVerified ? 'Approved' : 'Pending';
        const statusClass = isVerified ? 'approved' : 'pending';

        tbody.innerHTML += `
            <tr>
                <td><span style="font-family:monospace; color:var(--text-muted);">${h.id.substring(0, 8)}...</span></td>
                <td style="font-weight:600; color:var(--text-main);">${h.name}</td>
                <td>${h.email || 'N/A'}</td>
                <td>${h.city || 'N/A'}</td>
                <td><span style="font-family:monospace; font-size:0.85rem;">${h.license_number || 'N/A'}</span></td>
                <td><span class="badge completed">${h.type || 'Unknown'}</span></td>
                <td><span class="badge ${statusClass}">${statusLabel}</span></td>
            </tr>
        `;
    });
}

// ============================================================
// BLOOD TRANSFERS
// ============================================================
async function loadTransfers() {
    const tbody = document.getElementById('transfers-body');
    const chatsBody = document.getElementById('chats-body');
    const countEl = document.getElementById('transfer-count');
    const chatCount = document.getElementById('chat-count');
    
    if (!tbody) {
        console.warn("transfers-body not found");
        return;
    }

    const { data: transfers, error } = await supabase.from('blood_transfers').select('*').order('created_at', { ascending: false });
    console.log("FETCH RESULT:", transfers);
    console.log("ERROR:", error);

    if (error) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:#ef4444;">Error loading data</td></tr>';
        if (chatsBody) chatsBody.innerHTML = '<p style="text-align: center; color:#ef4444;">Error loading communications</p>';
        return;
    }

    if (!transfers) {
        console.warn("No transfers data");
        if (countEl) countEl.textContent = 0;
        if (chatCount) chatCount.textContent = 0;
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No records found</td></tr>';
        if (chatsBody) chatsBody.innerHTML = '<p style="text-align: center; color:var(--text-muted);">No records found</p>';
        return;
    }

    if (countEl) countEl.textContent = transfers.length;
    if (chatCount) chatCount.textContent = transfers.length;
    
    if (transfers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No records found</td></tr>';
        if (chatsBody) chatsBody.innerHTML = '<p style="text-align: center; color:var(--text-muted);">No records found</p>';
        return;
    }

    tbody.innerHTML = '';
    if (chatsBody) chatsBody.innerHTML = '';
    transfers.forEach(t => {
        const statusBadge = t.status === 'PENDING' ? 'pending' : (t.status === 'ISSUED' ? 'completed' : 'active');
        const senderName = (window.hospitalsMap && window.hospitalsMap[t.sender_id]) ? window.hospitalsMap[t.sender_id] : (t.sender_id ? t.sender_id.substring(0, 8) : 'Unknown');
        const receiverName = (window.hospitalsMap && window.hospitalsMap[t.receiver_id]) ? window.hospitalsMap[t.receiver_id] : (t.receiver_id ? t.receiver_id.substring(0, 8) : 'Unknown');

        tbody.innerHTML += `
            <tr>
                <td><span style="font-family:monospace; color:var(--text-muted);">${t.id.substring(0, 8)}</span></td>
                <td><strong>${senderName}</strong></td>
                <td><strong>${receiverName}</strong></td>
                <td style="font-weight:700; color:var(--primary);">${t.blood_group}</td>
                <td>${t.units} Units</td>
                <td><span class="badge ${statusBadge}">${t.status}</span></td>
                <td>${new Date(t.created_at).toLocaleString()}</td>
            </tr>
        `;

        if (chatsBody) {
            const chatColor = t.status === 'PENDING' ? '#f59e0b' : (t.status === 'ISSUED' || t.status === 'APPROVED' ? '#10b981' : '#ef4444');
            const icon = t.status === 'PENDING' ? '🚨' : (t.status === 'ISSUED' || t.status === 'APPROVED' ? '✅' : '❌');
            let chatMessage;
            if (t.status === 'PENDING') {
                chatMessage = '<strong>Emergency Request:</strong> ' + senderName + ' requested <b>' + t.units + ' Units</b> of <b>' + t.blood_group + '</b> from ' + receiverName + '.';
            } else if (t.status === 'ISSUED' || t.status === 'APPROVED') {
                chatMessage = '<strong>Approved:</strong> ' + receiverName + ' approved ' + t.units + ' Units of ' + t.blood_group + ' for ' + senderName + '.';
            } else {
                chatMessage = '<strong>Rejected:</strong> ' + receiverName + ' rejected the request from ' + senderName + '.';
            }

            chatsBody.innerHTML += `
                <div style="background: var(--bg-secondary, #ffffff); border-left: 4px solid ${chatColor}; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 5px; border: 1px solid var(--border-color, #eee);">
                    <div style="font-size: 0.85rem; color: var(--text-muted, #64748b); margin-bottom: 5px;">${new Date(t.created_at).toLocaleString()} | Transfer ID: ${t.id.substring(0, 8)}</div>
                    <div style="font-size: 1rem; color: var(--text-main, #0f172a);">${icon} ${chatMessage}</div>
                </div>
            `;
        }
    });
}

// ============================================================
// AUDIT LOGS
// ============================================================
async function loadAuditLogs() {
    const tbody = document.getElementById('audit-body');
    const countEl = document.getElementById('audit-count');
    
    if (!tbody) {
        console.warn("audit-body not found");
        return;
    }

    const { data: logs, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50);
    console.log("FETCH RESULT:", logs);
    console.log("ERROR:", error);

    if (error) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#ef4444;">Error loading data</td></tr>';
        return;
    }

    if (!logs) {
        console.warn("No logs data");
        if (countEl) countEl.textContent = 0;
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No records found</td></tr>';
        return;
    }

    if (countEl) countEl.textContent = logs.length;
    
    if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No records found</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    logs.forEach(l => {
        let actionClass = 'active';
        if (l.action_type.includes('APPROVED')) actionClass = 'approved';
        else if (l.action_type.includes('REJECTED')) actionClass = 'rejected';
        else if (l.action_type.includes('REGISTERED')) actionClass = 'pending';

        tbody.innerHTML += `
            <tr>
                <td><span style="font-family:monospace; color:var(--text-muted);">${l.id.substring(0, 8)}</span></td>
                <td><span style="font-family:monospace;">${l.hospital_id ? l.hospital_id.substring(0, 8) : 'N/A'}</span></td>
                <td><span class="badge ${actionClass}">${l.action_type}</span></td>
                <td>${l.description}</td>
                <td>${new Date(l.created_at).toLocaleString()}</td>
            </tr>
        `;
    });
}

// ============================================================
// LIVE SIMULATOR
// ============================================================
window.simTimer = null;

async function simulateTraffic() {
    const hospitalIds = Object.keys(window.hospitalsMap || {});
    if (hospitalIds.length < 2) return;

    const sender = hospitalIds[Math.floor(Math.random() * hospitalIds.length)];
    let receiver = hospitalIds[Math.floor(Math.random() * hospitalIds.length)];
    while (receiver === sender) {
        receiver = hospitalIds[Math.floor(Math.random() * hospitalIds.length)];
    }

    const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
    const bg = bloodGroups[Math.floor(Math.random() * bloodGroups.length)];
    const units = Math.floor(Math.random() * 8) + 1;
    const rand = Math.random();
    const st = rand > 0.8 ? "ISSUED" : (rand > 0.7 ? "REJECTED" : "PENDING");

    const { error } = await supabase.from("blood_transfers").insert({
        sender_id: sender, receiver_id: receiver, blood_group: bg, units: units, status: st
    });
    if (!error) loadTransfers();
}

window.startSimulation = function () {
    const btn = document.getElementById("sim-btn");
    if (window.simTimer) {
        clearInterval(window.simTimer);
        window.simTimer = null;
        btn.innerHTML = "⚡ Start Live Simulator";
        btn.style.background = "";
        btn.style.color = "var(--primary)";
        btn.style.borderColor = "var(--primary)";
    } else {
        window.simTimer = setInterval(simulateTraffic, 3000);
        btn.innerHTML = "🛑 Stop Simulator";
        btn.style.background = "#ff4757";
        btn.style.color = "white";
        btn.style.borderColor = "#ff4757";
        simulateTraffic(); // Trigger first one immediately
    }
}
