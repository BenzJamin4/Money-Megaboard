// ==UserScript==
// @name         Money Megaboard
// @namespace    http://tampermonkey.net/
// @version      2.2.3
// @description  Dynamic multi-account dashboard with smart categorization, advanced transfer detection, and new charts
// @match        *://*/*
// @grant        none
// ==/UserScript==

/*
    CHANGELOG:
    v2.2.3 (Feature/Bug) - ZERO GREY policy enforced (all borders/text black). Added (tag) grouping so "name(fmfcu)" groups under "FMFCU". Removed Groceries/Investment. Fixed Pie Chart to strictly filter by Income/Expense lists and handle refunds. Advanced PayPal sanitizer (removes "Shopping Cart Item" duplicates).
    v2.2.2 (Bug Fixes)   - Fixed category word matching (regex word boundaries). Forced pure white background. Made graphs taller. Split Pie Chart into Income & Expenses. Built-in PayPal CSV sanitizer started.
    v2.2.1 (Bug Fixes)   - Grouped split CSV mappings. Kept account name case sensitivity. Stacked pos/neg bars below 0. Moved Notes to last column.
    v2.2.0 (Feature)     - Split Income/Expense categories. Added Entertainment, Dividends, Clothes+Haircuts, Health. Interactive CSV Column Mapping UI. Editable Notes column. Rewrote CSV parser.
    v2.1.0 (Feature)     - Added localStorage to remember custom categories/isolated items. Added Clear Data button.
    v2.0.1 (Bug Fixes)   - Fixed negative number parsing, grouped split files, unmatched transfers highlight red.
    v2.0.0 (Major)       - Redesign: Unlimited dynamic CSVs, interactive dropdown categories, isolate checkboxes, pie & bar charts, unified transfer rows.
    v1.1.0 (Feature)     - Split checking/savings inputs, basic transfer linking, added table sorting.
    v1.0.0 (Original)    - Initial static checking/savings dashboard.
*/

(function () {
    'use strict';
    if (!location.href.includes("fmfcu-dashboard")) return;

    // Force strict black & white baseline
    document.body.style.backgroundColor = "#ffffff";
    document.body.style.color = "#000000";

    document.body.innerHTML = `
        <div style="max-width: 1300px; margin: 0 auto; font-family: sans-serif; padding: 20px; background-color: #ffffff; color: #000000;">
            <h2 style="color: #000000; border-bottom: 2px solid #000000; padding-bottom: 5px;">Money Megaboard v2.2.3</h2>

            <div style="margin-bottom: 30px; padding: 15px; background: #ffffff; border: 2px solid #000000;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <strong>Upload All Account CSVs:</strong><br>
                        <span style="font-size: 12px; color: #000000;">Files sharing a tag like "name(fmfcu)" will be mapped together.</span><br><br>
                        <input type="file" id="csvFiles" accept=".csv" multiple style="color: #000000; border: 1px solid #000000; padding: 5px;" />
                    </div>
                    <div>
                        <button id="clearStorageBtn" style="padding: 8px 12px; background: #e74c3c; color: #ffffff; border: 2px solid #000000; cursor: pointer; font-weight: bold;">
                            Clear Saved Data
                        </button>
                    </div>
                </div>
                <div id="mappingContainer" style="margin-top: 15px; display: none; background: #ffffff; padding: 15px; border: 2px dashed #000000;">
                    <h3 style="margin-top: 0; color: #000000;">Map CSV Columns</h3>
                    <div id="mappingList"></div>
                    <button id="processMappedDataBtn" style="margin-top: 15px; padding: 8px 15px; background: #27ae60; color: #ffffff; border: 2px solid #000000; cursor: pointer; font-weight: bold;">
                        Confirm Mappings & Load Data
                    </button>
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 40px; margin-bottom: 40px;">
                <div style="width: 100%; background: #ffffff; padding: 15px; border: 2px solid #000000; height: 500px; box-sizing: border-box;">
                    <canvas id="netWorthChart"></canvas>
                </div>
                <div style="width: 100%; background: #ffffff; padding: 15px; border: 2px solid #000000; height: 500px; box-sizing: border-box;">
                    <canvas id="posNegChart"></canvas>
                </div>
            </div>

            <div style="margin-bottom: 30px; padding: 15px; background: #ffffff; border: 2px solid #000000;">
                <h3 style="color: #000000;">Category Breakdown</h3>
                <label style="font-weight: bold;">Start: <input type="date" id="startDate" style="border: 1px solid #000000; color: #000000; padding: 2px;"></label>
                <label style="margin-left: 10px; font-weight: bold;">End: <input type="date" id="endDate" style="border: 1px solid #000000; color: #000000; padding: 2px;"></label>
                <button id="updatePieBtn" style="margin-left: 10px; padding: 5px 10px; border: 2px solid #000000; background: #000000; color: #ffffff; cursor: pointer; font-weight: bold;">Update Pie Charts</button>

                <div style="display: flex; justify-content: space-around; flex-wrap: wrap; margin-top: 20px;">
                    <div style="width: 45%; min-width: 300px; text-align: center;">
                        <h4 style="color: #000000; text-decoration: underline;">Spending (Expenses)</h4>
                        <canvas id="pieChartExpenses"></canvas>
                    </div>
                    <div style="width: 45%; min-width: 300px; text-align: center;">
                        <h4 style="color: #000000; text-decoration: underline;">Income</h4>
                        <canvas id="pieChartIncome"></canvas>
                    </div>
                </div>
            </div>

            <h3 style="color: #000000;">Transactions</h3>
            <div id="tableContainer" style="max-height:600px; overflow:auto; border:2px solid #000000; position:relative;">
                <table border="1" style="font-size:12px; width:100%; border-collapse:collapse; text-align: left; background: #ffffff; border: 1px solid #000000;">
                    <thead style="position:sticky; top:0; background:#ffffff; z-index:1;">
                        <tr style="border-bottom: 3px solid #000000;">
                            <th style="padding: 8px; text-align:center; border: 1px solid #000000; color: #000000;">Isolate</th>
                            <th style="padding: 8px; border: 1px solid #000000; color: #000000;">Date</th>
                            <th style="padding: 8px; border: 1px solid #000000; color: #000000;">Description</th>
                            <th style="padding: 8px; border: 1px solid #000000; color: #000000;">Amount</th>
                            <th style="padding: 8px; min-width: 140px; border: 1px solid #000000; color: #000000;">Category</th>
                            <th style="padding: 8px; border: 1px solid #000000; color: #000000;">Account</th>
                            <th style="padding: 8px; width: 25%; border: 1px solid #000000; color: #000000;">Notes</th>
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

    let netChart, posNegChart, pieChartExpenses, pieChartIncome;
    let allTransactions = [];
    let pendingGroups = {};

    // Removed Groceries and Investment
    const INCOME_CATS = ["Income", "Dividends", "Transfers", "Other"];
    const EXPENSE_CATS = ["Food", "Transportation", "Shopping", "Education", "Subscription", "Entertainment", "Clothes+Haircuts", "Health", "Transfers", "Other"];

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
            pendingGroups = {};

            for (let file of files) {
                const text = await file.text();
                let rawName = file.name.replace(/\.[^/.]+$/, "");
                let baseName = rawName.replace(/#\d+$/, "").trim();

                // Grouping by (tag) like checking(fmfcu) -> "fmfcu"
                let groupMatch = baseName.match(/\(([^)]+)\)/);
                let mappingKey = groupMatch ? `group_${groupMatch[1].toLowerCase()}` : baseName.toLowerCase();
                let displayName = groupMatch ? `Group: ${groupMatch[1].toUpperCase()}` : baseName;

                const rows = text.trim().split("\n");
                const headers = splitCSVRow(rows[0]).map(h => h.trim());

                if (!pendingGroups[mappingKey]) {
                    pendingGroups[mappingKey] = {
                        mappingKey: mappingKey,
                        displayName: displayName,
                        headers: headers,
                        filesData: []
                    };
                }
                pendingGroups[mappingKey].filesData.push({ file, rows, accountName: baseName });
            }
            renderMappingUI();
        });

        document.getElementById("processMappedDataBtn").addEventListener("click", () => {
            saveMappingsFromUI();
            processPendingFiles();
        });

        document.getElementById("updatePieBtn").addEventListener("click", updatePieCharts);

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

        Object.values(pendingGroups).forEach((group, index) => {
            const savedMap = csvMappings[group.mappingKey] || {};
            const headerOptions = `<option value="">-- None --</option>` + group.headers.map(h => `<option value="${h}">${h}</option>`).join('');

            const guess = (keywords) => group.headers.find(h => keywords.some(k => h.toLowerCase().includes(k))) || "";

            const defDate = savedMap.date || guess(["date"]);
            const defDesc = savedMap.desc || guess(["description", "name", "title"]);
            const defAmt = savedMap.amount || guess(["amount", "total", "net"]);
            const defNotes = savedMap.notes || guess(["item title", "memo", "note"]);
            const defDebit = savedMap.debit || guess(["debit"]);
            const defCredit = savedMap.credit || guess(["credit"]);

            const fileDiv = document.createElement("div");
            fileDiv.style.marginBottom = "15px";
            fileDiv.style.padding = "10px";
            fileDiv.style.border = "2px solid #000000";

            fileDiv.innerHTML = `
                <div style="font-weight: bold; margin-bottom: 5px; color: #000000;">${group.displayName} <span style="font-size:12px; font-weight:normal;">(${group.filesData.length} file(s) mapped together)</span></div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 5px;">
                    <label style="color:#000;">Date: <select class="map-sel" data-type="date" data-group="${group.mappingKey}" style="border: 1px solid #000;">${headerOptions}</select></label>
                    <label style="color:#000;">Description: <select class="map-sel" data-type="desc" data-group="${group.mappingKey}" style="border: 1px solid #000;">${headerOptions}</select></label>
                    <label style="color:#000;">Amount: <select class="map-sel" data-type="amount" data-group="${group.mappingKey}" style="border: 1px solid #000;">${headerOptions}</select></label>
                    <label style="color:#000;">Notes: <select class="map-sel" data-type="notes" data-group="${group.mappingKey}" style="border: 1px solid #000;">${headerOptions}</select></label>
                    <label style="color: #000000; font-size: 11px;">(Alt) Debit: <select class="map-sel" data-type="debit" data-group="${group.mappingKey}" style="border: 1px solid #000;">${headerOptions}</select></label>
                    <label style="color: #000000; font-size: 11px;">(Alt) Credit: <select class="map-sel" data-type="credit" data-group="${group.mappingKey}" style="border: 1px solid #000;">${headerOptions}</select></label>
                </div>
                <div class="unused-cols" style="font-size: 11px; color: #000000; font-weight: bold;"></div>
            `;

            list.appendChild(fileDiv);

            fileDiv.querySelector(`select[data-type="date"]`).value = defDate;
            fileDiv.querySelector(`select[data-type="desc"]`).value = defDesc;
            fileDiv.querySelector(`select[data-type="amount"]`).value = defAmt;
            fileDiv.querySelector(`select[data-type="notes"]`).value = defNotes;
            fileDiv.querySelector(`select[data-type="debit"]`).value = defDebit;
            fileDiv.querySelector(`select[data-type="credit"]`).value = defCredit;

            updateUnusedColumns(fileDiv, group.headers);
            fileDiv.querySelectorAll('.map-sel').forEach(sel => {
                sel.addEventListener('change', () => updateUnusedColumns(fileDiv, group.headers));
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
        Object.keys(pendingGroups).forEach(groupKey => {
            const selects = document.querySelectorAll(`select[data-group="${groupKey}"]`);
            const map = {};
            selects.forEach(s => map[s.getAttribute('data-type')] = s.value);
            csvMappings[groupKey] = map;
        });
        localStorage.setItem("mm_csvMappings", JSON.stringify(csvMappings));
    }

    function processPendingFiles() {
        let parsedData = [];
        Object.values(pendingGroups).forEach(group => {
            const map = csvMappings[group.mappingKey];
            group.filesData.forEach(fileData => {
                parsedData = parsedData.concat(parseCSVData(fileData.rows, group.headers, fileData.accountName, map));
            });
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

        const statusIdx = headers.findIndex(h => h.toLowerCase() === "status");
        const typeIdx = headers.findIndex(h => h.toLowerCase() === "type");

        for (let i = 1; i < rows.length; i++) {
            if (!rows[i].trim()) continue;
            const cols = splitCSVRow(rows[i]);

            // --- Advanced PayPal Junk Sanitizer ---
            if (statusIdx !== -1 && cols[statusIdx]) {
                const status = cols[statusIdx].toLowerCase();
                if (status === "pending" || status === "denied" || status === "canceled") continue;
            }
            if (typeIdx !== -1 && cols[typeIdx]) {
                const type = cols[typeIdx].toLowerCase();
                // "Shopping Cart Item" is the duplicate itemized row for a purchase
                if (type.includes("shopping cart item") || type.includes("authorization") || type.includes("hold") || type.includes("currency conversion")) continue;
            }
            // --------------------------------------

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

        const hasWord = (word) => new RegExp(`\\b${word}\\b`).test(d);
        const hasText = (text) => d.includes(text);

        if (hasText("transfer") || hasText("zelle") || hasText("venmo")) return "Transfers";
        if (hasText("deposit") || hasText("payroll") || hasText("salary")) return "Income";
        if (hasText("dividend") || hasText("interest")) return "Dividends";

        // Removed Groceries, mapping previous grocery keywords to Food
        if (hasText("wawa") || hasText("restaurant") || hasText("pizza") || hasText("mcdonald") || hasText("starbucks") || hasWord("applebee") || hasText("sheetz") || hasText("market") || hasText("wegmans") || hasText("giant") || hasText("aldi")) return "Food";

        if (hasText("uber") || hasText("lyft") || hasWord("gas") || hasText("sunoco")) return "Transportation";
        if (hasText("amazon") || hasText("target") || hasText("walmart")) return "Shopping";
        if (hasWord("psu") || hasText("tuition") || hasText("cengage")) return "Education";
        if (hasText("netflix") || hasText("spotify") || hasWord("apple") || hasWord("prime") || hasText("hulu") || hasWord("amc")) return "Entertainment";
        if (hasWord("cvs") || hasText("pharmacy") || hasText("doctor") || hasText("hospital")) return "Health";
        if (hasText("hair") || hasText("barber") || hasText("clothes") || hasText("apparel") || hasText("nike") || hasText("h&m")) return "Clothes+Haircuts";

        return amount > 0 ? "Income" : "Other";
    }

    function normalizeDesc(desc) {
        return desc.replace(/[0-9]/g, '').trim().toLowerCase();
    }

    function getCategoryColor(cat, isUnaccountedTransfer = false) {
        if (isUnaccountedTransfer) return "#c0392b";
        const map = {
            Food: "#e74c3c", Transportation: "#f39c12", Shopping: "#9b59b6",
            Education: "#2980b9", Subscription: "#16a085", Transfers: "#0055ff", // Pure vivid blue, NO GREY
            Income: "#27ae60", Dividends: "#20bf6b", Entertainment: "#8e44ad",
            "Clothes+Haircuts": "#e67e22", Health: "#ff4757", Other: "#000000" // Pure black, NO GREY
        };
        return map[cat] || "#000000";
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
            row.style.borderBottom = "1px solid #000000";

            const monthTag = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
            row.setAttribute("data-month", monthTag);

            let amountColor = displayAmount < 0 ? "#e74c3c" : "#27ae60";
            let amountSign = displayAmount > 0 ? "+" : "";
            if (isConsolidatedTransfer) {
                amountColor = "#0055ff"; // Black replaced by vivid blue for consolidated transfers
                amountSign = "";
            }

            const isUnaccountedTransfer = (tx.category === "Transfers" && !isConsolidatedTransfer);
            const bgColor = getCategoryColor(tx.category, isUnaccountedTransfer);

            const applicableCats = tx.amount > 0 ? INCOME_CATS : EXPENSE_CATS;
            let catOptions = applicableCats.map(c => `<option value="${c}" ${tx.category === c ? 'selected' : ''} style="color:#000000; background:#ffffff;">${c}</option>`).join('');

            if (!applicableCats.includes(tx.category)) {
                catOptions += `<option value="${tx.category}" selected style="color:#000000; background:#ffffff;">${tx.category}</option>`;
            }

            row.innerHTML = `
                <td style="padding: 8px; text-align:center; border: 1px solid #000000;">
                    <input type="checkbox" class="isolate-cb" data-id="${tx.id}" ${tx.isolate ? 'checked' : ''} ${isConsolidatedTransfer ? 'disabled' : ''}>
                </td>
                <td style="padding: 8px; border: 1px solid #000000; color: #000000;">${tx.date.toLocaleDateString()}</td>
                <td style="padding: 8px; border: 1px solid #000000; color: #000000;" title="${tx.desc}">${displayDesc.length > 40 ? displayDesc.substring(0,40)+'...' : displayDesc}</td>
                <td style="padding: 8px; border: 1px solid #000000; color:${amountColor}; font-weight:bold;">${amountSign}${displayAmount.toFixed(2)}</td>
                <td style="padding: 5px; border: 1px solid #000000; background:${bgColor};">
                    <select class="cat-select" data-id="${tx.id}" style="padding:3px; width:100%; background:transparent; color:#ffffff; font-weight:bold; border:none; outline:none; cursor:pointer;" ${isConsolidatedTransfer ? 'disabled' : ''}>
                        ${catOptions}
                    </select>
                </td>
                <td style="padding: 8px; border: 1px solid #000000; font-weight: bold; color: #000000;">${displayAccount}</td>
                <td style="padding: 5px; border: 1px solid #000000;">
                    <input type="text" class="note-input" data-id="${tx.id}" value="${tx.notes}" style="width:100%; padding:4px; border:1px solid #000000; box-sizing:border-box; background:#ffffff; color:#000000;" placeholder="Add note...">
                </td>
            `;

            fragment.appendChild(row);
        });

        txnTable.appendChild(fragment);

        document.querySelectorAll('.cat-select').forEach(sel => sel.addEventListener('change', handleCategoryChange));
        document.querySelectorAll('.isolate-cb').forEach(cb => cb.addEventListener('change', handleIsolateChange));
        document.querySelectorAll('.note-input').forEach(input => input.addEventListener('change', handleNoteChange));
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

    function scrollToMonth(month) {
        const row = document.querySelector(`tr[data-month="${month}"]`);
        if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "start" });
            row.style.transition = "background-color 0.5s";
            row.style.backgroundColor = "#fff3cd"; // Temporary yellow flash to highlight row
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

            if (!tx.isTransfer && tx.category !== "Transfers") {
                if (tx.amount > 0) monthlyData[month].pos += tx.amount;
                if (tx.amount < 0) monthlyData[month].neg += tx.amount;
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
                maintainAspectRatio: false,
                color: '#000000',
                scales: { x: { ticks: { color: '#000' } }, y: { ticks: { color: '#000' } } },
                plugins: { legend: { labels: { color: '#000' } } },
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
                maintainAspectRatio: false,
                color: '#000000',
                scales: {
                    x: { stacked: true, ticks: { color: '#000' } },
                    y: { stacked: true, ticks: { color: '#000' } }
                },
                plugins: { legend: { labels: { color: '#000' } } },
                onClick: (event, elements) => {
                    if (elements.length > 0) scrollToMonth(months[elements[0].index]);
                }
            }
        });

        updatePieCharts();
    }

    function updatePieCharts() {
        if (allTransactions.length === 0) return;

        const startStr = document.getElementById("startDate").value;
        const endStr = document.getElementById("endDate").value;

        const start = startStr ? new Date(startStr) : new Date(0);
        const end = endStr ? new Date(endStr) : new Date();
        end.setHours(23, 59, 59);

        const expensesData = {};
        const incomeData = {};

        allTransactions.forEach(tx => {
            if (!tx.isTransfer && tx.date >= start && tx.date <= end && tx.category !== "Transfers") {
                // Strict sorting based on designated Category arrays
                if (INCOME_CATS.includes(tx.category) && tx.category !== "Other") {
                    if (!incomeData[tx.category]) incomeData[tx.category] = 0;
                    incomeData[tx.category] += tx.amount;
                } else if (EXPENSE_CATS.includes(tx.category) && tx.category !== "Other") {
                    if (!expensesData[tx.category]) expensesData[tx.category] = 0;
                    expensesData[tx.category] -= tx.amount; // -(-50) = 50. A positive refund (-10) drops the slice size
                }
            }
        });

        // Filter out slices that drop at or below 0 (e.g. if refunds exceed purchases)
        Object.keys(expensesData).forEach(k => { if (expensesData[k] <= 0) delete expensesData[k]; });
        Object.keys(incomeData).forEach(k => { if (incomeData[k] <= 0) delete incomeData[k]; });

        // Render Expenses Pie
        const expLabels = Object.keys(expensesData);
        const expVals = Object.values(expensesData);
        const expColors = expLabels.map(label => getCategoryColor(label));

        if (pieChartExpenses) pieChartExpenses.destroy();
        pieChartExpenses = new Chart(document.getElementById("pieChartExpenses"), {
            type: "pie",
            data: {
                labels: expLabels,
                datasets: [{ data: expVals, backgroundColor: expColors, borderColor: '#000000', borderWidth: 1 }]
            },
            options: { plugins: { legend: { position: 'right', labels: { color: '#000000' } } } }
        });

        // Render Income Pie
        const incLabels = Object.keys(incomeData);
        const incVals = Object.values(incomeData);
        const incColors = incLabels.map(label => getCategoryColor(label));

        if (pieChartIncome) pieChartIncome.destroy();
        pieChartIncome = new Chart(document.getElementById("pieChartIncome"), {
            type: "pie",
            data: {
                labels: incLabels,
                datasets: [{ data: incVals, backgroundColor: incColors, borderColor: '#000000', borderWidth: 1 }]
            },
            options: { plugins: { legend: { position: 'right', labels: { color: '#000000' } } } }
        });
    }
})();