// ==UserScript==
// @name         FMFCU Dashboard v6.0
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  Dynamic multi-account dashboard with smart categorization, advanced transfer detection, and new charts
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (!location.href.includes("fmfcu-dashboard")) return;

    document.body.innerHTML = `
        <div style="max-width: 1200px; margin: 0 auto; font-family: sans-serif; padding: 20px;">
            <h2>FMFCU Financial Dashboard v6.0</h2>

            <div style="margin-bottom: 20px; padding: 15px; background: #f4f6f7; border: 1px solid #dcdde1; border-radius: 5px;">
                <strong>Upload All Account CSVs:</strong><br>
                <small>Select all your CSVs at once. The filename will become the account name (e.g., "venmo.csv" -> "venmo").</small><br><br>
                <input type="file" id="csvFiles" accept=".csv" multiple />
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
            <div id="tableContainer" style="max-height:450px; overflow:auto; border:1px solid #ccc; position:relative;">
                <table border="1" style="font-size:12px; width:100%; border-collapse:collapse; text-align: left;">
                    <thead style="position:sticky; top:0; background:#fff; z-index:1; box-shadow: 0 2px 2px -1px rgba(0,0,0,0.2);">
                        <tr>
                            <th style="padding: 8px; text-align:center;" title="Check to prevent bulk category updates from affecting this row">Isolate</th>
                            <th style="padding: 8px;">Date</th>
                            <th style="padding: 8px;">Description</th>
                            <th style="padding: 8px;">Amount</th>
                            <th style="padding: 8px;">Category</th>
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

    // Default categories
    const CATEGORIES = ["Income", "Food", "Groceries", "Transportation", "Shopping", "Education", "Subscription", "Investment", "Transfers", "Other"];

    // Dictionary to remember bulk category choices
    const customCategoryMap = {};

    script.onload = () => {
        setupEventListeners();
    };

    function setupEventListeners() {
        document.getElementById("csvFiles").addEventListener("change", async e => {
            const files = e.target.files;
            if (!files.length) return;

            let parsedData = [];
            for (let file of files) {
                const text = await file.text();
                const accountName = file.name.replace(/\.[^/.]+$/, "").toLowerCase(); // strip extension
                parsedData = parsedData.concat(parseCSV(text, accountName));
            }

            allTransactions = parsedData;
            processAllData();
        });

        document.getElementById("updatePieBtn").addEventListener("click", updatePieChart);
    }

    function processAllData() {
        detectTransfers(allTransactions);

        // Sort newest first for the table
        allTransactions.sort((a, b) => b.date - a.date);

        // Set default dates for Pie Chart if empty
        if (allTransactions.length > 0) {
            const startInput = document.getElementById("startDate");
            const endInput = document.getElementById("endDate");
            if (!startInput.value) startInput.value = allTransactions[allTransactions.length-1].date.toISOString().split('T')[0];
            if (!endInput.value) endInput.value = allTransactions[0].date.toISOString().split('T')[0];
        }

        renderTable();
        updateCharts();
    }

    // --- Core Logic ---

    function detectTransfers(transactions) {
        const amountMap = {};

        transactions.forEach(tx => {
            tx.isTransfer = false;
            tx.transferPartnerTx = null;
            tx.isHidden = false; // Used to hide one half of the transfer pair in the table
            const key = `${Math.abs(tx.amount).toFixed(2)}_${tx.date.toLocaleDateString()}`;
            if (!amountMap[key]) amountMap[key] = [];
            amountMap[key].push(tx);
        });

        Object.values(amountMap).forEach(group => {
            // Find pairs with opposite signs
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

                        // Hide the positive side so we only render the combined line once
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

    function guessCategory(desc) {
        const d = desc.toLowerCase();

        // Check user overrides first
        const normalizedDesc = normalizeDesc(desc);
        if (customCategoryMap[normalizedDesc]) return customCategoryMap[normalizedDesc];

        if (d.includes("transfer") || d.includes("zelle") || d.includes("venmo")) return "Transfers";
        if (d.includes("deposit") || d.includes("payroll") || d.includes("salary")) return "Income";
        if (d.includes("wawa") || d.includes("restaurant") || d.includes("pizza") || d.includes("mcdonald") || d.includes("starbucks")) return "Food";
        if (d.includes("sheetz") || d.includes("market") || d.includes("wegmans") || d.includes("giant") || d.includes("aldi")) return "Groceries";
        if (d.includes("uber") || d.includes("lyft") || d.includes("gas") || d.includes("sunoco")) return "Transportation";
        if (d.includes("amazon") || d.includes("target") || d.includes("walmart")) return "Shopping";
        if (d.includes("psu") || d.includes("tuition") || d.includes("cengage")) return "Education";
        if (d.includes("netflix") || d.includes("spotify") || d.includes("apple") || d.includes("prime")) return "Subscription";
        if (d.includes("fidelity") || d.includes("vanguard") || d.includes("robinhood")) return "Investment";
        return "Other";
    }

    function normalizeDesc(desc) {
        // Strip out dates, weird numbers, and extra spaces so matching is easier
        return desc.replace(/[0-9]/g, '').trim().toLowerCase();
    }

    function parseCSV(text, accountName) {
        const rows = text.trim().split("\n");
        const headers = rows[0].split(",").map(h => h.trim().toLowerCase());

        const dateIndex = headers.findIndex(h => h.includes("date"));
        const descIndex = headers.findIndex(h => h.includes("description"));
        const amountIndex = headers.findIndex(h => h.includes("amount"));
        const debitIndex = headers.findIndex(h => h.includes("debit"));
        const creditIndex = headers.findIndex(h => h.includes("credit"));
        const balanceIndex = headers.findIndex(h => h.includes("balance"));

        const data = [];
        for (let i = 1; i < rows.length; i++) {
            // Regex handles commas inside quotes (standard CSV format)
            const cols = rows[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(c => c.replace(/(^"|"$)/g, '').trim()) || [];
            if (!cols[dateIndex]) continue;

            const date = new Date(cols[dateIndex]);
            if (isNaN(date)) continue;

            let amount = 0;
            if (amountIndex !== -1 && cols[amountIndex]) {
                amount = parseFloat(cols[amountIndex].replace(/[^0-9.-]+/g,"")) || 0;
            } else {
                const debit = debitIndex !== -1 && cols[debitIndex] ? parseFloat(cols[debitIndex].replace(/[^0-9.-]+/g,"")) || 0 : 0;
                const credit = creditIndex !== -1 && cols[creditIndex] ? parseFloat(cols[creditIndex].replace(/[^0-9.-]+/g,"")) || 0 : 0;
                amount = credit - debit;
            }

            const rawDesc = cols[descIndex] || "";

            data.push({
                id: Math.random().toString(36).substr(2, 9), // unique ID for row tracking
                date,
                desc: rawDesc,
                normalizedDesc: normalizeDesc(rawDesc),
                amount,
                balance: balanceIndex !== -1 && cols[balanceIndex] ? parseFloat(cols[balanceIndex].replace(/[^0-9.-]+/g,"")) : null,
                category: guessCategory(rawDesc),
                account: accountName,
                isTransfer: false,
                isHidden: false,
                transferPartnerTx: null,
                isolate: false // Default to bulk-updating
            });
        }
        return data;
    }

    // --- UI Renderers ---

    function renderTable() {
        const txnTable = document.getElementById("txnTable");
        txnTable.innerHTML = "";
        const fragment = document.createDocumentFragment();

        allTransactions.forEach(tx => {
            if (tx.isHidden) return; // Skip the positive half of transfers

            let displayAccount = tx.account;
            let displayDesc = tx.desc;
            let displayAmount = tx.amount;
            let isConsolidatedTransfer = false;

            if (tx.isTransfer && tx.transferPartnerTx) {
                const partner = tx.transferPartnerTx;
                // tx is the negative one (source), partner is the positive one (dest)
                const sourceAcc = tx.amount < 0 ? tx.account : partner.account;
                const destAcc = tx.amount > 0 ? tx.account : partner.account;

                displayAccount = "Transfer";
                displayDesc = `$${Math.abs(tx.amount).toFixed(2)} transfer: ${sourceAcc} -> ${destAcc}`;
                displayAmount = Math.abs(tx.amount);
                isConsolidatedTransfer = true;
            }

            const row = document.createElement("tr");
            let amountColor = displayAmount < 0 ? "#e74c3c" : "#27ae60";
            let amountSign = displayAmount > 0 ? "+" : "";

            if (isConsolidatedTransfer) {
                amountColor = "#2980b9";
                amountSign = "";
            }

            // Category Dropdown
            let catOptions = CATEGORIES.map(c => `<option value="${c}" ${tx.category === c ? 'selected' : ''}>${c}</option>`).join('');

            row.innerHTML = `
                <td style="padding: 8px; text-align:center;">
                    <input type="checkbox" class="isolate-cb" data-id="${tx.id}" ${tx.isolate ? 'checked' : ''} ${isConsolidatedTransfer ? 'disabled' : ''}>
                </td>
                <td style="padding: 8px;">${tx.date.toLocaleDateString()}</td>
                <td style="padding: 8px;" title="${tx.desc}">${displayDesc.length > 40 ? displayDesc.substring(0,40)+'...' : displayDesc}</td>
                <td style="padding: 8px; color:${amountColor}; font-weight:bold;">${amountSign}${displayAmount.toFixed(2)}</td>
                <td style="padding: 5px;">
                    <select class="cat-select" data-id="${tx.id}" style="padding:3px; border-radius:3px;" ${isConsolidatedTransfer ? 'disabled' : ''}>
                        ${catOptions}
                    </select>
                </td>
                <td style="padding: 8px; font-weight: bold; color: ${displayAccount === 'Transfer' ? '#2980b9' : '#2c3e50'};">${displayAccount}</td>
            `;

            fragment.appendChild(row);
        });

        txnTable.appendChild(fragment);

        // Attach event listeners to new dropdowns and checkboxes
        document.querySelectorAll('.cat-select').forEach(sel => {
            sel.addEventListener('change', handleCategoryChange);
        });
        document.querySelectorAll('.isolate-cb').forEach(cb => {
            cb.addEventListener('change', handleIsolateChange);
        });
    }

    function handleIsolateChange(e) {
        const id = e.target.getAttribute('data-id');
        const tx = allTransactions.find(t => t.id === id);
        if (tx) tx.isolate = e.target.checked;
    }

    function handleCategoryChange(e) {
        const id = e.target.getAttribute('data-id');
        const newCat = e.target.value;
        const tx = allTransactions.find(t => t.id === id);
        if (!tx) return;

        tx.category = newCat;

        // If not isolated, apply to all matching un-isolated transactions
        if (!tx.isolate) {
            customCategoryMap[tx.normalizedDesc] = newCat; // Remember preference

            let changedCount = 0;
            allTransactions.forEach(t => {
                if (t.normalizedDesc === tx.normalizedDesc && !t.isolate && !t.isTransfer) {
                    t.category = newCat;
                    changedCount++;
                }
            });
            console.log(`Updated category for ${changedCount} transactions matching "${tx.normalizedDesc}"`);
        }

        // Re-render to show updated dropdowns and charts
        renderTable();
        updateCharts();
    }

    // --- Charting Logic ---

    function updateCharts() {
        const monthlyData = {};

        // Sort chronologically just for charting accuracy
        const chronTxs = [...allTransactions].sort((a, b) => a.date - b.date);

        // Track running balances per account for net worth
        const balances = {};

        chronTxs.forEach(tx => {
            const month = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
            if (!monthlyData[month]) {
                monthlyData[month] = { pos: 0, neg: 0, netWorth: 0 };
            }

            // Net Worth Calc (Use balance if provided, otherwise accumulate amounts)
            if (tx.balance !== null) {
                balances[tx.account] = tx.balance;
            } else {
                balances[tx.account] = (balances[tx.account] || 0) + tx.amount;
            }
            monthlyData[month].netWorth = Object.values(balances).reduce((sum, val) => sum + val, 0);

            // Pos/Neg Calc (Ignore transfers for cash flow)
            if (!tx.isTransfer) {
                if (tx.amount > 0) monthlyData[month].pos += tx.amount;
                if (tx.amount < 0) monthlyData[month].neg += Math.abs(tx.amount);
            }
        });

        const months = Object.keys(monthlyData).sort();

        // 1. Net Worth Chart
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
            }
        });

        // 2. Pos/Neg Bar Chart
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
        // Adjust end date to end of day
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

        const colors = labels.map(label => {
            const map = { Food: "#e74c3c", Groceries: "#d35400", Transportation: "#f39c12", Shopping: "#9b59b6", Education: "#2980b9", Subscription: "#16a085", Investment: "#2ecc71", Other: "#34495e" };
            return map[label] || "#95a5a6";
        });

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
                plugins: {
                    legend: { position: 'right' }
                }
            }
        });
    }

})();