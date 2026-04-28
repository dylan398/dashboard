const PARSER_BS = {
  id: 'qbo-bs',
  label: 'QuickBooks — Balance Sheet',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → Balance Sheet → Export to CSV',
  storageStrategy: 'snapshot',  // every as-of date preserved forever
  expectedReportType: /balance\s*sheet/i,

  getPeriodKey(data) {
    // "As of Apr 21, 2026" → "2026-04-21"
    const p = data.meta?.period || '';
    const m = p.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
    if (!m) return new Date().toISOString().slice(0, 10);
    const months = {January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
      July:'07',August:'08',September:'09',October:'10',November:'11',December:'12',
      Jan:'01',Feb:'02',Mar:'03',Apr:'04',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const mo = months[m[1]] || '01';
    return `${m[3]}-${mo}-${String(m[2]).padStart(2,'0')}`;
  },

  async parse(file) {
    const text = await file.text();
    const { meta, rows } = parseQBORows(text);
    const get = (...pats) => (findRow(rows, ...pats) || {}).value ?? null;

    const totalAssets          = get('total for assets', 'total assets');
    const totalCurrentAssets   = get('total for current assets');
    const cash                 = get('total for bank accounts');
    const ar                   = get('total for accounts receivable');
    const otherCurrentAssets   = get('total for other current assets');
    const fixedAssetsNet       = get('total for fixed assets');
    const totalLiabilities     = get('total for liabilities');
    const totalCurrentLiab     = get('total for current liabilities');
    const ap                   = get('total for accounts payable');
    const creditCards          = get('total for credit cards');
    const otherCurrentLiab     = get('total for other current liabilities');
    const longTermLiab         = get('total for long-term liabilities', 'total for long term');
    const totalEquity          = get('total for equity');
    const netIncome            = get('net income');
    const retainedEarnings     = get('retained earnings');

    const ltSection = findSection(rows, 'long-term liabilities', 'total for long-term');
    const ltDebts = ltSection
      .filter(r => r.value != null && !r.isTotal && !r.name.startsWith('Total'))
      .map(r => ({ name: r.name, amount: r.value }))
      .filter(r => r.amount !== 0);

    const workingCapital = (totalCurrentAssets != null && totalCurrentLiab != null)
      ? +(totalCurrentAssets - totalCurrentLiab).toFixed(2) : null;
    const currentRatio = (totalCurrentAssets && totalCurrentLiab)
      ? +(totalCurrentAssets / totalCurrentLiab).toFixed(2) : null;

    return {
      meta: { ...meta, parsedAt: new Date().toISOString() },
      totalAssets, totalCurrentAssets, cash, ar, otherCurrentAssets, fixedAssetsNet,
      totalLiabilities, totalCurrentLiab, ap, creditCards, otherCurrentLiab, longTermLiab,
      totalEquity, netIncome, retainedEarnings,
      workingCapital, currentRatio,
      ltDebts,
      rawRows: rows.map(r => ({ name: r.name, value: r.value ?? null, isTotal: r.isTotal, indent: r.indent }))
    };
  },

  validate(data) {
    const errors = [], warnings = [];
    if (data.totalAssets == null && data.totalLiabilities == null && data.totalEquity == null) {
      errors.push('No assets, liabilities, or equity totals found — this may not be a Balance Sheet.');
    }
    // Accounting identity: assets ≈ liabilities + equity
    if (data.totalAssets != null && data.totalLiabilities != null && data.totalEquity != null) {
      const lhs = data.totalAssets;
      const rhs = data.totalLiabilities + data.totalEquity;
      const diff = Math.abs(lhs - rhs);
      const tol  = Math.max(1, Math.abs(lhs) * 0.001); // 0.1% tolerance, min $1
      if (diff > tol) {
        warnings.push(`Balance sheet doesn't balance: assets ${lhs.toFixed(2)} vs liab+equity ${rhs.toFixed(2)} (off by ${diff.toFixed(2)}).`);
      }
    }
    if (data.cash == null) warnings.push('No bank accounts total found — verify export.');
    return { errors, warnings };
  },

  renderPreview(data) {
    const d = data;
    const key = this.getPeriodKey(d);
    const row = (label, val, cls='') =>
      `<tr class="${cls}"><td>${label}</td><td>${val != null ? fmt(val) : '—'}</td></tr>`;

    const debtRows = (d.ltDebts||[]).filter(x=>x.amount!==0).map(dt =>
      row('  '+dt.name, dt.amount, 'sub')).join('');

    return `
      <div class="preview-meta">${d.meta.period} · Snapshot key: <strong>${key}</strong> · Will be stored permanently</div>
      <div class="preview-cols">
        <div>
          <table class="preview-table">
            <tr><th colspan="2">Assets</th></tr>
            ${row('Cash & Bank', d.cash)}
            ${row('Accounts Receivable', d.ar)}
            ${row('Other Current Assets', d.otherCurrentAssets)}
            ${row('Total Current Assets', d.totalCurrentAssets, 'total')}
            ${row('Fixed Assets (net)', d.fixedAssetsNet)}
            ${row('Total Assets', d.totalAssets, 'total highlight-strong')}
          </table>
        </div>
        <div>
          <table class="preview-table">
            <tr><th colspan="2">Liabilities & Equity</th></tr>
            ${row('Accounts Payable', d.ap)}
            ${row('Credit Cards', d.creditCards)}
            ${row('Other Current Liab.', d.otherCurrentLiab)}
            ${row('Total Current Liab.', d.totalCurrentLiab, 'total')}
            ${row('Long-Term Debt', d.longTermLiab)}
            ${debtRows}
            ${row('Total Liabilities', d.totalLiabilities, 'total')}
            ${row('Total Equity', d.totalEquity)}
            ${row('Total Liab. + Equity', d.totalAssets, 'total highlight-strong')}
          </table>
        </div>
      </div>
      <div class="preview-kpis">
        <div class="pkpi"><span class="pkpi-label">Working Capital</span><span class="pkpi-val ${d.workingCapital>=0?'green':'red'}">${fmt(d.workingCapital)}</span></div>
        <div class="pkpi"><span class="pkpi-label">Current Ratio</span><span class="pkpi-val ${d.currentRatio>=1.5?'green':d.currentRatio>=1?'orange':'red'}">${d.currentRatio||'—'}x</span></div>
        <div class="pkpi"><span class="pkpi-label">AR Outstanding</span><span class="pkpi-val yellow">${fmt(d.ar)}</span></div>
      </div>`;
  }
};
