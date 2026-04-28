SFS Financial Dashboard
A static, Firebase-backed financial reporting platform for Semper Fi
Striping LLC — a Texas pavement-marking subcontractor.
▶ For Claude (or any LLM working on this repo)
Read docs/CONTEXT.md first. It's the rules of the world: who SFS
is, the industry-specific dynamics that override generic best practices
(TX subcontractor payment realities, Knowify data quirks, seasonality,
etc.), DFW competitor landscape, financial benchmarks for sub-$50M
commercial construction subs, and the data-quality caveats baked into
the dashboard. Without that context, half the metrics get
misinterpreted as alarms when they're industry-normal — or vice versa.
After CONTEXT.md, the next stop is the top-of-file comment block in
core/dash.js, which is the architectural summary.
Repository structure
dashboard/
├── README.md                  ← you are here
├── docs/
│   └── CONTEXT.md             ← BUSINESS + INDUSTRY CONTEXT (read first)
├── index.html                 ← Overview (the dashboard home)
├── reports/
│   ├── insights.html          ← Auto-generated business observations
│   ├── pl.html                ← Revenue & Profit
│   ├── cash.html              ← Cash & Balance Sheet
│   ├── customers.html         ← Customers & AR (days-to-pay framing)
│   ├── vendors.html           ← Vendors & AP
│   └── pipeline.html          ← Knowify pipeline (with SFS rules)
├── viewer.html                ← Raw-data browser
├── admin.html                 ← Data ingest portal (password-gated)
├── core/
│   ├── firebase.js            ← Firebase init + DB read/write helpers
│   ├── utils.js               ← CSV parsing, formatters, splitCSVRow
│   ├── dash.js                ← Shared metrics + Knowify rule engine + insights
│   └── nav.js                 ← Multi-page nav header
└── parsers/
    ├── qbo-pl.js              ← P&L (annual)
    ├── qbo-pl-monthly.js      ← P&L by Month (current year)
    ├── qbo-bs.js              ← Balance Sheet (every snapshot kept)
    ├── qbo-cf.js              ← Cash Flow Statement
    ├── qbo-sales.js           ← Sales by Customer Detail
    ├── qbo-transactions.js    ← Transaction Detail by Account
    ├── qbo-ar-aging.js        ← A/R Aging Summary
    ├── qbo-ap-aging.js        ← A/P Aging Summary
    ├── qbo-open-invoices.js   ← Open Invoices (CSV + XLSX)
    └── knowify-jobs.js        ← Knowify Advanced Jobs Report (XLSX)
Live URLs

Reports/Overview: https://dylan398.github.io/dashboard/
Insights: https://dylan398.github.io/dashboard/reports/insights.html
Viewer (raw data): https://dylan398.github.io/dashboard/viewer.html
Admin (data upload): https://dylan398.github.io/dashboard/admin.html

How it works

Dylan exports financial reports from QuickBooks Online and Knowify
Drops them into the Admin page; in-browser parsers extract
structured data
Data writes to Firebase Realtime Database under /dashboard/...
Every report page reads via loadDashboard() (in core/dash.js)
which subscribes to live updates
Reports are pure presentation — all metric logic lives in dash.js

How to make changes
If you're a future Claude chat:

Read docs/CONTEXT.md
Read core/dash.js's top-of-file comment block
The architecture rules in CONTEXT.md §8 explain what goes where
Pure functions, return null on missing data (never NaN), document
business meaning + thresholds for every new metric

If you're Dylan:

Refresh data via the Admin page
Edit files via GitHub web UI / Desktop / CLI
GitHub Pages auto-deploys ~1 min after push (hard-refresh your
browser if a script update isn't picked up)

Storage strategies (Firebase paths)

period — one record per period (year). Path:
dashboard/{datasetId}/periods/{year}
snapshot — every dated snapshot kept forever. Path:
dashboard/{datasetId}/snapshots/{YYYY-MM-DD}
merge — accumulating data merged at write time (sales, txns,
knowify summary). Path: dashboard/{datasetId}/

See core/firebase.js for the implementation. Don't change a
dataset's strategy — it would orphan history.
Authentication
The Admin page is gated by a password (clientside check, not real
security). The actual security boundary is the Firebase Realtime DB
rules — separate from this repo. The dashboard data lives at
/dashboard/* and is isolated from the unrelated SFS crew-scheduler
data at /sched/*.
Tech stack

Static HTML hosted on GitHub Pages (no build step)
Firebase Realtime Database for storage
Chart.js 4.4.1 for visualizations
SheetJS for XLSX parsing in the browser
No frameworks — vanilla JS, vanilla CSS, dark theme with yellow accent
