// app.js - Frontend Logic for Money Megaboard v3.3.4

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
    transferRules: [],
    categoryColors: {},
    accountColors: {}
};

// INITIALIZATION
window.onload = async () => {
    Chart.defaults.color = '#000000';
    Chart.defaults.font.family = 'sans-serif';
    Chart.defaults.font.weight = 'bold';
    Chart.defaults.borderColor = '#000000';

    await loadSettingsFromServer();
    if (!appSettings.accountColors) appSettings.accountColors = {};
    if (!appSettings.categoryColors) appSettings.categoryColors = {};
    setupEventListeners();
    renderTransferRules();
    renderCategoryColors();
    renderBalanceColors();
};

async function downloadGhostCSV() {
    const ghostRows = [];
    ghostRows.push(["Date", "Description", "Amount", "Account", "Interacting Account"]);
    const addedTxIds = new Set();

    allTransactions.forEach(tx => {
        // Auto-detected ghost transfers
        if (tx.isTransfer && tx.transferPartnerAccount && !tx.transferPartnerTxId && !addedTxIds.has(tx.id)) {
            const dateStr = tx.date.toLocaleDateString('en-US');
            const desc = `Transfer with ${tx.account}`;
            const amt = -(tx.amount);
            const acc = tx.transferPartnerAccount;
            ghostRows.push([dateStr, desc, amt.toFixed(2), acc, tx.account]);
            addedTxIds.add(tx.id);
        }
        // Manually-isolated ghost transfers (skip if already added above)
        if (tx.isolate && tx.category === 'Transfers' && tx.manualTransferAccount && !addedTxIds.has(tx.id)) {
            const dateStr = tx.date.toLocaleDateString('en-US');
            const ghostAcc = tx.manualTransferAccount;
            const desc = `Transfer with ${tx.account}`;
            const amt = -(tx.amount);
            ghostRows.push([dateStr, desc, amt.toFixed(2), ghostAcc, tx.account]);
            addedTxIds.add(tx.id);
        }
    });

    if (ghostRows.length === 1) {
        alert("No ghost transfers tracked in current session.");
        return;
    }

    let csvContent = ghostRows.map(e => e.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "Ghost_Accounts_Dummy.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

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
    document.getElementById("downloadGhostCsvBtn").addEventListener("click", e => {
        e.preventDefault();
        downloadGhostCSV();
    });

    // Basic CSV file drop trigger
    document.getElementById("csvFiles").addEventListener("change", async e => {
        const files = e.target.files;
        if (!files.length) return;
        pendingGroups = {};

        // Hide download links by default on new upload
        document.getElementById("paypalDownloads").style.display = "none";

        let paypalFiles = [];
        for (let file of files) {
            if (file.name.toLowerCase().includes("paypal")) {
                paypalFiles.push(file);
                continue;
            }
            let rawName = file.name.replace(/\.[^/.]+$/, "");
            let baseName = rawName.replace(/#\d+$/, "").trim();
            let groupMatch = baseName.match(/\(([^)]+)\)/);
            let displayName = groupMatch ? `Group: ${groupMatch[1].toUpperCase()}` : baseName;
            let mappingKey = groupMatch ? `group_${groupMatch[1].toLowerCase()}` : baseName.toLowerCase();
            let cleanAccountName = baseName.replace(/\([^)]+\)/g, '').trim();

            if (!pendingGroups[mappingKey]) {
                pendingGroups[mappingKey] = { mappingKey, displayName, headers: [], filesData: [] };
            }

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

        // Handle Paypal Batch
        if (paypalFiles.length > 0) {
            const formData = new FormData();
            for (let pf of paypalFiles) {
                formData.append("files", pf);
            }

            let mappingKey = "paypal";
            if (!pendingGroups[mappingKey]) {
                pendingGroups[mappingKey] = { mappingKey, displayName: "PayPal Master", headers: [], filesData: [] };
            }

            try {
                const res = await fetch('/api/upload_paypal', { method: 'POST', body: formData });
                const data = await res.json();

                if (data.status === "success" && data.cleaned_rows.length > 0) {
                    const headers = data.cleaned_rows[0];
                    if (pendingGroups[mappingKey].headers.length === 0) {
                        pendingGroups[mappingKey].headers = headers;
                    }
                    pendingGroups[mappingKey].filesData.push({
                        fileName: "PayPal_Master_History.csv",
                        rows: data.cleaned_rows,
                        accountName: "PayPal"
                    });
                    document.getElementById("paypalDownloads").style.display = "block";
                }
            } catch (err) {
                console.error("Failed to clean PayPal CSV:", err);
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
        if (Object.keys(pendingGroups).length > 0) {
            processGroupsViaBackend();
        } else {
            alert("No CSV data loaded. Please upload CSV files first.");
        }
    });

    document.getElementById("clearStorageBtn").addEventListener("click", async (e) => {
        e.preventDefault();
        document.getElementById("customModalOverlay").style.display = "flex";
    });

    document.getElementById("modalCancelBtn").addEventListener("click", () => {
        document.getElementById("customModalOverlay").style.display = "none";
    });

    document.getElementById("modalConfirmBtn").addEventListener("click", async () => {
        document.getElementById("customModalOverlay").style.display = "none";
        appSettings = { customCategories: {}, isolatedTxs: {}, csvMappings: {}, customNotes: {}, transferRules: [], categoryColors: {} };
        await fetch('/api/clear', { method: 'POST' });
        location.reload();
    });
}


function splitCSVPureJS(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = "";
    let inQuotes = false;

    for (let c = 0; c < text.length; c++) {
        let char = text[c];
        let nextChar = text[c + 1] || "";

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentCell += '"';
                c++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            currentRow.push(currentCell.trim());
            currentCell = "";
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                c++;
            }
            currentRow.push(currentCell.trim());

            // Skip empty rows
            if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== "")) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentCell = "";
        } else {
            currentCell += char;
        }
    }

    if (currentCell !== "" || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== "")) {
            rows.push(currentRow);
        }
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
        const guess = (k) => group.headers.find(h => k.some(x => h.toLowerCase().includes(x))) || "";

        let assignments = {
            date: savedMap.date ? [savedMap.date] : [guess(["date"])],
            time: savedMap.time ? [savedMap.time] : [guess(["time", "clock"])],
            desc: savedMap.desc ? [savedMap.desc] : [guess(["description", "name", "title"])],
            amount: savedMap.amount ? [savedMap.amount] : [guess(["amount", "total", "net"])],
            debit: savedMap.debit ? [savedMap.debit] : [guess(["debit", "withdrawal"])],
            credit: savedMap.credit ? [savedMap.credit] : [guess(["credit", "deposit"])],
            notes: []
        };
        Object.keys(assignments).forEach(k => { if (assignments[k][0] === "") assignments[k] = []; });

        if (savedMap.notes && Array.isArray(savedMap.notes)) {
            assignments.notes = savedMap.notes;
        } else if (savedMap.notes) {
            assignments.notes = [savedMap.notes];
        } else {
            const n = guess(["item title", "memo", "note"]);
            if (n) assignments.notes = [n];
        }

        let usedHeaders = new Set();
        let finalAssignments = { date: [], time: [], desc: [], amount: [], debit: [], credit: [], notes: [] };

        const assign = (type, valArray) => {
            valArray.forEach(v => {
                if (v && !usedHeaders.has(v) && group.headers.includes(v)) {
                    finalAssignments[type].push(v);
                    usedHeaders.add(v);
                }
            });
        };

        assign('date', assignments.date);
        assign('time', assignments.time);
        assign('desc', assignments.desc);
        assign('amount', assignments.amount);
        assign('debit', assignments.debit);
        assign('credit', assignments.credit);
        assign('notes', assignments.notes);

        const unusedHeaders = group.headers.filter(h => !usedHeaders.has(h));

        const badgeHTML = (h) => `<div draggable="true" class="col-badge" data-header="${h}" data-group="${group.mappingKey}" style="cursor: grab; padding: 5px 10px; background: #ecf0f1; border: 2px solid #000000; box-shadow: 2px 2px 0px #000; font-weight: bold; font-size: 11px;">${h}</div>`;
        const zoneStyle = "flex: 1; min-width: 100px; min-height: 45px; border: 2px dashed #000; padding: 5px; background: #ffffff; display: flex; flex-direction: column; font-size: 11px; font-weight: bold;";

        const fileDiv = document.createElement("div");
        fileDiv.style.cssText = "margin-bottom:15px; padding:10px; border:2px solid #000000; background: #fdfdfd;";
        fileDiv.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 5px; font-size: 14px;">${group.displayName}</div>
            <div style="margin-bottom: 15px; font-size: 12px; font-weight: bold;">
                <label style="margin-right: 15px;"><input type="radio" name="fmt_${group.mappingKey}" value="single" checked class="fmt-radio" data-group="${group.mappingKey}"> Single Amount Column</label>
                <label><input type="radio" name="fmt_${group.mappingKey}" value="split" class="fmt-radio" data-group="${group.mappingKey}"> Separate Credit/Debit Columns</label>
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch;" class="drop-zones-container">
                <div class="map-zone" data-type="date" data-group="${group.mappingKey}" style="${zoneStyle}">Date:
                    <div class="zone-content" style="flex:1; display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; align-content: flex-start;">${finalAssignments.date.map(badgeHTML).join('')}</div>
                </div>
                <div class="map-zone" data-type="time" data-group="${group.mappingKey}" style="${zoneStyle}">Time (Opt):
                    <div class="zone-content" style="flex:1; display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; align-content: flex-start;">${finalAssignments.time.map(badgeHTML).join('')}</div>
                </div>
                <div class="map-zone" data-type="desc" data-group="${group.mappingKey}" style="${zoneStyle}">Desc:
                    <div class="zone-content" style="flex:1; display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; align-content: flex-start;">${finalAssignments.desc.map(badgeHTML).join('')}</div>
                </div>
                <div class="map-zone" id="lbl_amt_${group.mappingKey}" data-type="amount" data-group="${group.mappingKey}" style="${zoneStyle}">Amount:
                    <div class="zone-content" style="flex:1; display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; align-content: flex-start;">${finalAssignments.amount.map(badgeHTML).join('')}</div>
                </div>
                <div class="map-zone" id="lbl_deb_${group.mappingKey}" data-type="debit" data-group="${group.mappingKey}" style="${zoneStyle}; display:none;">Expenses (-):
                    <div class="zone-content" style="flex:1; display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; align-content: flex-start;">${finalAssignments.debit.map(badgeHTML).join('')}</div>
                </div>
                <div class="map-zone" id="lbl_cre_${group.mappingKey}" data-type="credit" data-group="${group.mappingKey}" style="${zoneStyle}; display:none;">Income (+):
                    <div class="zone-content" style="flex:1; display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; align-content: flex-start;">${finalAssignments.credit.map(badgeHTML).join('')}</div>
                </div>
                <div class="map-zone" data-type="notes" data-group="${group.mappingKey}" data-multi="true" style="${zoneStyle}">Notes (Multi):
                    <div class="zone-content" style="flex:1; display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; align-content: flex-start;">${finalAssignments.notes.map(badgeHTML).join('')}</div>
                </div>
            </div>
            <div class="map-zone" data-type="unused" data-group="${group.mappingKey}" data-multi="true" style="margin-top: 10px; min-height: 40px; border: 2px dashed #000; padding: 5px; background: #fdfae6; font-size: 11px; font-weight: bold;">
                Unused Columns (Drag to map):
                <div class="zone-content" style="display:flex; flex-wrap:wrap; gap:5px; margin-top:5px; min-height:20px; align-content: flex-start;">
                    ${unusedHeaders.map(badgeHTML).join('')}
                </div>
            </div>
        `;
        list.appendChild(fileDiv);

        const toggleVisibility = async () => {
            const isSingle = fileDiv.querySelector(`input[name="fmt_${group.mappingKey}"]:checked`).value === "single";
            fileDiv.querySelector(`#lbl_amt_${group.mappingKey}`).style.display = isSingle ? "flex" : "none";
            fileDiv.querySelector(`#lbl_deb_${group.mappingKey}`).style.display = isSingle ? "none" : "flex";
            fileDiv.querySelector(`#lbl_cre_${group.mappingKey}`).style.display = isSingle ? "none" : "flex";

            if (isSingle) {
                const debits = Array.from(fileDiv.querySelector(`#lbl_deb_${group.mappingKey} .zone-content`).children);
                const credits = Array.from(fileDiv.querySelector(`#lbl_cre_${group.mappingKey} .zone-content`).children);
                const unused = fileDiv.querySelector('.map-zone[data-type="unused"] .zone-content');
                debits.forEach(b => unused.appendChild(b));
                credits.forEach(b => unused.appendChild(b));
            } else {
                const amounts = Array.from(fileDiv.querySelector(`#lbl_amt_${group.mappingKey} .zone-content`).children);
                const unused = fileDiv.querySelector('.map-zone[data-type="unused"] .zone-content');
                amounts.forEach(b => unused.appendChild(b));
            }
            saveMappingsFromUI();
        };

        if (savedMap.format === "split") {
            fileDiv.querySelector(`input[value="split"]`).checked = true;
        }
        toggleVisibility();

        fileDiv.querySelectorAll('.fmt-radio').forEach(r => r.addEventListener('change', toggleVisibility));

        let draggedBadge = null;

        fileDiv.querySelectorAll('.col-badge').forEach(badge => {
            badge.addEventListener('dragstart', e => {
                draggedBadge = badge;
                badge.style.opacity = '0.5';
            });
            badge.addEventListener('dragend', e => {
                badge.style.opacity = '1';
                draggedBadge = null;
            });
            badge.addEventListener('dblclick', async e => {
                const zoneType = badge.closest('.map-zone').getAttribute('data-type');
                if (zoneType !== 'unused') {
                    fileDiv.querySelector('.map-zone[data-type="unused"] .zone-content').appendChild(badge);
                    await saveMappingsFromUI();
                }
            });
        });

        fileDiv.querySelectorAll('.map-zone').forEach(zone => {
            zone.addEventListener('dragover', e => {
                e.preventDefault();
                zone.style.backgroundColor = '#ecf0f1';
            });
            zone.addEventListener('dragleave', e => {
                zone.style.backgroundColor = zone.getAttribute('data-type') === 'unused' ? '#fdfae6' : '#ffffff';
            });
            zone.addEventListener('drop', async e => {
                e.preventDefault();
                zone.style.backgroundColor = zone.getAttribute('data-type') === 'unused' ? '#fdfae6' : '#ffffff';
                if (!draggedBadge || draggedBadge.dataset.group !== group.mappingKey) return;

                const isMulti = zone.getAttribute('data-multi') === 'true';
                const type = zone.getAttribute('data-type');
                const contentDiv = zone.querySelector('.zone-content');

                if (!isMulti && type !== 'unused' && contentDiv.children.length > 0) {
                    const existing = contentDiv.children[0];
                    if (existing !== draggedBadge) {
                        fileDiv.querySelector('.map-zone[data-type="unused"] .zone-content').appendChild(existing);
                    }
                }

                contentDiv.appendChild(draggedBadge);
                await saveMappingsFromUI();
            });
        });
    });
}

async function saveMappingsFromUI() {
    Object.keys(pendingGroups).forEach(groupKey => {
        const map = {};
        const radio = document.querySelector(`input[name="fmt_${groupKey}"]:checked`);
        if (!radio) return;
        const isSingle = radio.value === "single";
        map.format = isSingle ? "single" : "split";

        const zones = document.querySelectorAll(`.map-zone[data-group="${groupKey}"]`);
        zones.forEach(z => {
            const type = z.getAttribute('data-type');
            if (type === 'unused') return;
            const badges = Array.from(z.querySelectorAll('.col-badge')).map(b => b.getAttribute('data-header'));
            if (z.getAttribute('data-multi') === 'true') {
                map[type] = badges;
            } else {
                map[type] = badges.length > 0 ? badges[0] : "";
            }
        });

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
        renderTransferRules();

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
            <span class="ghost-tag" style="display:none; padding:3px 6px; background:#e67e22; color:white; font-weight:bold; font-size:10px; border-radius:3px; margin-left:10px;">👻 ghost csv</span>
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

    // Gather all currently known standard accounts from either pending uploads or already loaded txs
    const activeAccounts = new Set();
    Object.values(pendingGroups).forEach(g => {
        g.filesData.forEach(fd => activeAccounts.add(fd.accountName.toLowerCase()));
    });
    allTransactions.forEach(tx => activeAccounts.add(tx.account.toLowerCase()));

    const ghostAccounts = new Set();

    appSettings.transferRules.forEach((rule, idx) => {
        const acc1Lower = (rule.acc1 || '').toLowerCase();
        const acc2Lower = (rule.acc2 || '').toLowerCase();
        // Use substring matching (like backend does) to check if any active account matches
        const acc1IsActive = acc1Lower && [...activeAccounts].some(a => a.includes(acc1Lower) || acc1Lower.includes(a));
        const acc2IsActive = acc2Lower && [...activeAccounts].some(a => a.includes(acc2Lower) || acc2Lower.includes(a));

        let isGhostRule = false;
        if (rule.acc1 && !acc1IsActive) {
            ghostAccounts.add(rule.acc1);
            isGhostRule = true;
        }
        if (rule.acc2 && !acc2IsActive) {
            ghostAccounts.add(rule.acc2);
            isGhostRule = true;
        }

        if (isGhostRule) {
            const ruleDiv = container.children[idx];
            if (ruleDiv) {
                const tag = ruleDiv.querySelector('.ghost-tag');
                if (tag) tag.style.display = 'inline-block';
            }
        }
    });

    const ghostBtn = document.getElementById("downloadGhostCsvBtn");
    if (ghostBtn) {
        ghostBtn.style.display = ghostAccounts.size > 0 ? "inline-block" : "none";
    }
}

function saveTransferRuleLocal(idx, field, rawValue) {
    if (appSettings.transferRules[idx]) {
        appSettings.transferRules[idx][field] = field === 'days' ? (parseInt(rawValue) || 0) : rawValue;
    }
}

async function addTransferRule() {
    appSettings.transferRules.push({ acc1: "", desc1: "", acc2: "", desc2: "", days: 3 });
    await saveSettingsToServer();
    renderTransferRules();
}


// --- RENDERING ---

let _unifiedColorMode = "Categories"; // or "Accounts"
let _unifiedSelectedCategory = null;
let _unifiedSelectedAccount = null;

async function renderUnifiedColors() {
    let container = document.getElementById("categoryColorContainer");
    if (!container) {
        // Fallback or create if index.html hasn't been updated completely, but the unified div goes here
        container = document.getElementById("categoryColorContainer") || document.createElement("div");
    }

    // Check if we already merged the containers in HTML, if so clear both, use first
    const catContainer = document.getElementById("categoryColorContainer");
    const balContainer = document.getElementById("balanceColorContainer");

    if (balContainer) balContainer.parentElement.style.display = "none"; // Hide the old account colors column entirely
    if (catContainer) {
        catContainer.innerHTML = "";
        catContainer.parentElement.querySelector("h3").innerText = "Colors";
    }

    const allCats = [...new Set([...INCOME_CATS, ...EXPENSE_CATS])];

    // Account discovery 
    const activeAccounts = new Set();
    Object.values(pendingGroups).forEach(g => {
        g.filesData.forEach(fd => activeAccounts.add(fd.accountName));
    });
    allTransactions.forEach(tx => activeAccounts.add(tx.account));

    const ghostAccounts = new Set();
    if (appSettings.transferRules) {
        appSettings.transferRules.forEach(rule => {
            if (rule.acc1 && !activeAccounts.has(rule.acc1)) ghostAccounts.add(rule.acc1);
            if (rule.acc2 && !activeAccounts.has(rule.acc2)) ghostAccounts.add(rule.acc2);
        });
    }

    const allAccounts = [...new Set([...activeAccounts, ...ghostAccounts])].sort();

    if (!appSettings.accountColors) appSettings.accountColors = {};

    const PRESET_COLORS = [
        "#e74c3c", "#ff7979", "#f0932b", "#f39c12",
        "#f1c40f", "#f9ca24", "#badc58", "#2ecc71",
        "#22a6b3", "#3498db", "#2980b9", "#1abc9c",
        "#9b59b6", "#be2edd", "#ff78cb", "#fd79a8",
        "#34495e", "#7f8c8d", "#95a5a6", "#bdc3c7"
    ];

    const wrapper = document.createElement("div");
    wrapper.style.display = "flex";
    wrapper.style.flexDirection = "row";
    wrapper.style.gap = "15px";

    // Mode Selector (Categories vs Accounts)
    const modeSelect = document.createElement("select");
    modeSelect.style.padding = "5px";
    modeSelect.style.fontWeight = "bold";
    modeSelect.style.width = "fit-content";
    ["Categories", "Accounts"].forEach(m => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.innerText = m;
        modeSelect.appendChild(opt);
    });
    modeSelect.value = _unifiedColorMode;

    const row2 = document.createElement("div");
    row2.style.display = "flex";
    row2.style.alignItems = "center";
    row2.style.gap = "15px";

    // Item Selector
    const itemSelect = document.createElement("select");
    itemSelect.style.padding = "5px";
    itemSelect.style.fontWeight = "bold";

    const swatchesDiv = document.createElement("div");
    swatchesDiv.style.display = "flex";
    swatchesDiv.style.gap = "4px";

    const renderSecondaryDropdown = () => {
        itemSelect.innerHTML = "";
        const mode = modeSelect.value;
        _unifiedColorMode = mode;

        if (mode === "Categories") {
            allCats.forEach(cat => {
                const opt = document.createElement("option");
                opt.value = cat;
                opt.innerText = cat;
                if (INCOME_CATS.includes(cat) && !EXPENSE_CATS.includes(cat)) opt.style.color = "#27ae60";
                else if (EXPENSE_CATS.includes(cat) && !INCOME_CATS.includes(cat)) opt.style.color = "#e74c3c";
                itemSelect.appendChild(opt);
            });
            if (_unifiedSelectedCategory && allCats.includes(_unifiedSelectedCategory)) {
                itemSelect.value = _unifiedSelectedCategory;
            } else if (allCats.length > 0) {
                itemSelect.value = allCats[0];
                _unifiedSelectedCategory = allCats[0];
            }
        } else {
            allAccounts.forEach(acc => {
                const opt = document.createElement("option");
                opt.value = acc;
                opt.innerText = "💰 " + acc;
                opt.style.color = "#000000";
                itemSelect.appendChild(opt);
            });
            if (_unifiedSelectedAccount && allAccounts.includes(_unifiedSelectedAccount)) {
                itemSelect.value = _unifiedSelectedAccount;
            } else if (allAccounts.length > 0) {
                itemSelect.value = allAccounts[0];
                _unifiedSelectedAccount = allAccounts[0];
            }
        }
        renderSwatches();
    };

    const renderSwatches = () => {
        swatchesDiv.innerHTML = "";
        if (!itemSelect.value) return;

        const mode = modeSelect.value;
        const selectedItem = itemSelect.value;

        let currentColor = "";
        if (mode === "Categories") {
            _unifiedSelectedCategory = selectedItem;
            currentColor = getCategoryColor(selectedItem);

            if (selectedItem === "Transfers") itemSelect.style.color = "#0055ff";
            else if (INCOME_CATS.includes(selectedItem) && !EXPENSE_CATS.includes(selectedItem)) itemSelect.style.color = "#27ae60";
            else if (EXPENSE_CATS.includes(selectedItem) && !INCOME_CATS.includes(selectedItem)) itemSelect.style.color = "#e74c3c";
            else itemSelect.style.color = "#000000";

        } else {
            _unifiedSelectedAccount = selectedItem;
            currentColor = getAccountColor(selectedItem, allAccounts);
            itemSelect.style.color = "#000000";
        }

        PRESET_COLORS.forEach(color => {
            const swatch = document.createElement("div");
            const isSelected = color.toLowerCase() === currentColor.toLowerCase();
            swatch.style.cssText = `width: 26px; height: 18px; background: ${color}; cursor: pointer; border: 2px solid ${isSelected ? '#000' : 'transparent'}; box-shadow: ${isSelected ? '0 0 0 2px #fff inset' : 'none'}; border-radius: 2px;`;
            swatch.addEventListener("click", async () => {
                if (mode === "Categories") {
                    appSettings.categoryColors[selectedItem] = color;
                } else {
                    appSettings.accountColors[selectedItem] = color;
                }
                await saveSettingsToServer();
                renderSwatches();
                renderTable();
                updateCharts();
            });
            swatchesDiv.appendChild(swatch);
        });
    };

    modeSelect.addEventListener("change", renderSecondaryDropdown);
    itemSelect.addEventListener("change", renderSwatches);

    wrapper.appendChild(modeSelect);
    wrapper.appendChild(itemSelect);
    wrapper.appendChild(swatchesDiv);

    if (catContainer) {
        catContainer.appendChild(wrapper);
    }

    renderSecondaryDropdown();
}



function getAccountColor(acc, allAccounts) {
    if (appSettings.accountColors && appSettings.accountColors[acc]) {
        return appSettings.accountColors[acc];
    }
    const ACCOUNT_COLORS = ["#3498db", "#e74c3c", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22", "#1abc9c", "#34495e", "#ff78cb", "#be2edd"];
    const idx = allAccounts ? allAccounts.indexOf(acc) : 0;
    return idx !== -1 ? ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length] : "#000000";
}

function getCategoryColor(cat) {
    if (appSettings.categoryColors && appSettings.categoryColors[cat]) {
        return appSettings.categoryColors[cat];
    }
    const map = {
        Food: "#e74c3c", Transportation: "#f39c12", Shopping: "#9b59b6",
        Education: "#3498db", Subscription: "#1abc9c", Transfers: "#34495e",
        Income: "#2ecc71", Dividends: "#badc58", Entertainment: "#be2edd",
        "Clothes+Haircuts": "#fd79a8", Health: "#ff7979", Other: "#95a5a6"
    };
    return map[cat] || "#bdc3c7";
}

const KEYWORDS = [
    { cat: "Transfers", words: ["transfer", "zelle", "venmo"] },
    { cat: "Income", words: ["deposit", "payroll", "salary"] },
    { cat: "Dividends", words: ["dividend", "interest"] },
    { cat: "Food", words: ["wawa", "restaurant", "pizza", "mcdonald", "starbucks", "applebee", "sheetz", "market", "wegmans", "giant", "aldi"] },
    { cat: "Transportation", words: ["uber", "lyft", "gas", "sunoco"] },
    { cat: "Shopping", words: ["amazon", "target", "walmart"] },
    { cat: "Education", words: ["psu", "tuition", "cengage"] },
    { cat: "Entertainment", words: ["netflix", "spotify", "apple", "prime", "hulu", "amc"] },
    { cat: "Health", words: ["cvs", "pharmacy", "doctor", "hospital"] },
    { cat: "Clothes+Haircuts", words: ["hair", "barber", "clothes", "apparel", "nike", "h&m"] }
];

function highlightKeywords(desc) {
    let result = desc;
    KEYWORDS.forEach(group => {
        const color = getCategoryColor(group.cat);
        group.words.forEach(word => {
            const regex = new RegExp(`\\b(${word})\\b`, 'gi');
            result = result.replace(regex, `<span style="color:${color}; font-weight:bold;">$1</span>`);
        });
    });
    return result;
}

const ACCOUNT_COLORS = ["#3498db", "#e74c3c", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22", "#1abc9c", "#34495e", "#ff78cb", "#be2edd"];

function renderTable() {
    const tbody = document.getElementById("txnTable");
    tbody.innerHTML = "";

    const activeAccountNames = new Set(allTransactions.map(t => t.account));
    const ghostAccounts = new Set();
    if (appSettings.transferRules) {
        appSettings.transferRules.forEach(rule => {
            if (rule.acc1 && !activeAccountNames.has(rule.acc1)) ghostAccounts.add(rule.acc1);
            if (rule.acc2 && !activeAccountNames.has(rule.acc2)) ghostAccounts.add(rule.acc2);
        });
    }
    const allAccountsList = [...new Set([...activeAccountNames, ...ghostAccounts])].sort();

    allTransactions.forEach(tx => {
        if (tx.isHidden) return;
        const row = document.createElement("tr");
        const monthTag = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
        row.setAttribute("data-month", monthTag);

        let displayDesc = highlightKeywords(tx.desc);
        let displayAmount = tx.amount;
        let displayAccount = tx.account;
        let amountColor = tx.amount < 0 ? "#e74c3c" : "#27ae60";
        let amountSign = tx.amount > 0 ? "+" : "";
        let isConsolidatedTransfer = false;

        const formatTime = (d) => {
            const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (t === "12:00 AM" || t === "00:00") ? "" : t;
        };
        let displayTime = "";

        let accountColor = getAccountColor(displayAccount, allAccountsList);

        if (tx.isTransfer && tx.transferPartnerTxId) {
            const partner = allTransactions.find(t => t.id === tx.transferPartnerTxId);
            if (partner) {
                const src = tx.amount < 0 ? tx.account : partner.account;
                const dst = tx.amount > 0 ? tx.account : partner.account;
                const srcCol = getAccountColor(src, allAccountsList);
                const dstCol = getAccountColor(dst, allAccountsList);
                displayDesc = highlightKeywords(`Transfer: `) + `<span style="color:${srcCol}; font-weight:bold;">${src}</span> -> <span style="color:${dstCol}; font-weight:bold;">${dst}</span>`;
                displayAmount = Math.abs(tx.amount);
                displayAccount = "Transfer";
                amountColor = "#0055ff";
                amountSign = "";
                isConsolidatedTransfer = true;
                accountColor = "#000000";

                // Get time of newer transaction
                let timeSrc = tx.date;
                let timeDst = partner.date;
                let finalTime = timeSrc > timeDst ? timeSrc : timeDst;
                displayTime = formatTime(finalTime);
            }
        } else if (tx.isTransfer && !tx.transferPartnerTxId && tx.transferPartnerAccount) {
            const src = tx.amount < 0 ? tx.account : tx.transferPartnerAccount;
            const dst = tx.amount > 0 ? tx.account : tx.transferPartnerAccount;
            const srcCol = getAccountColor(src, allAccountsList);
            const dstCol = getAccountColor(dst, allAccountsList);
            displayDesc = highlightKeywords(`Transfer: `) + `<span style="color:${srcCol}; font-weight:bold;">${src}</span> -> <span style="color:${dstCol}; font-weight:bold;">${dst}</span>`;
            displayAmount = Math.abs(tx.amount);
            displayAccount = "Transfer";
            amountColor = "#0055ff";
            amountSign = "";
            isConsolidatedTransfer = true;
            accountColor = "#000000";
            displayTime = formatTime(tx.date);
        } else if (tx.isolate && tx.category === 'Transfers' && tx.manualTransferAccount) {
            // Manually-linked ghost transfer
            const src = tx.amount < 0 ? tx.account : tx.manualTransferAccount;
            const dst = tx.amount > 0 ? tx.account : tx.manualTransferAccount;
            const srcCol = getAccountColor(src, allAccountsList);
            const dstCol = getAccountColor(dst, allAccountsList);
            displayDesc = highlightKeywords(`Transfer: `) + `<span style="color:${srcCol}; font-weight:bold;">${src}</span> -> <span style="color:${dstCol}; font-weight:bold;">${dst}</span>`;
            displayAmount = Math.abs(tx.amount);
            displayAccount = "Transfer";
            amountColor = "#0055ff";
            amountSign = "";
            isConsolidatedTransfer = true;
            accountColor = "#000000";
            displayTime = formatTime(tx.date);
        }

        let accountHtml = `<td style="color:${accountColor}; font-weight:bold;">${displayAccount}</td>`;
        if (tx.isolate && tx.category === 'Transfers' && !isConsolidatedTransfer) {
            // Show orange account dropdown for ghost transfer target selection
            const otherAccounts = allAccountsList.filter(a => a !== tx.account);
            accountHtml = `<td><select class="ghost-transfer-select" data-id="${tx.id}" style="font-weight:bold; width:100%; cursor:pointer; border:2px solid #e67e22; background:#fff3e0;">
                <option value="">Select account...</option>
                ${otherAccounts.map(a => `<option value="${a}">${a}</option>`).join('')}
            </select></td>`;
        }

        row.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="isolate-cb" data-id="${tx.id}" ${tx.isolate ? 'checked' : ''} ${isConsolidatedTransfer && !tx.manualTransferAccount ? 'disabled' : ''}></td>
            <td style="font-weight:bold;">${tx.date.toLocaleDateString()}</td>
            <td style="font-weight:bold; color:#7f8c8d;">${displayTime}</td>
            <td title="${tx.desc}">${displayDesc}</td>
            <td style="color:${amountColor}; font-weight:bold;">${amountSign}${displayAmount.toFixed(2)}</td>
            <td style="background:${getCategoryColor(tx.category)};"><select class="cat-select" data-id="${tx.id}" style="color:white; background:transparent; border:none; font-weight:bold; width:100%; text-shadow:1px 1px 2px #000; cursor:pointer;" ${isConsolidatedTransfer ? 'disabled' : ''}>
                ${(tx.amount > 0 ? INCOME_CATS : EXPENSE_CATS).map(c => `<option value="${c}" ${tx.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select></td>
            ${accountHtml}
            <td><textarea class="note-input" data-id="${tx.id}" style="width:95%; height:30px; resize:vertical;">${tx.notes}</textarea></td>
        `;
        tbody.appendChild(row);
    });

    document.querySelectorAll('.acc-select').forEach(sel => sel.addEventListener('change', async (e) => {
        const tx = allTransactions.find(t => t.id === e.target.dataset.id);
        if (tx) {
            tx.account = e.target.value;
            // Retain isolate override logic 
            if (tx.isolate) {
                appSettings.isolatedTxs[tx.id] = appSettings.isolatedTxs[tx.id] || { isolate: true };
                appSettings.isolatedTxs[tx.id].account = tx.account;
            }
            await saveSettingsToServer();
            renderTable();
            updateCharts();
        }
    }));

    // Ghost transfer account selection
    document.querySelectorAll('.ghost-transfer-select').forEach(sel => sel.addEventListener('change', async (e) => {
        const tx = allTransactions.find(t => t.id === e.target.dataset.id);
        if (tx && e.target.value) {
            tx.manualTransferAccount = e.target.value;
            tx.isTransfer = true;
            tx.transferPartnerAccount = e.target.value;
            appSettings.isolatedTxs[tx.id] = appSettings.isolatedTxs[tx.id] || { isolate: true };
            appSettings.isolatedTxs[tx.id].category = 'Transfers';
            appSettings.isolatedTxs[tx.id].manualTransferAccount = e.target.value;
            await saveSettingsToServer();
            renderTable();
            updateCharts();
        }
    }));

    document.querySelectorAll('.cat-select').forEach(sel => sel.addEventListener('change', handleCategoryChange));
    document.querySelectorAll('.isolate-cb').forEach(cb => cb.addEventListener('change', handleIsolateChange));
    document.querySelectorAll('.note-input').forEach(inp => inp.addEventListener('change', async (e) => {
        const tx = allTransactions.find(t => t.id === e.target.dataset.id);
        tx.notes = e.target.value;
        appSettings.customNotes[tx.id] = tx.notes;
        await saveSettingsToServer();
    }));

    renderUnifiedColors();
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
            appSettings.isolatedTxs[tx.id] = { isolate: true, category: tx.category, account: tx.account };
            if (tx.manualTransferAccount) {
                appSettings.isolatedTxs[tx.id].manualTransferAccount = tx.manualTransferAccount;
            }
        } else {
            delete appSettings.isolatedTxs[tx.id];
            if (tx.manualTransferAccount) {
                tx.isTransfer = false;
                tx.transferPartnerAccount = null;
                tx.manualTransferAccount = null;
            }
            // Fallback to naive category requires re-running guess on backend or doing basic logic:
            tx.category = tx.originalCategory || (tx.amount > 0 ? "Income" : "Other");
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
    const accountNames = new Set();
    const sortedTxs = [...allTransactions].sort((a, b) => a.date - b.date);

    // Compute ghostAccounts manually for the chart tooltip
    const activeAccountNames = new Set(sortedTxs.map(t => t.account));
    const ghostAccounts = new Set();
    if (appSettings.transferRules) {
        appSettings.transferRules.forEach(rule => {
            if (rule.acc1 && !activeAccountNames.has(rule.acc1)) ghostAccounts.add(rule.acc1);
            if (rule.acc2 && !activeAccountNames.has(rule.acc2)) ghostAccounts.add(rule.acc2);
        });
    }

    let runningNet = 0;
    let runningAccounts = {};

    sortedTxs.forEach(tx => {
        const m = tx.date.toISOString().substring(0, 7);
        accountNames.add(tx.account);
        if (tx.transferPartnerAccount) accountNames.add(tx.transferPartnerAccount);

        if (!monthly[m]) {
            monthly[m] = { pos: 0, neg: 0, net: 0, accountTotals: {} };
        }

        if (!tx.isTransfer && tx.category !== "Transfers") {
            if (tx.amount > 0) monthly[m].pos += tx.amount; else monthly[m].neg += tx.amount;
        }

        runningNet += tx.amount;

        if (tx.isTransfer && tx.transferPartnerAccount && !tx.transferPartnerTxId) {
            // It's a ghost proxy. Log the ghost's synthetic reversed ledger amount.
            const synthGhostAmount = -(tx.amount);
            runningAccounts[tx.transferPartnerAccount] = (runningAccounts[tx.transferPartnerAccount] || 0) + synthGhostAmount;
        } else if (tx.isolate && tx.category === 'Transfers' && tx.manualTransferAccount) {
            // Manually-linked ghost transfer — same synthetic logic
            const synthGhostAmount = -(tx.amount);
            runningAccounts[tx.manualTransferAccount] = (runningAccounts[tx.manualTransferAccount] || 0) + synthGhostAmount;
            accountNames.add(tx.manualTransferAccount);
        }
        runningAccounts[tx.account] = (runningAccounts[tx.account] || 0) + tx.amount;

        monthly[m].net = runningNet;
        monthly[m].accountTotals = { ...runningAccounts };
    });

    const labels = Object.keys(monthly);
    const scrollFunc = (e, els) => { if (els.length) { const row = document.querySelector(`tr[data-month="${labels[els[0].index]}"]`); if (row) row.scrollIntoView({ behavior: "smooth" }); } };

    const datasets = [];

    // 1. Prominent Total Net Worth Line
    datasets.push({
        label: 'Total Net Worth',
        data: labels.map(l => monthly[l].net),
        borderColor: '#000000',
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderWidth: 4,
        fill: true,
        tension: 0.1
    });

    // 2. Individual Account Lines
    const allAccountsList = [...accountNames].sort();
    allAccountsList.forEach((acc) => {
        let rawData = labels.map(l => monthly[l].accountTotals[acc] || 0);
        let sparseData = [...rawData];

        for (let i = 0; i < rawData.length; i++) {
            let val = rawData[i];
            let prevVal = i > 0 ? rawData[i - 1] : null;
            let nextVal = i < rawData.length - 1 ? rawData[i + 1] : null;

            // Redundant duplicates (straight line) become null to just draw a straight line
            if (val === prevVal && val === nextVal) {
                // If the redundant value is 0, we actually want to break the line completely 
                // so we rely on spanGaps: false to leave a gap.
                sparseData[i] = null;
            }

            // If the account hits zero, we keep the first 0 and the last 0, 
            // but we don't draw a line connecting them. 
            // Chart.js requires spanGaps: false for this to work natively over nulls.
        }

        datasets.push({
            label: (ghostAccounts && ghostAccounts.has(acc)) ? `👻 ` + acc : acc,
            data: sparseData,
            borderColor: getAccountColor(acc, allAccountsList),
            borderWidth: 2,
            borderDash: [5, 5],
            fill: false,
            tension: 0.1,
            spanGaps: true
        });
    });

    if (netChart) netChart.destroy();
    netChart = new Chart(document.getElementById("netWorthChart"), {
        type: 'line',
        data: { labels, datasets },
        options: {
            maintainAspectRatio: false,
            onClick: scrollFunc,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: { display: true, text: 'Accounts and Net Worth', font: { size: 16 } },
                tooltip: {
                    itemSort: function (a, b) {
                        return b.parsed.y - a.parsed.y;
                    },
                    filter: function (tooltipItem) {
                        // Don't show accounts with 0 balance
                        return tooltipItem.parsed.y !== 0;
                    },
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });

    if (posNegChart) posNegChart.destroy();
    posNegChart = new Chart(document.getElementById("posNegChart"), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Income', data: labels.map(l => monthly[l].pos), backgroundColor: '#27ae60' }, { label: 'Expenses', data: labels.map(l => monthly[l].neg), backgroundColor: '#e74c3c' }] },
        options: {
            maintainAspectRatio: false,
            scales: { x: { stacked: true }, y: { stacked: true } },
            onClick: scrollFunc,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                title: { display: true, text: 'Income vs Expenses', font: { size: 16 } },
                tooltip: {
                    itemSort: function (a, b) {
                        return b.parsed.y - a.parsed.y;
                    },
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });

    updatePieCharts();
}

function updatePieCharts() {
    const startStr = document.getElementById("startDate").value, endStr = document.getElementById("endDate").value;
    const start = startStr ? new Date(startStr) : new Date(0), end = endStr ? new Date(endStr) : new Date(); end.setHours(23, 59, 59);
    const expData = {}, incData = {};

    allTransactions.forEach(tx => {
        if (tx.date >= start && tx.date <= end && !tx.isTransfer && tx.category !== "Transfers") {
            if (tx.category === 'Other') {
                if (tx.amount < 0) expData[tx.category] = (expData[tx.category] || 0) + Math.abs(tx.amount);
                else incData[tx.category] = (incData[tx.category] || 0) + tx.amount;
            } else if (EXPENSE_CATS.includes(tx.category)) {
                expData[tx.category] = (expData[tx.category] || 0) + Math.abs(tx.amount);
            } else if (INCOME_CATS.includes(tx.category)) {
                incData[tx.category] = (incData[tx.category] || 0) + tx.amount;
            } else if (tx.amount < 0) {
                expData[tx.category] = (expData[tx.category] || 0) + Math.abs(tx.amount);
            } else {
                incData[tx.category] = (incData[tx.category] || 0) + tx.amount;
            }
        }
    });

    const renderPie = (canvas, data) => {
        const labels = Object.keys(data);
        return new Chart(canvas, { type: 'pie', data: { labels, datasets: [{ data: Object.values(data), backgroundColor: labels.map(getCategoryColor), borderColor: '#000', borderWidth: 2 }] }, options: { plugins: { legend: { position: 'right' } } } });
    };

    if (pieChartExpenses) pieChartExpenses.destroy(); pieChartExpenses = renderPie(document.getElementById("pieChartExpenses"), expData);
    if (pieChartIncome) pieChartIncome.destroy(); pieChartIncome = renderPie(document.getElementById("pieChartIncome"), incData);
}
