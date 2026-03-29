import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// Supabase Connection (Matching hospital-login.js)
const SUPABASE_URL = "https://bzrxpejjfzlecpugylqx.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6cnhwZWpqZnpsZWNwdWd5bHF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTkxNjksImV4cCI6MjA4NDgzNTE2OX0.tS3GgxA5L969XGQK9Uw4qxTcqco1Y2iytoKcfos0DNU";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Enforce Admin Authentication
    if (localStorage.getItem('bb_admin_auth') !== 'true') {
        window.location.href = 'admin-login.html';
        return;
    }

    // 2. Load Core Data
    await loadHospitals();
    await loadTransfers();
    await loadAuditLogs();
});

// Load Registered Hospitals
async function loadHospitals() {
    const tbody = document.getElementById('hospitals-body');
    const { data: hospitals, error } = await supabase.from('hospitals').select('*');
    window.hospitalsMap = {};
    if (hospitals) {
        hospitals.forEach(h => window.hospitalsMap[h.id] = h.name);
    }

    if (error) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#ef4444;">Error loading hospitals: ${error.message}</td></tr>`;
        return;
    }

    document.getElementById('hospital-count').textContent = hospitals.length;
    if (hospitals.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No hospitals registered yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    hospitals.forEach(h => {
        tbody.innerHTML += `
            <tr>
                <td><span style="font-family:monospace; color:var(--text-muted);">${h.id}</span></td>
                <td style="font-weight:600; color:var(--text-main);">${h.name}</td>
                <td>${h.email}</td>
                <td>${h.city}</td>
                <td><span class="badge completed">${h.type || 'Unknown'}</span></td>
                <td><span class="badge active">Active</span></td>
            </tr>
        `;
    });
}

// Load Blood Transfers (Network Wide)
async function loadTransfers() {
    const tbody = document.getElementById('transfers-body');
    const chatsBody = document.getElementById('chats-body');

    // Check if table exists yet by querying it
    const { data: transfers, error } = await supabase.from('blood_transfers').select('*').order('created_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Awaiting Database Schema (blood_transfers table not found).</td></tr>`;
        if (chatsBody) chatsBody.innerHTML = `<p style="text-align: center; color:#ef4444;">Error loading network communications.</p>`;
        return;
    }

    document.getElementById('transfer-count').textContent = transfers.length;
    const chatCount = document.getElementById('chat-count');
    if (chatCount) chatCount.textContent = transfers.length;
    if (transfers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No blood transfers recorded on the network.</td></tr>`;
        if (chatsBody) chatsBody.innerHTML = `<p style="text-align: center; color:var(--text-muted);">No network communications found.</p>`;
        return;
    }

    tbody.innerHTML = '';
    if (chatsBody) chatsBody.innerHTML = '';
    transfers.forEach(t => {
        let statusBadge = t.status === 'PENDING' ? 'pending' : (t.status === 'ISSUED' ? 'completed' : 'active');
        let senderName = window.hospitalsMap && window.hospitalsMap[t.sender_id] ? window.hospitalsMap[t.sender_id] : (t.sender_id ? t.sender_id.substring(0, 8) : 'Unknown');
        let receiverName = window.hospitalsMap && window.hospitalsMap[t.receiver_id] ? window.hospitalsMap[t.receiver_id] : (t.receiver_id ? t.receiver_id.substring(0, 8) : 'Unknown');
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
            let chatColor = t.status === 'PENDING' ? '#f59e0b' : (t.status === 'ISSUED' || t.status === 'APPROVED' ? '#10b981' : '#ef4444');
            let icon = t.status === 'PENDING' ? '🚨' : (t.status === 'ISSUED' || t.status === 'APPROVED' ? '✅' : '❌');
            let chatMessage = t.status === 'PENDING' 
                ? `<strong>Emergency Request:</strong> ${senderName} requested <b>${t.units} Units</b> of <b>${t.blood_group}</b> from ${receiverName}.`
                : (t.status === 'ISSUED' || t.status === 'APPROVED' 
                    ? `<strong>Approved:</strong> ${receiverName} approved ${t.units} Units of ${t.blood_group} for ${senderName}.` 
                    : `<strong>Rejected:</strong> ${receiverName} rejected the request from ${senderName}.`);
            
            chatsBody.innerHTML += `
                <div style="background: var(--bg-secondary, #ffffff); border-left: 4px solid ${chatColor}; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); margin-bottom: 5px; border: 1px solid var(--border-color, #eee);">
                    <div style="font-size: 0.85rem; color: var(--text-muted, #64748b); margin-bottom: 5px;">${new Date(t.created_at).toLocaleString()} | Transfer ID: ${t.id.substring(0,8)}</div>
                    <div style="font-size: 1rem; color: var(--text-main, #0f172a);">${icon} ${chatMessage}</div>
                </div>
            `;
        }
    });
}

// Load System Audit Logs
async function loadAuditLogs() {
    const tbody = document.getElementById('audit-body');

    const { data: logs, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(50);

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Awaiting Database Schema (audit_logs table not found).</td></tr>`;
        return;
    }

    document.getElementById('audit-count').textContent = logs.length;
    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No audit trails recorded.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    logs.forEach(l => {
        tbody.innerHTML += `
            <tr>
                <td><span style="font-family:monospace; color:var(--text-muted);">${l.id.substring(0, 8)}</span></td>
                <td><span style="font-family:monospace;">${l.hospital_id.substring(0, 8)}</span></td>
                <td><span class="badge active">${l.action_type}</span></td>
                <td>${l.description}</td>
                <td>${new Date(l.created_at).toLocaleString()}</td>
            </tr>
        `;
    });
}

// --- LIVE SIMULATOR FOR PRESENTATIONS ---
window.simTimer = null;

async function simulateTraffic() {
    const hospitalIds = Object.keys(window.hospitalsMap || {});
    if (hospitalIds.length < 2) {
        console.warn("Need at least 2 hospitals to simulate traffic");
        return;
    }
    
    // Pick specific random hospitals
    const sender = hospitalIds[Math.floor(Math.random() * hospitalIds.length)];
    let receiver = hospitalIds[Math.floor(Math.random() * hospitalIds.length)];
    while(receiver === sender) {
        receiver = hospitalIds[Math.floor(Math.random() * hospitalIds.length)];
    }

    const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
    const bg = bloodGroups[Math.floor(Math.random() * bloodGroups.length)];
    const units = Math.floor(Math.random() * 8) + 1;

    // 70% chance of pending, 20% issued, 10% rejected
    const rand = Math.random();
    const status = rand > 0.8 ? "ISSUED" : (rand > 0.7 ? "REJECTED" : "PENDING");

    const { error } = await supabase.from("blood_transfers").insert({
        sender_id: sender,
        receiver_id: receiver,
        blood_group: bg,
        units: units,
        status: status
    });

    if(!error) {
        loadTransfers(); // Refresh UI instantly
    }
}

window.startSimulation = function() {
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

// --- AI PREDICTOR FOR PRESENTATIONS ---
window.runAIPrediction = function() {
    const btn = document.getElementById("run-ai-btn");
    const results = document.getElementById("ai-results");
    
    // Reset state
    btn.style.color = "var(--text-main)";
    btn.innerHTML = "Initializing Neural Network Models... ⏳";
    btn.disabled = true;
    results.style.display = "none";
    
    setTimeout(() => {
        btn.innerHTML = "Processing Regional Transit Data... 📊";
    }, 1500);
    
    setTimeout(() => {
        btn.innerHTML = "Analyzing Inventory Constraints... 🧠";
    }, 3000);
    
    setTimeout(() => {
        btn.innerHTML = "Run Neural Network Analysis";
        btn.style.color = "var(--primary)";
        btn.disabled = false;
        results.style.display = "block"; // Show the AI insights
    }, 4500);
}
