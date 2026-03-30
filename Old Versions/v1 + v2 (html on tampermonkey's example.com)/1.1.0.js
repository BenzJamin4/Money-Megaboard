// ==UserScript==
// @name         FMFCU Dashboard v5.3
// @namespace    http://tampermonkey.net/
// @version      5.3
// @description  Multi-account dashboard with categories, transfer detection, and interactive charts
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (!location.href.includes("fmfcu-dashboard")) return;

    // Added separate inputs to ensure accounts are always labeled correctly
    // Added sticky header to the table so you can always see the columns while scrolling
    document.body.innerHTML = `
        <h2>FMFCU Financial Dashboard</h2>
        <div style="margin-bottom: 15px; padding: 15px; background: #f4f6f7; border: 1px solid #dcdde1; border-radius: 5px;">
            <strong>Upload CSVs:</strong><br><br>
            <label>Checking: <input type="file" id="csvChecking" accept=".csv" /></label><br><br>
            <label>Savings: <input type="file" id="csvSavings" accept=".csv" /></label>
        </div>
        <canvas id="netWorthChart"></canvas>
        <canvas id="categoryChart"></canvas>
        <h3>Transactions</h3>
        <div id="tableContainer" style="max-height:350px; overflow:auto; border:1px solid #ccc; position:relative;">
            <table border="1" style="font-size:12px; width:100%; border-collapse:collapse;">
                <thead style="position:sticky; top:0; background:#fff; z-index:1; box-shadow: 0 2px 2px -1px rgba(0,0,0,0.2);">
                    <tr>
                        <th style="padding: 5px;">Date</th>
                        <th style="padding: 5px;">Description</th>
                        <th style="padding: 5px;">Amount</th>
                        <th style="padding: 5px;">Category</th>
                        <th style="padding: 5px;">Account</th>
                    </tr>
                </thead>
                <tbody id="txnTable"></tbody>
            </table>
        </div>
    `;

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/chart.js";
    document.head.appendChild(script);

    let netChart, catChart;
    let checkingData = [];
    let savingsData = [];

    // Listeners for both inputs
    document.getElementById("csvChecking").addEventListener("change", async e => {
        if (e.target.files.length) {
            const text = await e.target.files[0].text();
            checkingData = parseCSV(text, "Checking");
            reprocessAll();
        }
    });

    document.getElementById("csvSavings").addEventListener("change", async e => {
        if (e.target.files.length) {
            const text = await e.target.files[0].text();
            savingsData = parseCSV(text, "Savings");
            reprocessAll();
        }
    });

    function reprocessAll() {
        const allTransactions = [...checkingData, ...savingsData];
        detectTransfers(allTransactions);
        processData(allTransactions);
    }

    function detectTransfers(transactions) {
        const amountMap = {};

        // Group by absolute amount and date
        transactions.forEach((tx) => {
            tx.isTransfer = false;
            tx.transferPartnerTx = null; // Store actual object reference so sorting doesn't break it
            const key = `${Math.abs(tx.amount).toFixed(2)}_${tx.date.toLocaleDateString()}`;
            if (!amountMap[key]) amountMap[key] = [];
            amountMap[key].push(tx);
        });

        // Mark transfers
        Object.values(amountMap).forEach(group => {
            if (group.length === 2) {
                const tx1 = group[0];
                const tx2 = group[1];

                // Check if accounts differ and amounts are opposite
                if (tx1.account !== tx2.account &&
                    ((tx1.amount > 0 && tx2.amount < 0) || (tx1.amount < 0 && tx2.amount > 0))) {
                    tx1.isTransfer = true;
                    tx2.isTransfer = true;
                    tx1.transferPartnerTx = tx2;
                    tx2.transferPartnerTx = tx1;
                }
            }
        });
    }

    function categorize(desc) {
        const d = desc.toLowerCase();
        if (d.includes("transfer") || d.includes("zelle") || d.includes("venmo") || d.includes("internet transfer") || d.includes("external transfer")) return "Transfers";
        if (d.includes("deposit") || d.includes("payroll")) return "Income";
        if (d.includes("restaurant") || d.includes("pizza") || d.includes("panera") || d.includes("applebee") || d.includes("waffle")) return "Food";
        if (d.includes("sheetz") || d.includes("market")) return "Groceries";
        if (d.includes("uber") || d.includes("gas") || d.includes("amtrak")) return "Transportation";
        if (d.includes("amazon") || d.includes("store")) return "Shopping";
        if (d.includes("psu") || d.includes("cengage")) return "Education";
        if (d.includes("prime") || d.includes("apple") || d.includes("subscription")) return "Subscription";
        if (d.includes("fidelity")) return "Investment";
        return "Other";
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
            const cols = rows[i].split(",").map(c => c.trim());
            if (!cols[dateIndex]) continue;

            const date = new Date(cols[dateIndex]);
            if (isNaN(date)) continue;

            let amount = 0;
            if (amountIndex !== -1) {
                amount = parseFloat(cols[amountIndex]) || 0;
            } else {
                const debit = debitIndex !== -1 ? parseFloat(cols[debitIndex]) || 0 : 0;
                const credit = creditIndex !== -1 ? parseFloat(cols[creditIndex]) || 0 : 0;
                amount = credit - debit;
            }

            const balance = balanceIndex !== -1 ? parseFloat(cols[balanceIndex]) : null;

            data.push({
                date,
                desc: cols[descIndex] || "",
                amount,
                balance,
                category: categorize(cols[descIndex] || ""),
                account: accountName,
                isTransfer: false,
                transferPartnerTx: null
            });
        }
        return data;
    }

    function processData(transactions) {
        // 1. Sort chronological (oldest to newest) for accurate running balances and chart calculations
        transactions.sort((a, b) => a.date - b.date);

        const monthlyNet = {};
        const monthlyCat = {};
        let checkingBalance = 0;
        let savingsBalance = 0;

        transactions.forEach(tx => {
            const month = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;

            if (tx.account === "Checking" && tx.balance !== null) checkingBalance = tx.balance;
            if (tx.account === "Savings" && tx.balance !== null) savingsBalance = tx.balance;
            monthlyNet[month] = checkingBalance + savingsBalance;

            if (tx.category !== "Transfers" && tx.category !== "Income" && tx.amount < 0 && !tx.isTransfer) {
                if (!monthlyCat[month]) monthlyCat[month] = {};
                if (!monthlyCat[month][tx.category]) monthlyCat[month][tx.category] = 0;
                monthlyCat[month][tx.category] += Math.abs(tx.amount);
            }
        });

        drawCharts(monthlyNet, monthlyCat);

        // 2. Build the table with newest first
        const txnTable = document.getElementById("txnTable");
        txnTable.innerHTML = "";
        const fragment = document.createDocumentFragment();
        const processedSet = new Set();

        // Clone and sort descending
        const displayTransactions = [...transactions].sort((a, b) => b.date - a.date);

        displayTransactions.forEach(tx => {
            if (processedSet.has(tx)) return;

            let displayAccount = tx.account;
            let displayDesc = tx.desc;
            let displayAmount = tx.amount;
            let isConsolidatedTransfer = false;

            // Handle transfer pairs
            if (tx.isTransfer && tx.transferPartnerTx) {
                const partner = tx.transferPartnerTx;
                const direction = tx.amount < 0 ? "to" : "from";
                const otherAccount = tx.amount < 0 ? partner.account : tx.account;

                displayAccount = "Transfer";
                displayDesc = `$${Math.abs(tx.amount).toFixed(2)} transferred ${direction} ${otherAccount}`;
                displayAmount = Math.abs(tx.amount);

                processedSet.add(tx);
                processedSet.add(partner);
                isConsolidatedTransfer = true;
            }

            const row = document.createElement("tr");
            const monthTag = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, "0")}`;
            row.setAttribute("data-month", monthTag);

            let amountColor = displayAmount < 0 ? "#e74c3c" : "#27ae60"; // Red/Green
            let amountSign = displayAmount > 0 ? "+" : "";

            if (isConsolidatedTransfer) {
                amountColor = "#2980b9"; // Neutral blue for combined transfers
                amountSign = ""; // No sign for absolute transfer lines
            }

            row.innerHTML = `
                <td style="padding: 5px;">${tx.date.toLocaleDateString()}</td>
                <td style="padding: 5px;">${displayDesc}</td>
                <td style="padding: 5px; color:${amountColor}; font-weight:bold;">
                    ${amountSign}${displayAmount.toFixed(2)}
                </td>
                <td style="background:${categoryColor(tx.category)}; color:white; text-align:center; padding: 5px;">
                    ${tx.category}
                </td>
                <td style="padding: 5px; font-weight: bold; color: ${displayAccount === 'Transfer' ? '#2980b9' : '#2c3e50'};">${displayAccount}</td>
            `;

            fragment.appendChild(row);
        });

        txnTable.appendChild(fragment);
    }

    function categoryColor(cat) {
        const map = {
            Food: "#e74c3c", Groceries: "#d35400", Transportation: "#f39c12",
            Shopping: "#9b59b6", Education: "#2980b9", Subscription: "#16a085",
            Investment: "#2ecc71", Transfers: "#7f8c8d", Income: "#27ae60", Other: "#34495e"
        };
        return map[cat] || "#34495e";
    }

    function scrollToMonth(month) {
        const row = document.querySelector(`tr[data-month="${month}"]`);
        if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "start" });
            // Subtle highlight to show user where it jumped
            row.style.transition = "background-color 0.5s";
            row.style.backgroundColor = "#fff3cd";
            setTimeout(() => row.style.backgroundColor = "", 1500);
        }
    }

    function drawCharts(net, cats) {
        const months = Object.keys(net).sort();

        if (netChart) netChart.destroy();
        if (catChart) catChart.destroy();

        netChart = new Chart(document.getElementById("netWorthChart"), {
            type: "line",
            data: {
                labels: months,
                datasets: [{
                    label: "Net Worth (Checking + Savings)",
                    data: months.map(m => net[m]),
                    borderColor: '#2980b9',
                    backgroundColor: 'rgba(41, 128, 185, 0.2)',
                    fill: true
                }]
            },
            options: {
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        scrollToMonth(months[elements[0].index]);
                    }
                }
            }
        });

        const allCats = [...new Set(Object.values(cats).flatMap(o => Object.keys(o)))];

        catChart = new Chart(document.getElementById("categoryChart"), {
            type: "bar",
            data: {
                labels: months,
                datasets: allCats.map(cat => ({
                    label: cat,
                    backgroundColor: categoryColor(cat),
                    data: months.map(m => cats[m]?.[cat] || 0)
                }))
            },
            options: {
                scales: { x: { stacked: true }, y: { stacked: true } },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        scrollToMonth(months[elements[0].index]);
                    }
                }
            }
        });
    }

})();