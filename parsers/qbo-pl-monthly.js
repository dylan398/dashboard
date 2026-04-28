const PARSER_PL_MONTHLY = {
  id: 'qbo-pl-monthly',
  label: 'QuickBooks — P&L by Month',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → Profit and Loss → Display columns by Month → Export to CSV',
  storageStrategy: 'period',     // one record per year — replaces itself when re-exported
  expectedReportType: /profit\s*(and|&)\s*loss/i,

  // QBO Monthly P&L CSV format:
  //   Row 0: "Profit and Loss"
  //   Row 1: company
  //   Row 2: "<date range>"   e.g. "January-April, 2026"
  //   Row 3: blank
  //   Row 4: ,Jan 2026,Feb 2026,Mar 2026,Apr 2026,Total
  //   Row 5+: account rows with N month columns + total
  //
  // We extract the year from row 2 and store the per-line monthly arrays
  // alongside aggregated key totals. Storage key = year (overwrites itself).

  getPeriodKey(data) {
    const p = data.meta?.period || '';
    const years = p.match(/\d{4}/g);
    return years ? years[years.length - 1] : new Date().getFullYear().toString();
  },

  async parse(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    const reportType = (splitCSVRow(lines[0])[0] || '').replace(/^"|"$/g,'').trim();
    const period     = (splitCSVRow(lines[2])[0] || '').replace(/^"|"$/g,'').trim();

    // Find the header row (it has month names + Total)
    let headerIdx = -1;
    for (let i = 3; i < Math.min(8, lines.length); i++) {
      const cols = splitCSVRow(lines[i]).map(c => c.replace(/^"|"$/g,'').trim());
      if (cols.some(c => /^total$/i.test(c)) && cols.some(c => /^\w{3}\s+\d{4}$/i.test(c))) {
        headerIdx = i; break;
      }
    }
    if (headerIdx < 0) throw new Error('Could not find monthly header row — verify Display columns is set to Months.');

    const headerCols = splitCSVRow(lines[headerIdx]).map(c => c.replace(/^"|"$/g,'').trim());
    // headerCols looks like ['', 'Jan 2026', 'Feb 2026', ..., 'Total']
    const monthHeaders = headerCols.slice(1).filter(h => h && !/total/i.test(h));
    const monthCount = monthHeaders.length;
    const totalColIdx = headerCols.length - 1;

    const accounts = {};   // { accountName: { months: [...], total: N, isTotal: bool } }

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = splitCSVRow(lines[i]).map(c => c.replace(/^"|"$/g,'').trim());
      const name = cols[0];
      if (!name) continue;
      const isTotal = name.toLowerCase().startsWith('total ') || name.toLowerCase().startsWith('net ') ||
                      /^net (income|operating income|other income)$/i.test(name) ||
                      /^gross profit$/i.test(name);
      const months = [];
      for (let j = 1; j <= monthCount; j++) months.push(parseAmount(cols[j]) ?? 0);
      const total = parseAmount(cols[totalColIdx]) ?? 0;
      accounts[name] = { months, total, isTotal };
    }

    // Pull key metrics into named slots
    const lookup = (...patterns) => {
      const pats = patterns.map(p => p.toLowerCase());
      for (const k of Object.keys(accounts)) {
        const lk = k.toLowerCase();
        if (pats.some(p => lk === p || lk.startsWith(p))) return accounts[k];
      }
      return null;
    };

    const revenueAcct  = lookup('total for income', 'total income');
    const cogsAcct     = lookup('total for cost of goods sold');
    const grossAcct    = lookup('gross profit');
    const opexAcct     = lookup('total for expenses');
    const netOpAcct    = lookup('net operating income');
    const netIncAcct   = lookup('net income');

    // Helper to extract metric arrays
    const arr = (a) => a ? a.months.slice() : new Array(monthCount).fill(null);
    const tot = (a) => a ? a.total : null;

    // Year + month-keyed monthly data for downstream consumers
    const yearMatch = period.match(/\d{4}/g);
    const year = yearMatch ? yearMatch[yearMatch.length - 1] : String(new Date().getFullYear());

    return {
      meta: { reportType, period, parsedAt: new Date().toISOString(), monthCount, year, monthHeaders },
      revenue:      { months: arr(revenueAcct),  total: tot(revenueAcct) },
      cogs:         { months: arr(cogsAcct),     total: tot(cogsAcct) },
      grossProfit:  { months: arr(grossAcct),    total: tot(grossAcct) },
      opex:         { months: arr(opexAcct),     total: tot(opexAcct) },
      netOpIncome:  { months: arr(netOpAcct),    total: tot(netOpAcct) },
      netIncome:    { months: arr(netIncAcct),   total: tot(netIncAcct) },
      // Computed monthly margins (gross profit / revenue per month)
      grossMarginByMonth: arr(revenueAcct).map((rev, i) =>
        rev && grossAcct ? +((grossAcct.months[i] / rev) * 100).toFixed(2) : null
      ),
      netMarginByMonth: arr(revenueAcct).map((rev, i) =>
        rev && netIncAcct ? +((netIncAcct.months[i] / rev) * 100).toFixed(2) : null
      ),
      accounts,    // every line item, full-width — for the viewer's drill-down
    };
  },

  validate(data) {
    const errors = [], warnings = [];
    if (!data.revenue || data.revenue.total == null) {
      errors.push('No revenue total found — this may not be a Monthly P&L (check Display columns = Months).');
    }
    if (data.meta?.monthCount && data.meta.monthCount < 2) {
      warnings.push(`Only ${data.meta.monthCount} month(s) in this export — pick a wider date range for a useful trend.`);
    }
    return { errors, warnings };
  },

  renderPreview(data) {
    const d = data;
    const months = d.meta.monthHeaders;

    const row = (label, valArr, total, cls='') => {
      const cells = valArr.map(v => `<td>${v != null ? fmtK(v) : '—'}</td>`).join('');
      return `<tr class="${cls}"><td>${label}</td>${cells}<td><strong>${total != null ? fmt(total) : '—'}</strong></td></tr>`;
    };
    const monthHeader = months.map(m => `<th>${m}</th>`).join('');

    return `
      <div class="preview-meta">${d.meta.period} · Year: <strong>${d.meta.year}</strong> · ${d.meta.monthCount} months</div>
      <table class="preview-table" style="font-size:11px">
        <tr><th>Line</th>${monthHeader}<th>Total</th></tr>
        ${row('Revenue',         d.revenue.months,     d.revenue.total,     'total')}
        ${row('COGS',            d.cogs.months.map(v => v ? -v : v), d.cogs.total ? -d.cogs.total : null)}
        ${row('Gross Profit',    d.grossProfit.months, d.grossProfit.total, 'total highlight')}
        ${row('OpEx',            d.opex.months.map(v => v ? -v : v), d.opex.total ? -d.opex.total : null)}
        ${row('Net Op. Income',  d.netOpIncome.months, d.netOpIncome.total, 'total highlight')}
        ${row('Net Income',      d.netIncome.months,   d.netIncome.total,   'total highlight-strong')}
      </table>`;
  }
};
