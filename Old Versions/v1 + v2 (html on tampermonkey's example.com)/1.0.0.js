// ==UserScript==
// @name         FMFCU Dashboard v5
// @namespace    http://tampermonkey.net/
// @version      5.2
// @description  Multi-account dashboard with categories, transfer detection, and interactive charts
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';
    if (!location.href.includes("fmfcu-dashboard")) return;

    document.body.innerHTML = `
        <h2>FMFCU Financial Dashboard</h2>
        <p>Upload Checking CSV first, then Savings CSV (optional)</p>
        <input type="file" id="csvFile" accept=".csv" multiple />
        <canvas id="netWorthChart"></canvas>
        <canvas id="categoryChart"></canvas>
        <h3>Transactions</h3>
        <div style="max-height:350px;overflow:auto">
            <table border="1" style="font-size:12px;width:100%;border-collapse:collapse">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th>Category</th>
                        <th>Account</th>
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
    let allTransactions = [];

    document.getElementById("csvFile").addEventListener("change", async e => {
        const files = e.target.files;
        const allData = [];

        for (let file of files) {
            const text = await file.text();
            const accountType = file.name.toLowerCase().includes("sav") ? "Savings" : "Checking";
            console.log(`Parsing ${file.name} as ${accountType}`);
            allData.push(parseCSV(text, accountType));
        }

        allTransactions = allData.flat();
        console.log("All transactions before transfer detection:", allTransactions);
        detectTransfers(allTransactions);
        console.log("All transactions after transfer detection:", allTransactions);
        processData(allTransactions);
    });

    function detectTransfers(transactions) {
        // Group by absolute amount and date to find matching transfers
        const amountMap = {};

        transactions.forEach((tx, idx) => {
            const key = `${Math.abs(tx.amount).toFixed(2)}_${tx.date.toLocaleDateString()}`;
            if (!amountMap[key]) amountMap[key] = [];
            amountMap[key].push(idx);
        });

        console.log("Amount map for transfer detection:", amountMap);

        // Mark transfers
        Object.values(amountMap).forEach(indices => {
            if (indices.length === 2) {
                const tx1 = transactions[indices[0]];
                const tx2 = transactions[indices[1]];

                console.log(`Checking pair: ${tx1.account} ${tx1.amount} vs ${tx2.account} ${tx2.amount}`);

                // Check if one is checking and one is savings, and amounts are opposite
                if ((tx1.account === "Checking" && tx2.account === "Savings" ||
                     tx1.account === "Savings" && tx2.account === "Checking") &&
                    ((tx1.amount > 0 && tx2.amount < 0) || (tx1.amount < 0 && tx2.amount > 0))) {

                    console.log("Found transfer match!");
                    tx1.isTransfer = true;
                    tx2.isTransfer = true;
                    tx1.transferPartner = indices[1];
                    tx2.transferPartner = indices[0];
                }
            }
        });
    }

    function categorize(desc) {
        const d = desc.toLowerCase();

        // ---- Transfers ----
        if (d.includes("transfer") ||
            d.includes("zelle") ||
            d.includes("venmo") ||
            d.includes("internet transfer") ||
            d.includes("external transfer"))
            return "Transfers";

        // ---- Income ----
        if (d.includes("deposit") || d.includes("payroll"))
            return "Income";

        // ---- Food ----
        if (d.includes("restaurant") || d.includes("pizza") || d.includes("panera") ||
            d.includes("applebee") || d.includes("waffle"))
            return "Food";

        // ---- Grocery ----
        if (d.includes("sheetz") || d.includes("market"))
            return "Groceries";

        // ---- Transportation ----
        if (d.includes("uber") || d.includes("gas") || d.includes("amtrak"))
            return "Transportation";

        // ---- Shopping ----
        if (d.includes("amazon") || d.includes("store"))
            return "Shopping";

        // ---- Education ----
        if (d.includes("psu") || d.includes("cengage"))
            return "Education";

        // ---- Subscription ----
        if (d.includes("prime") || d.includes("apple") || d.includes("subscription"))
            return "Subscription";

        // ---- Investment ----
        if (d.includes("fidelity"))
            return "Investment";

        return "Other";
    }

    function parseCSV(text, accountName) {
        const rows = text.trim().split("\n");
        const headers = rows[0].split(",").map(h => h.trim().toLowerCase());

        console.log(`Headers for ${accountName}:`, headers);

        const dateIndex = headers.findIndex(h => h.includes("date"));
        const descIndex = headers.findIndex(h => h.includes("description"));
        const amountIndex = headers.findIndex(h => h.includes("amount"));
        const debitIndex = headers.findIndex(h => h.includes("debit"));
        const creditIndex = headers.findIndex(h => h.includes("credit"));
        const balanceIndex = headers.findIndex(h => h.includes("balance"));

        console.log(`${accountName} column indices: date=${dateIndex}, desc=${descIndex}, amount=${amountIndex}, debit=${debitIndex}, credit=${creditIndex}, balance=${balanceIndex}`);

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

            const transaction = {
                date,
                desc: cols[descIndex] || "",
                amount,
                balance,
                category: categorize(cols[descIndex] || ""),
                account: accountName,
                isTransfer: false,
                transferPartner: null
            };

            console.log(`${accountName} transaction:`, transaction);
            data.push(transaction);
        }

        return data;
    }

    function processData(transactions) {
        transactions.sort((a,b) => a.date - b.date);

        const monthlyNet = {};
        const monthlyCat = {};
        const txnTable = document.getElementById("txnTable");
        txnTable.innerHTML = "";

        let checkingBalance = 0;
        let savingsBalance = 0;

        const fragment = document.createDocumentFragment();
        const processedIndices = new Set();

        transactions.forEach((tx, idx) => {
            if (processedIndices.has(idx)) return;

            const month = `${tx.date.getFullYear()}-${String(tx.date.getMonth()+1).padStart(2,"0")}`;

            if (tx.account === "Checking" && tx.balance !== null)
                checkingBalance = tx.balance;

            if (tx.account === "Savings" && tx.balance !== null)
                savingsBalance = tx.balance;

            monthlyNet[month] = checkingBalance + savingsBalance;

            if (tx.category !== "Transfers" && tx.category !== "Income" && tx.amount < 0) {
                if (!monthlyCat[month]) monthlyCat[month] = {};
                if (!monthlyCat[month][tx.category]) monthlyCat[month][tx.category] = 0;
                monthlyCat[month][tx.category] += Math.abs(tx.amount);
            }

            let displayAccount = tx.account;
            let displayDesc = tx.desc;
            let displayAmount = tx.amount;

            // Handle transfer pairs
            if (tx.isTransfer && tx.transferPartner !== null) {
                const partner = transactions[tx.transferPartner];
                const direction = tx.amount < 0 ? "to" : "from";
                const otherAccount = tx.amount < 0 ? partner.account : tx.account;

                displayAccount = "Transfer";
                displayDesc = `$${Math.abs(tx.amount).toFixed(2)} transferred ${direction} ${otherAccount}`;
                displayAmount = Math.abs(tx.amount);

                processedIndices.add(idx);
                processedIndices.add(tx.transferPartner);
            }

            const row = document.createElement("tr");
            const amountColor = displayAmount < 0 ? "red" : "green";
            const amountSign = displayAmount > 0 ? "+" : "";

            row.innerHTML = `
                <td>${tx.date.toLocaleDateString()}</td>
                <td>${displayDesc}</td>
                <td style="color:${amountColor}">
                    ${amountSign}${displayAmount.toFixed(2)}
                </td>
                <td style="background:${categoryColor(tx.category)};color:white;text-align:center">
                    ${tx.category}
                </td>
                <td>${displayAccount}</td>
            `;

            fragment.appendChild(row);
        });

        // Sort by date descending (newest first)
        const rows = Array.from(fragment.querySelectorAll("tr"));
        rows.sort((a, b) => {
            const dateA = new Date(a.cells[0].textContent);
            const dateB = new Date(b.cells[0].textContent);
            return dateB - dateA;
        });

        rows.forEach(row => fragment.appendChild(row));
        txnTable.appendChild(fragment);
        drawCharts(monthlyNet, monthlyCat);
    }

    function categoryColor(cat) {
        const map = {
            Food: "#e74c3c",
            Groceries: "#d35400",
            Transportation: "#f39c12",
            Shopping: "#9b59b6",
            Education: "#2980b9",
            Subscription: "#16a085",
            Investment: "#2ecc71",
            Transfers: "#7f8c8d",
            Income: "#27ae60",
            Other: "#34495e"
        };
        return map[cat] || "#34495e";
    }

    function scrollToMonth(month) {
        const txnTable = document.getElementById("txnTable");
        const rows = txnTable.querySelectorAll("tr");

        for (let row of rows) {
            const dateStr = row.cells[0].textContent;
            const date = new Date(dateStr);
            const rowMonth = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;

            if (rowMonth === month) {
                row.scrollIntoView({ behavior: "smooth", block: "start" });
                return;
            }
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
                    data: months.map(m => net[m])
                }]
            },
            options: {
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const monthIndex = elements[0].index;
                        scrollToMonth(months[monthIndex]);
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
                    data: months.map(m => cats[m]?.[cat] || 0)
                }))
            },
            options: {
                scales: { x: { stacked: true }, y: { stacked: true } },
                onClick: (event, elements) => {
                    if (elements.length > 0) {
                        const monthIndex = elements[0].index;
                        scrollToMonth(months[monthIndex]);
                    }
                }
            }
        });
    }

})();