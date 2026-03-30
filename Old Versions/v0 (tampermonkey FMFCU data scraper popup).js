// ==UserScript==
// @name         FMFCU Finance Tracker 💰
// @namespace    https://fmfcu.org
// @version      1.2.0
// @description  Scrapes FMFCU transactions and displays a net worth + spending dashboard with category charts
// @author       You
// @match        https://*.fmfcu.org/*
// @match        https://fmfcu.org/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @require      https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js
// ==/UserScript==

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════════
  //  CONFIGURATION — Adjust these if FMFCU updates their UI
  // ════════════════════════════════════════════════════════════════════════════

  // Selectors for FMFCU's Q2 banking platform
  const TRANSACTION_ROW_SELECTORS = [
    'li.transaction-history-item',
  ];

  // Sub-selectors within each row to find date, description, amount
  const FIELD_SELECTORS = {
    date:        ['.col-date'],
    description: ['[test-id="historyItemDescription"]'],
    amount:      ['[test-id="lblAmount"] .numAmount'],
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  CATEGORY RULES — keyword → category mapping
  // ════════════════════════════════════════════════════════════════════════════

  const CATEGORY_RULES = [
    {
      category: 'Food & Dining',
      keywords: [
        'restaurant','mcdonald','starbucks','chipotle','pizza','sushi','grubhub',
        'doordash','uber eats','ubereats','wendy','taco','subway','panera',
        'chick-fil','panda express','diner','cafe','coffee','bakery','kitchen',
        'grill','tavern','brewery','instacart','whole foods','trader joe',
        'kroger','safeway','aldi','publix','wegmans','wawa food','sheetz food',
        'dunkin','tim horton','smoothie','juice bar','deli','burrito','noodle',
        'ramen','pho','steakhouse','seafood','oyster','sushi','bbq'
      ],
    },
    {
      category: 'Groceries',
      keywords: [
        'grocery','supermarket','market','food store','acme','giant food',
        'shoprite','stop & shop','food lion','harris teeter','meijer',
        'h-e-b','fresh market','sprouts','trader joes'
      ],
    },
    {
      category: 'Transportation',
      keywords: [
        'uber','lyft','taxi','transit','mta','septa','metro','amtrak',
        'airlines','delta','united','american air','southwest','jetblue',
        'frontier','spirit air','parking','shell','exxon','chevron',
        'bp ','sunoco','gas station','speedway','wawa gas','valero',
        'circle k','autozone','jiffy lube','car wash','pep boys','midas',
        'enterprise rent','hertz','avis','budget car','toll','e-zpass',
        'ezpass','parkway','turnpike'
      ],
    },
    {
      category: 'Shopping',
      keywords: [
        'amazon','walmart','target','best buy','costco','home depot',
        'lowes','ikea','ebay','etsy','apple store','apple.com','nike',
        'adidas','gap','old navy','zara','h&m','tj maxx','marshalls',
        'nordstrom','macys','bloomingdale','kohls','jcpenney','sears',
        'dollar tree','dollar general','five below','bed bath','wayfair',
        'overstock','chewy'
      ],
    },
    {
      category: 'Entertainment',
      keywords: [
        'netflix','spotify','hulu','disney+','disney plus','hbo','apple tv',
        'youtube','twitch','playstation','xbox','steam','gamestop','cinema',
        'theater','amc ','regal','concert','ticketmaster','eventbrite',
        'bowling','escape room','museum','aquarium','zoo','amusement',
        'six flags','dave & buster','top golf','topgolf','miniature golf'
      ],
    },
    {
      category: 'Health & Fitness',
      keywords: [
        'pharmacy','cvs','walgreens','rite aid','hospital','clinic','doctor',
        'dentist','urgent care','optometrist','orthodon','gym','planet fitness',
        'equinox','peloton','crossfit','yoga','vitamin','supplement',
        'gnc','health food','medical','therapy','counseling','chiropractic'
      ],
    },
    {
      category: 'Utilities & Bills',
      keywords: [
        'electric','water bill','gas bill','internet','comcast','verizon',
        'at&t','tmobile','t-mobile','sprint','spectrum','xfinity','peco',
        'pseg','pg&e','insurance','geico','progressive','allstate',
        'state farm','liberty mutual','nationwide','travelers'
      ],
    },
    {
      category: 'Housing',
      keywords: [
        'rent','mortgage','hoa','maintenance','repair','plumber',
        'electrician','airbnb','hotel','marriott','hilton','hyatt',
        'holiday inn','hampton inn','property','lease'
      ],
    },
    {
      category: 'Education',
      keywords: [
        'tuition','university','college','school','udemy','coursera',
        'chegg','pearson','barnes noble','textbook','student loan'
      ],
    },
    {
      category: 'Income',
      keywords: [
        'payroll','salary','direct dep','direct deposit','deposit','zelle from',
        'venmo from','cashback','refund','tax refund','interest paid',
        'dividend','credit union dividend','paycheck'
      ],
    },
    {
      category: 'Transfers',
      keywords: [
        'transfer','zelle','venmo','paypal','cashapp','cash app',
        'wire','ach transfer'
      ],
    },
  ];

  const CATEGORY_COLORS = {
    'Food & Dining':     '#f43f5e',
    'Groceries':         '#fb923c',
    'Transportation':    '#f59e0b',
    'Shopping':          '#a3e635',
    'Entertainment':     '#a855f7',
    'Health & Fitness':  '#22c55e',
    'Utilities & Bills': '#06b6d4',
    'Housing':           '#3b82f6',
    'Education':         '#e879f9',
    'Income':            '#10b981',
    'Transfers':         '#94a3b8',
    'Other':             '#64748b',
  };

  // ════════════════════════════════════════════════════════════════════════════
  //  STORAGE
  // ════════════════════════════════════════════════════════════════════════════

  function loadTransactions() {
    try { return JSON.parse(GM_getValue('fmfcu_txns', '[]')); }
    catch { return []; }
  }

  function saveTransactions(txns) {
    GM_setValue('fmfcu_txns', JSON.stringify(txns));
  }

  function clearTransactions() {
    GM_setValue('fmfcu_txns', '[]');
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  CATEGORY AUTO-DETECTION
  // ════════════════════════════════════════════════════════════════════════════

  function detectCategory(description) {
    const lower = description.toLowerCase();
    for (const rule of CATEGORY_RULES) {
      if (rule.keywords.some(k => lower.includes(k))) return rule.category;
    }
    return 'Other';
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  SCRAPER
  // ════════════════════════════════════════════════════════════════════════════

  function trySelectText(el, selectors) {
    for (const sel of selectors) {
      const found = el.querySelector(sel);
      if (found && found.innerText.trim()) return found.innerText.trim();
    }
    return null;
  }

  function parseAmount(raw) {
    if (!raw) return NaN;
    // FMFCU uses an em-dash (–) or minus to indicate debits, e.g. "– $69.00"
    const isNeg = raw.includes('–') || raw.includes('−') || raw.includes('-') || raw.includes('(');
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const val = parseFloat(cleaned);
    return isNeg ? -Math.abs(val) : val;
  }

  function parseDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d;
    // Try MM/DD/YYYY
    const m = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
      const year = m[3].length === 2 ? '20' + m[3] : m[3];
      return new Date(`${year}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`);
    }
    return null;
  }

  function scrapeTransactions() {
    let rows = [];
    for (const sel of TRANSACTION_ROW_SELECTORS) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) { rows = Array.from(found); break; }
    }

    if (rows.length === 0) return [];

    const results = [];
    rows.forEach(row => {
      const rawDate   = trySelectText(row, FIELD_SELECTORS.date);
      const rawDesc   = trySelectText(row, FIELD_SELECTORS.description);
      const rawAmount = trySelectText(row, FIELD_SELECTORS.amount);

      const parsedDate = parseDate(rawDate);
      const amount = parseAmount(rawAmount);

      if (!parsedDate || !rawDesc || isNaN(amount)) return;

      const dateStr = parsedDate.toISOString().slice(0, 10);
      const id = `${dateStr}__${rawDesc}__${amount}`;
      results.push({ id, date: dateStr, description: rawDesc, amount, category: detectCategory(rawDesc) });
    });

    return results;
  }

  async function autoScrapeAllPages(onProgress) {
    let totalAdded = 0;
    let page = 1;

    while (true) {
      // Wait for transactions to be visible
      await waitForTransactions();

      const found = scrapeTransactions();
      const { added } = mergeAndSave(found);
      totalAdded += added;

      onProgress(page, found.length, added);

      // Check if next button exists and is not hidden — this is the only thing we need
      const nextBtn = document.querySelector('[test-id="nextPageBtn"]');
      if (!nextBtn || nextBtn.hasAttribute('hidden')) break;

      // Snapshot first row so we can detect when the page actually changes
      const firstRowText = document.querySelector('li.transaction-history-item')?.innerText?.trim() ?? '';

      // Click the inner shadow-DOM button
      const innerBtn = nextBtn.shadowRoot?.querySelector('button') || nextBtn;
      innerBtn.click();
      page++;

      // Wait for first row to change (means new page loaded)
      await waitForPageChange(firstRowText);
    }

    return totalAdded;
  }

  function waitForTransactions() {
    return new Promise(resolve => {
      const check = () => {
        const rows = document.querySelectorAll('li.transaction-history-item');
        if (rows.length > 0) return resolve();
        setTimeout(check, 300);
      };
      check();
    });
  }

  function waitForPageChange(oldFirstRow) {
    return new Promise(resolve => {
      const start = Date.now();
      const check = () => {
        const rows = document.querySelectorAll('li.transaction-history-item');
        if (rows.length > 0) {
          const newFirst = rows[0].innerText?.trim() ?? '';
          if (newFirst !== oldFirstRow) return resolve();
        }
        if (Date.now() - start > 15000) return resolve(); // 15s timeout safety
        setTimeout(check, 400);
      };
      setTimeout(check, 700); // initial delay to let Ember unload old rows
    });
  }

  function mergeAndSave(newTxns) {
    const existing = loadTransactions();
    const map = new Map(existing.map(t => [t.id, t]));
    let added = 0;
    for (const t of newTxns) {
      if (!map.has(t.id)) { map.set(t.id, t); added++; }
    }
    const merged = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
    saveTransactions(merged);
    return { merged, added };
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  DATA AGGREGATION
  // ════════════════════════════════════════════════════════════════════════════

  function getMonths(txns) {
    return [...new Set(txns.map(t => t.date.slice(0, 7)))].sort();
  }

  function spendingByMonthCategory(txns) {
    // Only debits (negative or positive depending on bank convention)
    const result = {};
    for (const t of txns) {
      if (t.category === 'Income' || t.category === 'Transfers') continue;
      const month = t.date.slice(0, 7);
      if (!result[month]) result[month] = {};
      result[month][t.category] = (result[month][t.category] || 0) + Math.abs(t.amount);
    }
    return result;
  }

  function netWorthByMonth(txns) {
    const monthly = {};
    for (const t of txns) {
      const m = t.date.slice(0, 7);
      monthly[m] = (monthly[m] || 0) + t.amount;
    }
    const sorted = Object.keys(monthly).sort();
    let cum = 0;
    return sorted.map(m => { cum += monthly[m]; return { month: m, net: parseFloat(cum.toFixed(2)) }; });
  }

  function totalByCategory(txns) {
    const totals = {};
    for (const t of txns) {
      if (t.amount >= 0) continue; // only expenses
      totals[t.category] = (totals[t.category] || 0) + Math.abs(t.amount);
    }
    return totals;
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  STYLES
  // ════════════════════════════════════════════════════════════════════════════

  GM_addStyle(`
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap');

    #ft-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.5);
      z-index: 999998; display: none; backdrop-filter: blur(3px);
    }
    #ft-overlay.open { display: block; }

    #ft-panel {
      position: fixed; top: 0; right: 0; width: min(580px, 100vw);
      height: 100vh; background: #0d1117; color: #cdd9e5;
      font-family: 'DM Sans', sans-serif; font-size: 14px;
      z-index: 999999; overflow-y: auto; display: flex; flex-direction: column;
      box-shadow: -12px 0 60px rgba(0,0,0,0.7);
      border-left: 1px solid #21262d;
      transform: translateX(100%); transition: transform 0.3s cubic-bezier(.4,0,.2,1);
    }
    #ft-panel.open { transform: translateX(0); }

    #ft-toggle {
      position: fixed !important; top: 50% !important; right: 0 !important;
      transform: translateY(-50%) !important;
      z-index: 2147483647 !important; background: #238636 !important; color: #fff !important;
      border: none !important; padding: 12px 6px !important; cursor: pointer !important;
      border-radius: 6px 0 0 6px !important; font-size: 11px !important; font-weight: 700 !important;
      font-family: monospace !important; letter-spacing: 1px !important;
      box-shadow: -2px 0 12px rgba(0,0,0,0.5) !important;
      writing-mode: vertical-rl !important; text-orientation: mixed !important;
      visibility: visible !important; opacity: 1 !important;
      width: 24px !important; line-height: 1.4 !important;
    }
    #ft-toggle:hover { background: #2ea043 !important; }
    #ft-toggle.ft-hidden { display: none !important; }

    .ft-header {
      padding: 20px 24px 16px;
      background: #161b22;
      border-bottom: 1px solid #21262d;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 10;
    }
    .ft-header h1 {
      margin: 0; font-size: 15px; font-weight: 700; color: #e6edf3;
      font-family: 'DM Mono', monospace; letter-spacing: -0.3px;
    }
    .ft-header h1 span { color: #3fb950; }
    .ft-close {
      background: none; border: 1px solid #30363d; color: #8b949e;
      width: 28px; height: 28px; border-radius: 6px; cursor: pointer;
      font-size: 16px; display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }
    .ft-close:hover { background: #21262d; color: #cdd9e5; }

    .ft-actions {
      padding: 16px 24px;
      background: #161b22;
      border-bottom: 1px solid #21262d;
      display: flex; gap: 8px; flex-wrap: wrap;
    }
    .ft-btn {
      padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;
      cursor: pointer; border: 1px solid transparent;
      font-family: 'DM Sans', sans-serif; transition: all 0.15s;
    }
    .ft-btn-primary { background: #238636; color: #fff; border-color: #2ea043; }
    .ft-btn-primary:hover { background: #2ea043; }
    .ft-btn-secondary { background: transparent; color: #8b949e; border-color: #30363d; }
    .ft-btn-secondary:hover { background: #21262d; color: #cdd9e5; }
    .ft-btn-danger { background: transparent; color: #f85149; border-color: #f85149; }
    .ft-btn-danger:hover { background: rgba(248,81,73,0.1); }

    .ft-status {
      padding: 8px 24px; font-size: 12px; color: #8b949e;
      font-family: 'DM Mono', monospace; border-bottom: 1px solid #21262d;
    }
    .ft-status .highlight { color: #3fb950; }

    .ft-tabs {
      display: flex; border-bottom: 1px solid #21262d;
      background: #161b22; padding: 0 24px; gap: 0;
    }
    .ft-tab {
      padding: 10px 16px; font-size: 12px; font-weight: 600;
      cursor: pointer; border-bottom: 2px solid transparent;
      color: #8b949e; transition: all 0.15s; letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .ft-tab.active { color: #3fb950; border-bottom-color: #3fb950; }
    .ft-tab:hover:not(.active) { color: #cdd9e5; }

    .ft-content { padding: 20px 24px; flex: 1; }
    .ft-section { margin-bottom: 28px; }
    .ft-section-title {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 1px; color: #8b949e; margin-bottom: 12px;
    }

    .ft-stat-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .ft-stat {
      background: #161b22; border: 1px solid #21262d; border-radius: 8px;
      padding: 14px 16px;
    }
    .ft-stat-label { font-size: 11px; color: #8b949e; margin-bottom: 4px; }
    .ft-stat-value { font-size: 20px; font-weight: 700; font-family: 'DM Mono', monospace; color: #e6edf3; }
    .ft-stat-value.positive { color: #3fb950; }
    .ft-stat-value.negative { color: #f85149; }

    .ft-chart-wrap {
      background: #161b22; border: 1px solid #21262d;
      border-radius: 8px; padding: 16px; margin-bottom: 16px;
    }
    .ft-chart-wrap canvas { max-height: 220px; }

    .ft-cat-list { display: flex; flex-direction: column; gap: 6px; }
    .ft-cat-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; background: #161b22;
      border: 1px solid #21262d; border-radius: 6px;
    }
    .ft-cat-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .ft-cat-name { flex: 1; font-size: 13px; }
    .ft-cat-amount {
      font-family: 'DM Mono', monospace; font-size: 13px;
      color: #cdd9e5; font-weight: 500;
    }
    .ft-cat-bar-wrap { width: 80px; background: #21262d; border-radius: 3px; height: 4px; }
    .ft-cat-bar { height: 4px; border-radius: 3px; }

    .ft-txn-list { display: flex; flex-direction: column; gap: 4px; }
    .ft-txn {
      display: grid; grid-template-columns: auto 1fr auto;
      gap: 8px; align-items: center; padding: 8px 12px;
      background: #161b22; border: 1px solid #21262d; border-radius: 6px;
      cursor: default; transition: background 0.1s;
    }
    .ft-txn:hover { background: #1c2128; }
    .ft-txn-date { font-size: 11px; color: #8b949e; font-family: 'DM Mono', monospace; white-space: nowrap; }
    .ft-txn-desc { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ft-txn-desc small { display: block; font-size: 10px; color: #8b949e; }
    .ft-txn-amount { font-family: 'DM Mono', monospace; font-size: 13px; font-weight: 600; white-space: nowrap; }
    .ft-txn-amount.pos { color: #3fb950; }
    .ft-txn-amount.neg { color: #f85149; }

    .ft-search {
      width: 100%; padding: 8px 12px; background: #161b22; border: 1px solid #30363d;
      border-radius: 6px; color: #cdd9e5; font-size: 13px; margin-bottom: 12px;
      font-family: 'DM Sans', sans-serif; outline: none; box-sizing: border-box;
    }
    .ft-search:focus { border-color: #3fb950; }

    .ft-empty {
      text-align: center; padding: 40px 20px; color: #8b949e; font-size: 13px;
    }
    .ft-empty strong { display: block; font-size: 20px; margin-bottom: 8px; }

    .ft-notice {
      background: #1f2b1f; border: 1px solid #3fb950;
      border-radius: 6px; padding: 10px 14px; font-size: 12px;
      color: #7ee787; margin-bottom: 12px; line-height: 1.5;
    }
    .ft-notice.warn {
      background: #2d1f1f; border-color: #f85149; color: #ffa198;
    }

    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #0d1117; }
    ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
  `);

  // ════════════════════════════════════════════════════════════════════════════
  //  DASHBOARD UI
  // ════════════════════════════════════════════════════════════════════════════

  let charts = {};
  let activeTab = 'overview';

  function fmt(n) {
    return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtMonth(ym) {
    const [y, m] = ym.split('-');
    return new Date(+y, +m - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
  }

  function destroyChart(id) {
    if (charts[id]) { charts[id].destroy(); delete charts[id]; }
  }

  function buildOverviewTab(txns) {
    if (!txns.length) {
      return `<div class="ft-empty"><strong>📭</strong>No transactions yet.<br>Navigate to your account activity page and click <strong>Scrape This Page</strong>.</div>`;
    }

    const netMonths = netWorthByMonth(txns);
    const latestNet = netMonths.length ? netMonths[netMonths.length - 1].net : 0;
    const income = txns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const expenses = txns.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

    const monthLabels = netMonths.map(m => fmtMonth(m.month));
    const netData = netMonths.map(m => m.net);

    const catTotals = totalByCategory(txns);
    const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
    const maxCat = sortedCats[0]?.[1] || 1;

    return `
      <div class="ft-section">
        <div class="ft-section-title">Summary</div>
        <div class="ft-stat-row">
          <div class="ft-stat">
            <div class="ft-stat-label">Net Cash Flow</div>
            <div class="ft-stat-value ${latestNet >= 0 ? 'positive' : 'negative'}">${fmt(latestNet)}</div>
          </div>
          <div class="ft-stat">
            <div class="ft-stat-label">Total Income</div>
            <div class="ft-stat-value positive">${fmt(income)}</div>
          </div>
          <div class="ft-stat">
            <div class="ft-stat-label">Total Expenses</div>
            <div class="ft-stat-value negative">${fmt(expenses)}</div>
          </div>
          <div class="ft-stat">
            <div class="ft-stat-label">Transactions</div>
            <div class="ft-stat-value">${txns.length}</div>
          </div>
        </div>
      </div>

      <div class="ft-section">
        <div class="ft-section-title">Cumulative Net Worth</div>
        <div class="ft-chart-wrap">
          <canvas id="ft-net-chart"></canvas>
        </div>
      </div>

      <div class="ft-section">
        <div class="ft-section-title">Spending by Category (all time)</div>
        <div class="ft-cat-list">
          ${sortedCats.map(([cat, total]) => `
            <div class="ft-cat-row">
              <div class="ft-cat-dot" style="background:${CATEGORY_COLORS[cat] || '#64748b'}"></div>
              <div class="ft-cat-name">${cat}</div>
              <div class="ft-cat-bar-wrap"><div class="ft-cat-bar" style="width:${(total/maxCat*100).toFixed(1)}%;background:${CATEGORY_COLORS[cat] || '#64748b'}"></div></div>
              <div class="ft-cat-amount">${fmt(total)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function buildChartsTab(txns) {
    if (!txns.length) {
      return `<div class="ft-empty"><strong>📊</strong>No data to chart yet.</div>`;
    }
    const months = getMonths(txns);
    const spending = spendingByMonthCategory(txns);
    const allCats = [...new Set(Object.values(spending).flatMap(m => Object.keys(m)))];

    return `
      <div class="ft-section">
        <div class="ft-section-title">Monthly Spending by Category</div>
        <div class="ft-chart-wrap" style="height:260px">
          <canvas id="ft-stacked-chart"></canvas>
        </div>
      </div>
      <div class="ft-section">
        <div class="ft-section-title">Category Breakdown (Donut)</div>
        <div class="ft-chart-wrap" style="height:220px">
          <canvas id="ft-donut-chart"></canvas>
        </div>
      </div>
    `;
  }

  function buildTransactionsTab(txns) {
    return `
      <input class="ft-search" id="ft-search" placeholder="Search transactions…" />
      <div class="ft-txn-list" id="ft-txn-list">
        ${renderTxns(txns)}
      </div>
    `;
  }

  function renderTxns(txns, filter = '') {
    const filtered = filter ? txns.filter(t =>
      t.description.toLowerCase().includes(filter.toLowerCase()) ||
      t.category.toLowerCase().includes(filter.toLowerCase())
    ) : txns;

    if (!filtered.length) return `<div class="ft-empty" style="padding:20px"><strong>🔍</strong>No results.</div>`;

    return filtered.slice(0, 200).map(t => `
      <div class="ft-txn">
        <div class="ft-txn-date">${t.date}</div>
        <div class="ft-txn-desc">
          ${t.description}
          <small style="color:${CATEGORY_COLORS[t.category]||'#64748b'}">${t.category}</small>
        </div>
        <div class="ft-txn-amount ${t.amount >= 0 ? 'pos' : 'neg'}">${fmt(t.amount)}</div>
      </div>
    `).join('') + (filtered.length > 200 ? `<div class="ft-empty" style="padding:12px">Showing 200 of ${filtered.length} results</div>` : '');
  }

  function initCharts(txns) {
    setTimeout(() => {
      if (activeTab === 'overview') {
        const netMonths = netWorthByMonth(txns);
        const ctx = document.getElementById('ft-net-chart');
        if (ctx) {
          destroyChart('net');
          charts['net'] = new Chart(ctx, {
            type: 'line',
            data: {
              labels: netMonths.map(m => fmtMonth(m.month)),
              datasets: [{
                label: 'Net Worth',
                data: netMonths.map(m => m.net),
                borderColor: '#3fb950',
                backgroundColor: 'rgba(63,185,80,0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#3fb950',
              }]
            },
            options: {
              responsive: true, maintainAspectRatio: true,
              plugins: { legend: { display: false } },
              scales: {
                x: { ticks: { color: '#8b949e', font: { size: 10 } }, grid: { color: '#21262d' } },
                y: { ticks: { color: '#8b949e', font: { size: 10 }, callback: v => '$' + v.toLocaleString() }, grid: { color: '#21262d' } }
              }
            }
          });
        }
      }

      if (activeTab === 'charts') {
        const months = getMonths(txns);
        const spending = spendingByMonthCategory(txns);
        const allCats = [...new Set(Object.values(spending).flatMap(m => Object.keys(m)))];

        const stacked = document.getElementById('ft-stacked-chart');
        if (stacked) {
          destroyChart('stacked');
          charts['stacked'] = new Chart(stacked, {
            type: 'bar',
            data: {
              labels: months.map(fmtMonth),
              datasets: allCats.map(cat => ({
                label: cat,
                data: months.map(m => spending[m]?.[cat] || 0),
                backgroundColor: CATEGORY_COLORS[cat] || '#64748b',
              }))
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { labels: { color: '#8b949e', font: { size: 10 }, boxWidth: 10 } } },
              scales: {
                x: { stacked: true, ticks: { color: '#8b949e', font: { size: 10 } }, grid: { color: '#21262d' } },
                y: { stacked: true, ticks: { color: '#8b949e', font: { size: 10 }, callback: v => '$' + v.toLocaleString() }, grid: { color: '#21262d' } }
              }
            }
          });
        }

        const donut = document.getElementById('ft-donut-chart');
        if (donut) {
          const catTotals = totalByCategory(txns);
          const cats = Object.keys(catTotals);
          destroyChart('donut');
          charts['donut'] = new Chart(donut, {
            type: 'doughnut',
            data: {
              labels: cats,
              datasets: [{
                data: cats.map(c => catTotals[c]),
                backgroundColor: cats.map(c => CATEGORY_COLORS[c] || '#64748b'),
                borderColor: '#0d1117', borderWidth: 2,
              }]
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { position: 'right', labels: { color: '#8b949e', font: { size: 10 }, boxWidth: 10 } } }
            }
          });
        }
      }
    }, 50);
  }

  function renderPanel() {
    const txns = loadTransactions();
    const content = document.getElementById('ft-tab-content');
    const status = document.getElementById('ft-status');

    if (status) {
      const months = getMonths(txns);
      status.innerHTML = txns.length
        ? `<span class="highlight">${txns.length} transactions</span> across ${months.length} months stored locally`
        : `No transactions stored yet`;
    }

    if (!content) return;

    Object.values(charts).forEach(c => c.destroy());
    charts = {};

    if (activeTab === 'overview') content.innerHTML = buildOverviewTab(txns);
    else if (activeTab === 'charts') content.innerHTML = buildChartsTab(txns);
    else if (activeTab === 'transactions') content.innerHTML = buildTransactionsTab(txns);

    initCharts(txns);

    if (activeTab === 'transactions') {
      const search = document.getElementById('ft-search');
      if (search) {
        search.addEventListener('input', () => {
          document.getElementById('ft-txn-list').innerHTML = renderTxns(txns, search.value);
        });
      }
    }
  }

  function createUI() {
    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'ft-overlay';
    document.body.appendChild(overlay);

    // Toggle button
    const toggle = document.createElement('button');
    toggle.id = 'ft-toggle';
    toggle.textContent = '💰 FINANCE';
    document.body.appendChild(toggle);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'ft-panel';
    panel.innerHTML = `
      <div class="ft-header">
        <h1>FMFCU <span>Finance Tracker</span></h1>
        <button class="ft-close" id="ft-close">✕</button>
      </div>

      <div class="ft-actions">
        <button class="ft-btn ft-btn-primary" id="ft-scrape">⬇ Scrape This Page</button>
        <button class="ft-btn ft-btn-primary" id="ft-autoscrape" style="background:#1d4ed8;border-color:#2563eb">⚡ Auto-Scrape All Pages</button>
        <button class="ft-btn ft-btn-secondary" id="ft-export">↗ Export CSV</button>
        <button class="ft-btn ft-btn-danger" id="ft-clear">🗑 Clear Data</button>
      </div>

      <div class="ft-status" id="ft-status">Loading…</div>

      <div class="ft-tabs">
        <div class="ft-tab active" data-tab="overview">Overview</div>
        <div class="ft-tab" data-tab="charts">Charts</div>
        <div class="ft-tab" data-tab="transactions">Transactions</div>
      </div>

      <div class="ft-content" id="ft-tab-content">
        <div class="ft-notice">
          📋 <strong>Getting started:</strong> Go to your FMFCU account activity/transactions page,
          then click <strong>Scrape This Page</strong> above. Do this for each page of transactions
          you want to collect. Data is saved in your browser.
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // Events
    function openPanel() {
      panel.classList.add('open');
      overlay.classList.add('open');
      renderPanel();
    }
    function closePanel() {
      panel.classList.remove('open');
      overlay.classList.remove('open');

    }

    toggle.addEventListener('click', () => panel.classList.contains('open') ? closePanel() : openPanel());
    overlay.addEventListener('click', closePanel);
    panel.addEventListener('click', e => { if (e.target.id === 'ft-close' || e.target.closest('#ft-close')) closePanel(); });

    panel.querySelectorAll('.ft-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.ft-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeTab = tab.dataset.tab;
        renderPanel();
      });
    });

    document.getElementById('ft-scrape').addEventListener('click', () => {
      const found = scrapeTransactions();
      if (!found.length) {
        const content = document.getElementById('ft-tab-content');
        content.innerHTML = `
          <div class="ft-notice warn">
            ⚠️ <strong>No transactions found on this page.</strong><br><br>
            Make sure you're on an account activity or transaction history page.
            If the page has loaded transactions, you may need to inspect the DOM and update
            the <code>TRANSACTION_ROW_SELECTORS</code> at the top of this script to match
            FMFCU's current HTML structure.<br><br>
            <strong>How to find the selector:</strong><br>
            1. Right-click a transaction row → Inspect<br>
            2. Find the repeating element wrapping each transaction<br>
            3. Note its tag name, class, or data-testid<br>
            4. Add it to the TRANSACTION_ROW_SELECTORS array in the script
          </div>
        `;
        return;
      }
      const { merged, added } = mergeAndSave(found);
      renderPanel();
      const status = document.getElementById('ft-status');
      if (status) status.innerHTML = `<span class="highlight">+${added} new</span> transactions added (${merged.length} total)`;
    });

    document.getElementById('ft-autoscrape').addEventListener('click', async () => {
      const btn = document.getElementById('ft-autoscrape');
      const scrapeBtn = document.getElementById('ft-scrape');
      const exportBtn = document.getElementById('ft-export');
      const clearBtn = document.getElementById('ft-clear');
      const status = document.getElementById('ft-status');

      // Check we're on the transactions page
      if (!document.querySelector('li.transaction-history-item')) {
        status.innerHTML = `<span style="color:#f85149">⚠ No transactions found — navigate to your account activity page first</span>`;
        return;
      }

      // Disable buttons during scrape
      [btn, scrapeBtn, exportBtn, clearBtn].forEach(b => { if (b) b.disabled = true; });
      btn.textContent = '⏳ Scraping…';

      try {
        let totalAdded = 0;
        totalAdded = await autoScrapeAllPages((page, found, added) => {
          const s = document.getElementById('ft-status');
          if (s) s.innerHTML =
            `Page ${page}: scraped <span class="highlight">${found}</span> transactions (${added} new)…`;
        });

        const s = document.getElementById('ft-status');
        if (s) s.innerHTML =
          `<span class="highlight">✓ Done!</span> ${totalAdded} new transactions added (${loadTransactions().length} total)`;
        renderPanel();
      } catch (err) {
        if (status) status.innerHTML = `<span style="color:#f85149">⚠ Error: ${err.message}</span>`;
      } finally {
        [btn, scrapeBtn, exportBtn, clearBtn].forEach(b => { if (b) b.disabled = false; });
        btn.textContent = '⚡ Auto-Scrape All Pages';
      }
    });


    document.getElementById('ft-clear').addEventListener('click', () => {
      if (confirm('Clear all stored transaction data? This cannot be undone.')) {
        clearTransactions();
        renderPanel();
      }
    });

    document.getElementById('ft-export').addEventListener('click', () => {
      const txns = loadTransactions();
      if (!txns.length) { alert('No data to export.'); return; }
      const header = 'Date,Description,Amount,Category';
      const rows = txns.map(t => `"${t.date}","${t.description.replace(/"/g, '""')}","${t.amount}","${t.category}"`);
      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `fmfcu-transactions-${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    });

    // Register keyboard shortcut (Alt+F)
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key === 'f') {
        panel.classList.contains('open') ? closePanel() : openPanel();
      }
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  INIT
  // ════════════════════════════════════════════════════════════════════════════

  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUI);
  } else {
    createUI();
  }

  // Register Tampermonkey menu commands
  GM_registerMenuCommand('Open Finance Dashboard', () => {
    document.getElementById('ft-panel')?.classList.add('open');
    document.getElementById('ft-overlay')?.classList.add('open');
  });
  GM_registerMenuCommand('Scrape Current Page', () => {
    const found = scrapeTransactions();
    const { added } = mergeAndSave(found);
    alert(`Scraped ${found.length} transactions, ${added} new.`);
  });

})();