// ==UserScript==
// @name         Money Megaboard
// @namespace    http://tampermonkey.net/
// @version      2.2.0
// @description  Dynamic multi-account dashboard with smart categorization, advanced transfer detection, and new charts
// @match        *://*/*
// @grant        none
// ==/UserScript==

/*
    CHANGELOG:
    v2.2.0 (Feature)   - Split Income/Expense categories. Added Entertainment, Dividends, Clothes+Haircuts, Health. Added interactive CSV Column Mapping UI. Added editable Notes column. Fixed chart clicking bug. Rewrote CSV parser to perfectly handle commas and empty cells.
    v2.1.0 (Feature)   - Renamed to "Money Megaboard". Added localStorage to remember custom categories and isolated items. Added Clear Data button. Reverted CSV parsing logic.
    v2.0.1 (Bug Fixes) - Fixed negative number parsing, grouped split files (e.g., PayPal#1 -> paypal), unmatched transfers now highlight red.
    v2.0.0 (Major)     - Redesign: Unlimited dynamic CSVs, interactive dropdown categories, isolate checkboxes, pie & bar charts, unified transfer rows.
    v1.1.0 (Feature)   - Split checking/savings inputs, basic transfer linking, added table sorting.
    v1.0.0 (Original)  - Initial static checking/savings dashboard.
*/

(function () {
    'use strict';
    if (!location.href.includes("fmfcu-dashboard")) return;

    document.body.innerHTML = `
        <div style="max-width: 1300px; margin: 0 auto; font-family: sans-serif; padding: 20px;">
            <h2>Money Megaboard v2.2.0</h2>

            <div style="margin-bottom: 20px; padding: 15px; background: #f4f6f7; border: 1px solid #dcdde1; border-radius: 5px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <strong>Upload All Account CSVs:</strong><br>
                        <small>Select all your CSVs at once. The filename will become the account name.</small><br><br>
                        <input type="file" id="csvFiles" accept=".csv" multiple />
                    </div>
                    <div>
                        <button id="clearStorageBtn" style="padding: 8px 12px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">
                            Clear Saved Data
                        </button>
                    </div>
                </div>
                <div id="mappingContainer" style="margin-top: 15px; display: none; background: #fff; padding: 15px; border: 1px solid #ccc; border-radius: 4px;">
                    <h3 style="margin-top: 0;">Map CSV Columns</h3>
                    <div id="mappingList"></div>
                    <button id="processMappedDataBtn" style="margin-top: 15px; padding: 8px 15px; background: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        Confirm Mappings & Load Data
                    </button>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                <div>
                    <canvas id="netWorthChart"></canvas>
                </div>
                <div>
                    <canvas id="posNegChart"></canvas>
                </div>
            </div>

            <div style="margin-bottom: 20px; padding: 15px; background: #fff; border: 1px solid #dcdde1; border-radius: 5px;">
                <h3>Category Spending Breakdown</h3>
                <label>Start: <input type="date" id="startDate"></label>
                <label style="margin-left: 10px;">End: <input type="date" id="endDate"></label>
                <button id="updatePieBtn" style="margin-left: 10px; padding: 5px 10px;">Update Pie Chart</button>
                <div style="max-width: 400px; margin: 0 auto;">
                    <canvas id="pieChart"></canvas>
                </div>
            </div>

            <h3>Transactions</h3>
            <div id="tableContainer" style="max-height:500px; overflow:auto; border:1px solid #ccc; position:relative;">
                <table border="1" style="font-size:12px; width:100%; border-collapse:collapse; text-align: left;">
                    <thead style="position:sticky; top:0; background:#fff; z-index:1; box-shadow: 0 2px 2px -1px rgba(0,0,0,0.2);">
                        <tr>
                            <th style="padding: 8px; text-align:center;" title="Check to prevent bulk category updates from affecting this row">Isolate</th>
                            <th style="padding: 8px;">Date</th>
                            <th style="padding: 8px;">Description</th>
                            <th style="padding: 8px;">Amount</th>
                            <th style="padding: 8px;">Category</th>
                            <th style="padding: 8px; width: 20%;">Notes</th>
                            <th style="padding: 8px;">Account</th>
                        </tr>
                    </thead>
                    <tbody id="txnTable"></tbody>
                </table>
            </div>
        </div>
    `;

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js";
    document.head.appendChild(script);

    let netChart, posNegChart, pieChart;
    let allTransactions = [];
    let pendingFiles = [];

    const INCOME_CATS = ["Income", "Dividends", "Transfers", "Other"];
    const EXPENSE_CATS = ["Food", "Groceries", "Transportation", "Shopping", "Education", "Subscription", "Investment", "Entertainment", "Clothes+Haircuts", "Health", "Transfers", "Other"];

    // --- Local Storage Initialization ---
    let customCategoryMap = JSON.parse(localStorage.getItem("mm_customCategories")) || {};
    let isolatedMap = JSON.parse(localStorage.getItem("mm_isolatedTxs")) || {};
    let csvMappings = JSON.parse(localStorage.getItem("mm_csvMappings")) || {};
    let customNotes = JSON.parse(localStorage.getItem("mm_customNotes")) || {};

    script.onload = () => {
        setupEventListeners();
    };

    function setupEventListeners() {
        document.getElementById("csvFiles").addEventListener("change", async e => {
            const files = e.target.files;
            if (!files.length) return;
            pendingFiles = [];

            for (let file of files) {
                const text = await file.text();
                let accountName = file.name.replace(/\.[^/.]+$/, "").toLowerCase();
                accountName = accountName.replace(/#\d+$/, "").trim();

                const rows = text.trim().split("\n");
                const headers = splitCSVRow(rows[0]).map(h => h.trim());

                pendingFiles.push({ file, text, accountName, headers, rows });
            }
            renderMappingUI();
        });

        document.getElementById("processMappedDataBtn").addEventListener("click", () => {
            saveMappingsFromUI();
            processPendingFiles();
        });

        document.getElementById("updatePieBtn").addEventListener("click", updatePieChart);

        document.getElementById("clearStorageBtn").addEventListener("click", () => {
            if(confirm("Are you sure you want to clear ALL saved categories, isolated rules, mappings, and notes?")) {
                localStorage.removeItem("mm_customCategories");
                localStorage.removeItem("mm_isolatedTxs");
                localStorage.removeItem("mm_csvMappings");
                localStorage.removeItem("mm_customNotes");
                customCategoryMap = {};
                isolatedMap = {};
                csvMappings = {};
                customNotes = {};
                alert("Saved data cleared! Please refresh or re-upload.");
            }
        });
    }

    // --- CSV File Mapping & Parsing ---

    // Robust CSV row splitter that handles quoted commas and empty cells natively
    function splitCSVRow(row) {
        let result = [];
        let inQuotes = false;
        let current = "";
        for (let i = 0; i < row.length; i++) {
            let char = row[i];
            if (char === '"') {
                if (inQuotes && row[i+1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = "";
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    function renderMappingUI() {
        const container = document.getElementById("mappingContainer");
        const list = document.getElementById("mappingList");
        list.innerHTML = "";
        container.style.display = "block";

        pendingFiles.forEach((pf, index) => {
            const savedMap = csvMappings[pf.accountName] || {};
            const headerOptions = `<option value="">-- None --</option>` + pf.headers.map(h => `<option value="${h}">${h}</option>`).join('');

            // Auto-guess if no saved mapping
            const guess = (keywords) => pf.headers.find(h => keywords.some(k => h.toLowerCase().includes(k))) || "";

            const defDate = savedMap.date || guess(["date"]);
            const defDesc = savedMap.desc || guess(["description", "name", "title"]);
            const defAmt = savedMap.amount || guess(["amount", "total", "net"]);
            const defNotes = savedMap.notes || guess(["item title", "memo", "note"]);
            const defDebit = savedMap.debit || guess(["debit"]);
            const defCredit = savedMap.credit || guess(["credit"]);

            const fileDiv = document.createElement("div");
            fileDiv.style.marginBottom = "15px";
            fileDiv.style.padding = "10px";
            fileDiv.style.backgroundColor = "#f9f9f9";
            fileDiv.style.border = "1px dashed #ccc";

            fileDiv.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 5px; color: #2980b9;">${pf.accountName.toUpperCase()} (File: ${pf.file.name})</div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 5px;">
                    <label>Date: <select class="map-sel" data-type="date" data-idx="${index}">${headerOptions}</select></label>
                    <label>Description: <select class="map-sel" data-type="desc" data-idx="${index}">${headerOptions}</select></label>
                    <label>Amount: <select class="map-sel" data-type="amount" data-idx="${index}">${headerOptions}</select></label>
                    <label>Notes: <select class="map-sel" data-type="notes" data-idx="${index}">${headerOptions}</select></label>
                    <label style="color: #7f8c8d; font-size: 11px;">(Alt) Debit: <select class="map-sel" data-type="debit" data-idx="${index}">${headerOptions}</select></label>
                    <label style="color: #7f8c8d; font-size: 11px;">(Alt) Credit: <select class="map-sel" data-type="credit" data-idx="${index}">${headerOptions}</select></label>
                </div>
                <div class="unused-cols" style="font-size: 11px; color: #e74c3c;"></div>
            `;

            list.appendChild(fileDiv);

            // Set default values
            fileDiv.querySelector(`select[data-type="date"]`).value = defDate;
            fileDiv.querySelector(`select[data-type="desc"]`).value = defDesc;
            fileDiv.querySelector(`select[data-type="amount"]`).value = defAmt;
            fileDiv.querySelector(`select[data-type="notes"]`).value = defNotes;
            fileDiv.querySelector(`select[data-type="debit"]`).value = defDebit;
            fileDiv.querySelector(`select[data-type="credit"]`).value = defCredit;

            updateUnusedColumns(fileDiv, pf.headers);

            fileDiv.querySelectorAll('.map-sel').forEach(sel => {
                sel.addEventListener('change', () => updateUnusedColumns(fileDiv, pf.headers));
            });
        });
    }

    function updateUnusedColumns(fileDiv, headers) {
        const selects = Array.from(fileDiv.querySelectorAll('.map-sel'));
        const used = selects.map(s => s.value).filter(v => v !== "");
        const unused = headers.filter(h => !used.includes(h));
        fileDiv.querySelector('.unused-cols').innerText = `Unused Columns: ${unused.length ? unused.join(", ") : "None"}`;
    }

    function saveMappingsFromUI() {
        pendingFiles.forEach((pf, index) => {
            const selects = document.querySelectorAll(`select[data-idx="${index}"]`);
            const map = {};
            selects.forEach(s => map[s.getAttribute('data-type')] = s.value);
            csvMappings[pf.accountName] = map;
        });
        localStorage.setItem("mm_csvMappings", JSON.stringify(csvMappings));
    }

    function processPendingFiles() {
        let parsedData = [];
        pendingFiles.forEach(pf => {
            const map = csvMappings[pf.accountName];
            parsedData = parsedData.concat(parseCSVData(pf.rows, pf.headers, pf.accountName, map));
        });

        document.getElementById("mappingContainer").style.display = "none";
        allTransactions = parsedData;

        detectTransfers(allTransactions);
        allTransactions.sort((a, b) => b.date - a.date);

        if (allTransactions.length > 0) {
            const startInput = document.getElementById("startDate");
            const endInput = document.getElementById("endDate");
            if (!startInput.value) startInput.value = allTransactions[allTransactions.length-1].date.toISOString().split('T')[0];
            if (!endInput.value) endInput.value = allTransactions[0].date.toISOString().split('T')[0];
        }

        renderTable();
        updateCharts();
    }

    function parseCSVData(rows, headers, accountName, map) {
        const data = [];
        const dateIdx = headers.indexOf(map.date);
        const descIdx = headers.indexOf(map.desc);
        const amtIdx = headers.indexOf(map.amount);
        const debitIdx = headers.indexOf(map.debit);
        const creditIdx = headers.indexOf(map.credit);
        const notesIdx = headers.indexOf(map.notes);

        for (let i = 1; i < rows.length; i++) {
            if (!rows[i].trim()) continue;
            const cols = splitCSVRow(rows[i]);

            if (dateIdx === -1 || !cols[dateIdx]) continue;
            const date = new Date(cols[dateIdx]);
            if (isNaN(date)) continue;

            let amount = 0;
            if (amtIdx !== -1 && cols[amtIdx]) {
                amount = parseAmount(cols[amtIdx]);
            } else {
                const debit = debitIdx !== -1 && cols[debitIdx] ? parseAmount(cols[debitIdx]) : 0;
                const credit = creditIdx !== -1 && cols[creditIdx] ? parseAmount(cols[creditIdx]) : 0;
                amount = credit - debit;
            }

            const rawDesc = descIdx !== -1 ? (cols[descIdx] || "") : "";
            const rawNotes = notesIdx !== -1 ? (cols[notesIdx] || "") : "";
            const normalizedDesc = normalizeDesc(rawDesc);

            const safeDesc = rawDesc.replace(/[^a-zA-Z0-9]/g, '');
            const txId = `${date.getTime()}_${amount}_${safeDesc}`;

            let category = guessCategory(rawDesc, amount);
            let isolate = false;

            if (isolatedMap[txId]) {
                category = isolatedMap[txId].category;
                isolate = isolatedMap[txId].isolate;
            }

            let finalNotes = customNotes[txId] !== undefined ? customNotes[txId] : rawNotes;

            data.push({
                id: txId,
                date,
                desc: rawDesc,
                normalizedDesc: normalizedDesc,
                amount,
                notes: finalNotes,
                balance: null,
                category: category,
                account: accountName,
                isTransfer: false,
                isHidden: false,
                transferPartnerTx: null,
                isolate: isolate
            });
        }
        return data;
    }

    // --- Core Logic ---

    function parseAmount(str) {
        if (!str) return 0;
        const isNegative = str.includes('-') || (str.includes('(') && str.includes(')'));
        const val = parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
        return isNegative ? -Math.abs(val) : Math.abs(val);
    }

    function detectTransfers(transactions) {
        const amountMap = {};

        transactions.forEach(tx => {
            tx.isTransfer = false;
            tx.transferPartnerTx = null;
            tx.isHidden = false;
            const key = `${Math.abs(tx.amount).toFixed(2)}_${tx.date.toLocaleDateString()}`;
            if (!amountMap[key]) amountMap[key] = [];
            amountMap[key].push(tx);
        });

        Object.values(amountMap).forEach(group => {
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    let tx1 = group[i];
                    let tx2 = group[j];

                    if (!tx1.isTransfer && !tx2.isTransfer && tx1.account !== tx2.account &&
                        ((tx1.amount > 0 && tx2.amount < 0) || (tx1.amount < 0 && tx2.amount > 0))) {

                        tx1.isTransfer = true;
                        tx2.isTransfer = true;
                        tx1.transferPartnerTx = tx2;
                        tx2.transferPartnerTx = tx1;

                        if (tx1.amount > 0) tx1.isHidden = true;
                        if (tx2.amount > 0) tx2.isHidden = true;

                        tx1.category = "Transfers";
                        tx2.category = "Transfers";
                        break;
                    }
                }
            }
        });
    }

    function guessCategory(desc, amount) {
        const d = desc.toLowerCase();
        const normalizedDesc = normalizeDesc(desc);

        if (customCategoryMap[normalizedDesc]) return customCategoryMap[normalizedDesc];

        if (d.includes("transfer") || d.includes("zelle") || d.includes("venmo")) return "Transfers";
        if (d.includes("deposit") || d.includes("payroll") || d.includes("salary")) return "Income";
        if (d.includes("dividend") || d.includes("interest")) return "Dividends";
        if (d.includes("wawa") || d.includes("restaurant") || d.includes("pizza") || d.includes("mcdonald") || d.includes("starbucks")) return "Food";
        if (d.includes("sheetz") || d.includes("market") || d.includes("wegmans") || d.includes("giant") || d.includes("aldi")) return "Groceries";
        if (d.includes("uber") || d.includes("lyft") || d.includes("gas") || d.includes("sunoco")) return "Transportation";
        if (d.includes("amazon") || d.includes("target") || d.includes("walmart")) return "Shopping";
        if (d.includes("psu") || d.includes("tuition") || d.includes("cengage")) return "Education";
        if (d.includes("netflix") || d.includes("spotify") || d.includes("apple") || d.includes("prime") || d.includes("hulu") || d.includes("amc")) return "Entertainment";
        if (d.includes("cvs") || d.includes("pharmacy") || d.includes("doctor") || d.includes("hospital")) return "Health";
        if (d.includes("hair") || d.includes("barber") || d.includes("clothes") || d.includes("apparel") || d.includes("nike") || d.includes("h&m")) return "Clothes+Haircuts";
        if (d.includes("fidelity") || d.includes("vanguard") || d.includes("robinhood")) return "Investment";

        return amount > 0 ? "Income" : "Other";
    }

    function normalizeDesc(desc) {
        return desc.replace(/[0-9]/g, '').trim().toLowerCase();
    }

    // --- UI Renderers ---

    function getCategoryColor(cat, isUnaccountedTransfer = false) {
        if (isUnaccountedTransfer) return "#c0392b";
        const map = {
            Food: "#e74c3c", Groceries: "#d35400", Transportation: "#f39c12", Shopping: "#9b59b6",
            Education: "#2980b9", Subscription: "#16a085", Investment: "#2ecc71", Transfers: "#7f8c8d",
            Income: "#27ae60", Dividends: "#20bf6b", Entertainment: "#8e44ad", "Clothes+Haircuts": "#e67e22", Health: "#ff4757", Other: "#34495e"
        };
        return map[cat] || "#34495e";
    }

    function renderTable() {
        const txnTable = document.getElementById("txnTable");
        txnTable.innerHTML = "";
        const fragment = document.createDocumentFragment();

        allTransactions.forEach(tx => {
            if (tx.isHidden) return;

            let displayAccount = tx.account;
            let displayDesc = tx.desc;
            let displayAmount = tx.amount;
            let isConsolidatedTransfer = false;

            if (tx.isTransfer && tx.transferPartnerTx) {
                const partner = tx.transferPartnerTx;
                const sourceAcc = tx.amount < 0 ? tx.account : partner.account;
                const destAcc = tx.amount > 0 ? tx.account : partner.account;

                displayAccount = "Transfer";
                displayDesc = `$${Math.abs(tx.amount).toFixed(2)} transfer: ${sourceAcc} -> ${destAcc}`;
                displayAmount = Math.abs(tx.amount);
                isConsolidatedTransfer = true;
            }

            const row = document.createElement("tr");
            const monthTag = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
            row.setAttribute("data-month", monthTag);

            let amountColor = displayAmount < 0 ? "#e74c3c" : "#27ae60";
            let amountSign = displayAmount > 0 ? "+" : "";
            if (isConsolidatedTransfer) {
                amountColor = "#2980b9";
                amountSign = "";
            }

            const isUnaccountedTransfer = (tx.category === "Transfers" && !isConsolidatedTransfer);
            const bgColor = getCategoryColor(tx.category, isUnaccountedTransfer);

            const applicableCats = tx.amount > 0 ? INCOME_CATS : EXPENSE_CATS;
            let catOptions = applicableCats.map(c => `<option value="${c}" ${tx.category === c ? 'selected' : ''} style="color:#333; background:#fff;">${c}</option>`).join('');

            // In case the chosen category isn't in the split list (e.g. edge case saved categories), inject it
            if (!applicableCats.includes(tx.category)) {
                catOptions += `<option value="${tx.category}" selected style="color:#333; background:#fff;">${tx.category}</option>`;
            }

            row.innerHTML = `
                <td style="padding: 8px; text-align:center;">
                    <input type="checkbox" class="isolate-cb" data-id="${tx.id}" ${tx.isolate ? 'checked' : ''} ${isConsolidatedTransfer ? 'disabled' : ''}>
                </td>
                <td style="padding: 8px;">${tx.date.toLocaleDateString()}</td>
                <td style="padding: 8px;" title="${tx.desc}">${displayDesc.length > 40 ? displayDesc.substring(0,40)+'...' : displayDesc}</td>
                <td style="padding: 8px; color:${amountColor}; font-weight:bold;">${amountSign}${displayAmount.toFixed(2)}</td>
                <td style="padding: 5px; background:${bgColor};">
                    <select class="cat-select" data-id="${tx.id}" style="padding:3px; width:100%; border-radius:3px; background:transparent; color:#fff; font-weight:bold; border:none; outline:none; cursor:pointer;" ${isConsolidatedTransfer ? 'disabled' : ''}>
                        ${catOptions}
                    </select>
                </td>
                <td style="padding: 5px;">
                    <input type="text" class="note-input" data-id="${tx.id}" value="${tx.notes}" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:3px;" placeholder="Add note...">
                </td>
                <td style="padding: 8px; font-weight: bold; color: ${displayAccount === 'Transfer' ? '#2980b9' : '#2c3e50'};">${displayAccount}</td>
            `;

            fragment.appendChild(row);
        });

        txnTable.appendChild(fragment);

        document.querySelectorAll('.cat-select').forEach(sel => sel.addEventListener('change', handleCategoryChange));
        document.querySelectorAll('.isolate-cb').forEach(cb => cb.addEventListener('change', handleIsolateChange));
        document.querySelectorAll('.note-input').forEach(input => {
            input.addEventListener('change', handleNoteChange);
        });
    }

    function handleNoteChange(e) {
        const id = e.target.getAttribute('data-id');
        const val = e.target.value;
        const tx = allTransactions.find(t => t.id === id);
        if (tx) {
            tx.notes = val;
            customNotes[tx.id] = val;
            localStorage.setItem("mm_customNotes", JSON.stringify(customNotes));
        }
    }

    function handleIsolateChange(e) {
        const id = e.target.getAttribute('data-id');
        const tx = allTransactions.find(t => t.id === id);
        if (tx) {
            tx.isolate = e.target.checked;
            if (tx.isolate) {
                isolatedMap[tx.id] = { isolate: true, category: tx.category };
            } else {
                delete isolatedMap[tx.id];
                tx.category = guessCategory(tx.desc, tx.amount);
            }
            localStorage.setItem("mm_isolatedTxs", JSON.stringify(isolatedMap));
            renderTable();
            updateCharts();
        }
    }

    function handleCategoryChange(e) {
        const id = e.target.getAttribute('data-id');
        const newCat = e.target.value;
        const tx = allTransactions.find(t => t.id === id);
        if (!tx) return;

        tx.category = newCat;

        if (tx.isolate) {
            isolatedMap[tx.id] = { isolate: true, category: newCat };
            localStorage.setItem("mm_isolatedTxs", JSON.stringify(isolatedMap));
        } else {
            customCategoryMap[tx.normalizedDesc] = newCat;
            localStorage.setItem("mm_customCategories", JSON.stringify(customCategoryMap));

            allTransactions.forEach(t => {
                if (t.normalizedDesc === tx.normalizedDesc && !t.isolate && !t.isTransfer) {
                    t.category = newCat;
                }
            });
        }

        renderTable();
        updateCharts();
    }

    // --- Charting Logic ---

    function scrollToMonth(month) {
        const row = document.querySelector(`tr[data-month="${month}"]`);
        if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "start" });
            row.style.transition = "background-color 0.5s";
            row.style.backgroundColor = "#fff3cd";
            setTimeout(() => row.style.backgroundColor = "", 1500);
        }
    }

    function updateCharts() {
        const monthlyData = {};
        const chronTxs = [...allTransactions].sort((a, b) => a.date - b.date);
        const balances = {};

        chronTxs.forEach(tx => {
            const month = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
            if (!monthlyData[month]) {
                monthlyData[month] = { pos: 0, neg: 0, netWorth: 0 };
            }

            balances[tx.account] = (balances[tx.account] || 0) + tx.amount;
            monthlyData[month].netWorth = Object.values(balances).reduce((sum, val) => sum + val, 0);

            if (!tx.isTransfer) {
                if (tx.amount > 0) monthlyData[month].pos += tx.amount;
                if (tx.amount < 0) monthlyData[month].neg += Math.abs(tx.amount);
            }
        });

        const months = Object.keys(monthlyData).sort();

        if (netChart) netChart.destroy();
        netChart = new Chart(document.getElementById("netWorthChart"), {
            type: "line",
            data: {
                labels: months,
                datasets: [{
                    label: "Total Net Worth",
                    data: months.map(m => monthlyData[m].netWorth),
                    borderColor: '#8e44ad',
                    backgroundColor: 'rgba(142, 68, 173, 0.2)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                onClick: (event, elements) => {
                    if (elements.length > 0) scrollToMonth(months[elements[0].index]);
                }
            }
        });

        if (posNegChart) posNegChart.destroy();
        posNegChart = new Chart(document.getElementById("posNegChart"), {
            type: "bar",
            data: {
                labels: months,
                datasets: [
                    {
                        label: "Income (+)",
                        data: months.map(m => monthlyData[m].pos),
                        backgroundColor: '#27ae60'
                    },
                    {
                        label: "Expenses (-)",
                        data: months.map(m => monthlyData[m].neg),
                        backgroundColor: '#e74c3c'
                    }
                ]
            },
            options: {
                onClick: (event, elements) => {
                    if (elements.length > 0) scrollToMonth(months[elements[0].index]);
                }
            }
        });

        updatePieChart();
    }

    function updatePieChart() {
        if (allTransactions.length === 0) return;

        const startStr = document.getElementById("startDate").value;
        const endStr = document.getElementById("endDate").value;

        const start = startStr ? new Date(startStr) : new Date(0);
        const end = endStr ? new Date(endStr) : new Date();
        end.setHours(23, 59, 59);

        const pieCats = {};

        allTransactions.forEach(tx => {
            if (!tx.isTransfer && tx.amount < 0 && tx.date >= start && tx.date <= end) {
                if (!pieCats[tx.category]) pieCats[tx.category] = 0;
                pieCats[tx.category] += Math.abs(tx.amount);
            }
        });

        const labels = Object.keys(pieCats);
        const data = Object.values(pieCats);
        const colors = labels.map(label => getCategoryColor(label));

        if (pieChart) pieChart.destroy();
        pieChart = new Chart(document.getElementById("pieChart"), {
            type: "pie",
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors
                }]
            },
            options: {
                plugins: { legend: { position: 'right' } }
            }
        });
    }
})();