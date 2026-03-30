// app.js - Frontend Logic for Money Megaboard v3.0.0

let netChart, posNegChart, pieChartExpenses, pieChartIncome;
let allTransactions = [];
let pendingGroups = {};

const INCOME_CATS = ["Income", "Dividends", "Transfers", "Other"];
const EXPENSE_CATS = ["Food", "Transportation", "Shopping", "Education", "Subscription", "Entertainment", "Clothes+Haircuts", "Health", "Transfers", "Other"];

// Server Settings Object
let appSettings = {
    customCategories: {},
    isolatedTxs: {},
    csvMappings: {},
    customNotes: {},
    transferRules: []
};

// INITIALIZATION
window.onload = async () => {
    Chart.defaults.color = '#000000';
    Chart.defaults.font.family = 'sans-serif';
    Chart.defaults.font.weight = 'bold';
    Chart.defaults.borderColor = '#000000';

    await loadSettingsFromServer();
    setupEventListeners();
    renderTransferRules();
};

async function loadSettingsFromServer() {
    try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        appSettings = Object.assign(appSettings, data);
    } catch (e) {
        console.error("Failed to load settings from server:", e);
    }
}

async function saveSettingsToServer() {
    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appSettings)
        });
        if (res.ok) {
            const status = document.getElementById("saveStatus");
            status.innerText = "Saved to Server \u2713";
            setTimeout(() => status.innerText = "", 2000);
        }
    } catch (e) {
        console.error("Failed to save settings to server:", e);
    }
}


function setupEventListeners() {
    // Basic CSV file drop trigger
    document.getElementById("csvFiles").addEventListener("change", async e => {
        const files = e.target.files;
        if (!files.length) return;
        pendingGroups = {};

        // Hide download links by default on new upload
        document.getElementById("paypalDownloads").style.display = "none";

        for (let file of files) {
            let rawName = file.name.replace(/\.[^/.]+$/, "");
            let baseName = rawName.replace(/#\d+$/, "").trim();
            let groupMatch = baseName.match(/\(([^)]+)\)/);
            let mappingKey = groupMatch ? `group_${groupMatch[1].toLowerCase()}` : baseName.toLowerCase();
            let displayName = groupMatch ? `Group: ${groupMatch[1].toUpperCase()}` : baseName;
            let cleanAccountName = baseName.replace(/\([^)]+\)/g, '').trim();

            if (!pendingGroups[mappingKey]) {
                pendingGroups[mappingKey] = { mappingKey, displayName, headers: [], filesData: [] };
            }

            // Check if this is a paypal file
            if (file.name.toLowerCase().includes("paypal")) {
                // Send to backend cleaner
                const formData = new FormData();
                formData.append("file", file);

                try {
                    const res = await fetch('/api/upload_paypal', {
                        method: 'POST',
                        body: formData
                    });
                    const data = await res.json();

                    if (data.status === "success" && data.cleaned_rows.length > 0) {
                        const headers = data.cleaned_rows[0];
                        if (pendingGroups[mappingKey].headers.length === 0) {
                            pendingGroups[mappingKey].headers = headers;
                        }

                        pendingGroups[mappingKey].filesData.push({
                            fileName: file.name,
                            rows: data.cleaned_rows,
                            accountName: cleanAccountName
                        });

                        // Show download links
                        document.getElementById("paypalDownloads").style.display = "block";
                    }
                } catch (err) {
                    console.error("Failed to clean PayPal CSV:", err);
                }
            } else {
                // Normal plain JS parsing
                const text = await file.text();
                const rows = splitCSVPureJS(text);
                if (!rows || rows.length === 0) continue;

                const headers = rows[0].map(h => h.trim());
                if (pendingGroups[mappingKey].headers.length === 0) {
                    pendingGroups[mappingKey].headers = headers;
                }

                pendingGroups[mappingKey].filesData.push({
                    fileName: file.name,
                    rows,
                    accountName: cleanAccountName
                });
            }
        }
        renderMappingUI();
    });

    document.getElementById("processMappedDataBtn").addEventListener("click", () => {
        saveMappingsFromUI();
        processGroupsViaBackend();
    });

    document.getElementById("updatePieBtn").addEventListener("click", updatePieCharts);
    document.getElementById("addTransferRuleBtn").addEventListener("click", addTransferRule);
    document.getElementById("applyRulesBtn").addEventListener("click", () => {
        if (Object.keys(pendingGroups).length > 0) processGroupsViaBackend();
    });

    document.getElementById("clearStorageBtn").addEventListener("click", async (e) => {
        e.preventDefault();
        if (confirm("Clear ALL saved settings and files from the server?")) {
            appSettings = { customCategories: {}, isolatedTxs: {}, csvMappings: {}, customNotes: {}, transferRules: [] };
            await fetch('/api/clear', { method: 'POST' });
            location.reload();
        }
    });
}


function splitCSVPureJS(text) {
    const rows = [];
    const rawRows = text.trim().split(/\r?\n/);
    for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        let result = [], inQuotes = false, current = "";
        for (let c = 0; c < row.length; c++) {
            let char = row[c];
            if (char === '"') {
                if (inQuotes && row[c + 1] === '"') { current += '"'; c++; }
                else inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) { result.push(current); current = ""; }
            else current += char;
        }
        result.push(current);
        rows.push(result);
    }
    return rows;
}


function renderMappingUI() {
    const container = document.getElementById("mappingContainer");
    const list = document.getElementById("mappingList");
    list.innerHTML = "";
    container.style.display = "block";

    Object.values(pendingGroups).forEach((group) => {
        const savedMap = appSettings.csvMappings[group.mappingKey] || {};
        const headerOptions = `<option value="">-- None --</option>` + group.headers.map(h => `<option value="${h}">${h}</option>`).join('');
        const guess = (k) => group.headers.find(h => k.some(x => h.toLowerCase().includes(x))) || "";

        const fileDiv = document.createElement("div");
        fileDiv.style.cssText = "margin-bottom:15px; padding:10px; border:2px solid #000000;";
        fileDiv.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px;">${group.displayName}</div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <label>Date: <select class="map-sel" data-type="date" data-group="${group.mappingKey}">${headerOptions}</select></label>
                <label>Desc: <select class="map-sel" data-type="desc" data-group="${group.mappingKey}">${headerOptions}</select></label>
                <label>Amount: <select class="map-sel" data-type="amount" data-group="${group.mappingKey}">${headerOptions}</select></label>
                <label>Debit: <select class="map-sel" data-type="debit" data-group="${group.mappingKey}">${headerOptions}</select></label>
                <label>Credit: <select class="map-sel" data-type="credit" data-group="${group.mappingKey}">${headerOptions}</select></label>
                <label>Notes: <select class="map-sel" data-type="notes" data-group="${group.mappingKey}">${headerOptions}</select></label>
            </div>
            <div class="unused-cols" style="font-size: 11px; font-weight: bold; margin-top: 10px;"></div>
        `;
        list.appendChild(fileDiv);

        fileDiv.querySelector(`select[data-type="date"]`).value = savedMap.date || guess(["date"]);
        fileDiv.querySelector(`select[data-type="desc"]`).value = savedMap.desc || guess(["description", "name", "title"]);
        fileDiv.querySelector(`select[data-type="amount"]`).value = savedMap.amount || guess(["amount", "total", "net"]);
        fileDiv.querySelector(`select[data-type="debit"]`).value = savedMap.debit || guess(["debit"]);
        fileDiv.querySelector(`select[data-type="credit"]`).value = savedMap.credit || guess(["credit"]);
        fileDiv.querySelector(`select[data-type="notes"]`).value = savedMap.notes || guess(["item title", "memo", "note"]);

        const updateUnused = () => {
            const used = Array.from(fileDiv.querySelectorAll('.map-sel')).map(s => s.value).filter(v => v !== "");
            const unused = group.headers.filter(h => !used.includes(h));
            fileDiv.querySelector('.unused-cols').innerText = `Unused Columns: ${unused.length ? unused.join(", ") : "None"}`;
        };
        fileDiv.querySelectorAll('.map-sel').forEach(sel => sel.addEventListener('change', updateUnused));
        updateUnused();
    });
}

async function saveMappingsFromUI() {
    Object.keys(pendingGroups).forEach(groupKey => {
        const map = {};
        const selects = document.querySelectorAll(`select[data-group="${groupKey}"]`);
        selects.forEach(s => map[s.getAttribute('data-type')] = s.value);
        appSettings.csvMappings[groupKey] = map;
    });
    await saveSettingsToServer();
}


async function processGroupsViaBackend() {
    const payload = {
        groups: Object.values(pendingGroups)
    };

    // Send bulk CSV to backend for parsing and transfer detection
    const btn = document.getElementById("processMappedDataBtn");
    btn.innerText = "Processing...";
    btn.disabled = true;

    try {
        const res = await fetch('/api/process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        // Return structured transactions map
        allTransactions = data.transactions.map(t => {
            t.date = new Date(t.date); // Convert iso string to real Date obj
            return t;
        });

        if (allTransactions.length) {
            document.getElementById("startDate").value = allTransactions[allTransactions.length - 1].date.toISOString().split('T')[0];
            document.getElementById("endDate").value = allTransactions[0].date.toISOString().split('T')[0];
        }

        document.getElementById("mappingContainer").style.display = "none";

        renderTable();
        updateCharts();

    } catch (e) {
        alert("Failed to process data via Python. Check server logs." + e);
        console.error(e);
    } finally {
        btn.innerText = "Confirm Mappings & Load Data";
        btn.disabled = false;
    }
}


// --- TRANSFER RULES ---

function renderTransferRules() {
    const container = document.getElementById("transferRulesContainer");
    container.innerHTML = "";
    appSettings.transferRules.forEach((rule, idx) => {
        const div = document.createElement("div");
        div.style.cssText = "display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:10px; border:2px solid #000000;";
        div.innerHTML = `
            <div style="display:flex; flex-direction:column;">
                <label style="font-weight:bold; font-size:11px;">Account A Name</label>
                <input type="text" class="rule-input" data-idx="${idx}" data-field="acc1" value="${rule.acc1}" placeholder="e.g. checking" style="width:100px;">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-weight:bold; font-size:11px;">Desc Contains</label>
                <input type="text" class="rule-input" data-idx="${idx}" data-field="desc1" value="${rule.desc1}" placeholder="e.g. paypal" style="width:120px;">
            </div>
            <strong style="font-size: 16px;">⟷</strong>
            <div style="display:flex; flex-direction:column;">
                <label style="font-weight:bold; font-size:11px;">Account B Name</label>
                <input type="text" class="rule-input" data-idx="${idx}" data-field="acc2" value="${rule.acc2}" placeholder="e.g. paypal" style="width:100px;">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-weight:bold; font-size:11px;">Desc Contains</label>
                <input type="text" class="rule-input" data-idx="${idx}" data-field="desc2" value="${rule.desc2}" placeholder="e.g. transfer" style="width:120px;">
            </div>
            <div style="display:flex; flex-direction:column;">
                <label style="font-weight:bold; font-size:11px;">Max Days</label>
                <input type="number" class="rule-input" data-idx="${idx}" data-field="days" value="${rule.days}" style="width:50px;">
            </div>
            <button class="del-rule-btn" data-idx="${idx}" style="padding:5px; background:#e74c3c; color:#ffffff; cursor:pointer; font-weight:bold;">X</button>
        `;
        container.appendChild(div);
    });

    document.querySelectorAll('.rule-input').forEach(inp => inp.addEventListener('change', async (e) => {
        const i = e.target;
        saveTransferRuleLocal(i.dataset.idx, i.dataset.field, i.value);
        await saveSettingsToServer();
    }));

    document.querySelectorAll('.del-rule-btn').forEach(btn => btn.addEventListener('click', async (e) => {
        appSettings.transferRules.splice(e.target.dataset.idx, 1);
        await saveSettingsToServer();
        renderTransferRules();
    }));
    document.getElementById("applyRulesBtn").style.display = appSettings.transferRules.length > 0 ? "block" : "none";
}

function saveTransferRuleLocal(idx, field, rawValue) {
    if (appSettings.transferRules[idx]) {
        appSettings.transferRules[idx][field] = field === 'days' ? (parseInt(rawValue) || 0) : rawValue.toLowerCase();
    }
}

async function addTransferRule() {
    appSettings.transferRules.push({ acc1: "", desc1: "", acc2: "", desc2: "", days: 3 });
    await saveSettingsToServer();
    renderTransferRules();
}


// --- RENDERING ---

function getCategoryColor(cat) {
    const map = { Food: "#ff0000", Transportation: "#ff8800", Shopping: "#9900ff", Education: "#0066ff", Subscription: "#00cc99", Transfers: "#0055ff", Income: "#00cc00", Dividends: "#00ff00", Entertainment: "#ff00cc", "Clothes+Haircuts": "#ff5500", Health: "#ff0066", Other: "#000000" };
    return map[cat] || "#000000";
}

function renderTable() {
    const tbody = document.getElementById("txnTable");
    tbody.innerHTML = "";

    allTransactions.forEach(tx => {
        if (tx.isHidden) return;
        const row = document.createElement("tr");
        const monthTag = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
        row.setAttribute("data-month", monthTag);

        let displayDesc = tx.desc;
        let displayAmount = tx.amount;
        let displayAccount = tx.account;
        let amountColor = tx.amount < 0 ? "#e74c3c" : "#27ae60";
        let amountSign = tx.amount > 0 ? "+" : "";
        let isConsolidatedTransfer = false;

        if (tx.isTransfer && tx.transferPartnerTxId) {
            // Find partner by ID since we don't have cyclic references in JSON
            const partner = allTransactions.find(t => t.id === tx.transferPartnerTxId);
            if (partner) {
                const src = tx.amount < 0 ? tx.account : partner.account;
                const dst = tx.amount > 0 ? tx.account : partner.account;
                displayDesc = `$${Math.abs(tx.amount).toFixed(2)} transfer: ${src} -> ${dst}`;
                displayAmount = Math.abs(tx.amount);
                displayAccount = "Transfer";
                amountColor = "#0055ff";
                amountSign = "";
                isConsolidatedTransfer = true;
            }
        }

        row.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="isolate-cb" data-id="${tx.id}" ${tx.isolate ? 'checked' : ''} ${isConsolidatedTransfer ? 'disabled' : ''}></td>
            <td style="font-weight:bold;">${tx.date.toLocaleDateString()}</td>
            <td title="${tx.desc}">${displayDesc.length > 50 ? displayDesc.substring(0, 50) + '...' : displayDesc}</td>
            <td style="color:${amountColor}; font-weight:bold;">${amountSign}${displayAmount.toFixed(2)}</td>
            <td style="background:${getCategoryColor(tx.category)};"><select class="cat-select" data-id="${tx.id}" style="color:white; background:transparent; border:none; font-weight:bold; width:100%; text-shadow:1px 1px 2px #000; cursor:pointer;" ${isConsolidatedTransfer ? 'disabled' : ''}>
                ${(tx.amount > 0 ? INCOME_CATS : EXPENSE_CATS).map(c => `<option value="${c}" ${tx.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select></td>
            <td>${displayAccount}</td>
            <td><input type="text" class="note-input" data-id="${tx.id}" value="${tx.notes}" style="width:95%;"></td>
        `;
        tbody.appendChild(row);
    });

    document.querySelectorAll('.cat-select').forEach(sel => sel.addEventListener('change', handleCategoryChange));
    document.querySelectorAll('.isolate-cb').forEach(cb => cb.addEventListener('change', handleIsolateChange));
    document.querySelectorAll('.note-input').forEach(inp => inp.addEventListener('change', async (e) => {
        const tx = allTransactions.find(t => t.id === e.target.dataset.id);
        tx.notes = e.target.value;
        appSettings.customNotes[tx.id] = tx.notes;
        await saveSettingsToServer();
    }));
}

async function handleCategoryChange(e) {
    const tx = allTransactions.find(t => t.id === e.target.dataset.id);
    if (!tx) return;

    tx.category = e.target.value;

    if (tx.isolate) {
        appSettings.isolatedTxs[tx.id] = { isolate: true, category: tx.category };
    } else {
        appSettings.customCategories[tx.normalizedDesc] = tx.category;

        allTransactions.forEach(t => {
            if (t.normalizedDesc === tx.normalizedDesc && !t.isolate && !t.isTransfer) {
                t.category = tx.category;
            }
        });
    }

    await saveSettingsToServer();
    renderTable();
    updateCharts();
}

async function handleIsolateChange(e) {
    const tx = allTransactions.find(t => t.id === e.target.dataset.id);
    if (tx) {
        tx.isolate = e.target.checked;
        if (tx.isolate) {
            appSettings.isolatedTxs[tx.id] = { isolate: true, category: tx.category };
        } else {
            delete appSettings.isolatedTxs[tx.id];
            // Fallback to naive category requires re-running guess on backend or doing basic logic:
            tx.category = tx.amount > 0 ? "Income" : "Other";
            if (appSettings.customCategories[tx.normalizedDesc]) {
                tx.category = appSettings.customCategories[tx.normalizedDesc];
            }
        }
        await saveSettingsToServer();
        renderTable();
        updateCharts();
    }
}


function updateCharts() {
    const monthly = {};
    [...allTransactions].sort((a, b) => a.date - b.date).forEach(tx => {
        const m = tx.date.toISOString().substring(0, 7);
        if (!monthly[m]) monthly[m] = { pos: 0, neg: 0, net: 0 };
        if (!tx.isTransfer && tx.category !== "Transfers") {
            if (tx.amount > 0) monthly[m].pos += tx.amount; else monthly[m].neg += tx.amount;
        }
        monthly[m].net = allTransactions.filter(t => t.date <= tx.date).reduce((sum, t) => sum + t.amount, 0);
    });
    const labels = Object.keys(monthly);
    const scrollFunc = (e, els) => { if (els.length) { const row = document.querySelector(`tr[data-month="${labels[els[0].index]}"]`); if (row) row.scrollIntoView({ behavior: "smooth" }); } };

    if (netChart) netChart.destroy();
    netChart = new Chart(document.getElementById("netWorthChart"), { type: 'line', data: { labels, datasets: [{ label: 'Net Worth', data: labels.map(l => monthly[l].net), borderColor: '#8e44ad', fill: true, backgroundColor: 'rgba(142,68,173,0.1)' }] }, options: { maintainAspectRatio: false, onClick: scrollFunc } });

    if (posNegChart) posNegChart.destroy();
    posNegChart = new Chart(document.getElementById("posNegChart"), { type: 'bar', data: { labels, datasets: [{ label: 'Income', data: labels.map(l => monthly[l].pos), backgroundColor: '#27ae60' }, { label: 'Expenses', data: labels.map(l => monthly[l].neg), backgroundColor: '#e74c3c' }] }, options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } }, onClick: scrollFunc } });

    updatePieCharts();
}

function updatePieCharts() {
    const startStr = document.getElementById("startDate").value, endStr = document.getElementById("endDate").value;
    const start = startStr ? new Date(startStr) : new Date(0), end = endStr ? new Date(endStr) : new Date(); end.setHours(23, 59, 59);
    const expData = {}, incData = {};

    allTransactions.forEach(tx => {
        if (tx.date >= start && tx.date <= end && !tx.isTransfer && tx.category !== "Transfers") {
            if (tx.amount < 0) expData[tx.category] = (expData[tx.category] || 0) + Math.abs(tx.amount);
            else if (tx.amount > 0) incData[tx.category] = (incData[tx.category] || 0) + tx.amount;
        }
    });

    const renderPie = (canvas, data) => {
        const labels = Object.keys(data);
        return new Chart(canvas, { type: 'pie', data: { labels, datasets: [{ data: Object.values(data), backgroundColor: labels.map(getCategoryColor), borderColor: '#000', borderWidth: 2 }] }, options: { plugins: { legend: { position: 'right' } } } });
    };

    if (pieChartExpenses) pieChartExpenses.destroy(); pieChartExpenses = renderPie(document.getElementById("pieChartExpenses"), expData);
    if (pieChartIncome) pieChartIncome.destroy(); pieChartIncome = renderPie(document.getElementById("pieChartIncome"), incData);
}
