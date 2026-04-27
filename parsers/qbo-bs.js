const PARSER_BS = {
  id: 'qbo-bs',
  label: 'QuickBooks — Balance Sheet',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → Balance Sheet → Export to CSV',

  async parse(file) {
    const text = await file.text();
    const { meta, rows } = parseQBORows(text);
    const get = (...pats) => (findRow(rows, ...pats) || {}).value;

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

    // Long-term debt detail (notes payable)
    const ltSection = findSection(rows, 'long-term liabilities', 'total for long-term');
    const ltDebts = ltSection
      .filter(r => r.value != null && !r.isTotal && !r.name.startsWith('Total'))
      .map(r => ({ name: r.name, amount: r.value }))
      .filter(r => r.amount !== 0);

    // Credit card detail
    const ccSection = findSection(rows, 'credit cards', 'total for credit cards');
    const creditCardItems = {};
    ccSection.filter(r => r.value != null && !r.isTotal).forEach(r => {
      if (!r.name.startsWith('Total')) creditCardItems[r.name] = r.value;
    });

    const workingCapital = (totalCurrentAssets != null && totalCurrentLiab != null)
      ? totalCurrentAssets - totalCurrentLiab : null;
    const currentRatio = (totalCurrentAssets && totalCurrentLiab)
      ? +(totalCurrentAssets / totalCurrentLiab).toFixed(2) : null;
    const dso = (ar && get('total for income'))
      ? Math.round(ar / (get('total for income') / 365)) : null;

    return {
      meta: { ...meta, parsedAt: new Date().toISOString() },
      totalAssets, totalCurrentAssets, cash, ar, otherCurrentAssets, fixedAssetsNet,
      totalLiabilities, totalCurrentLiab, ap, creditCards, otherCurrentLiab, longTermLiab,
      totalEquity, netIncome, retainedEarnings,
      workingCapital, currentRatio,
      ltDebts,
      creditCardItems,
      rawRows: rows.map(r => ({ name: r.name, value: r.value, isTotal: r.isTotal, indent: r.indent }))
    };
  },

  renderPreview(data) {
    const d = data;
    const row = (label, val, cls='') =>
      `<tr class="${cls}"><td>${label}</td><td>${val != null ? fmt(val) : '—'}</td></tr>`;

    const debtRows = (d.ltDebts||[]).map(dt =>
      row('  ' + dt.name, dt.amount, 'sub')).join('');

    return `
      <div class="preview-meta">${d.meta.period} · ${d.meta.basis||'Accrual'}</div>
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
            ${row('Total Equity', d.totalEquity, 'total')}
            ${row('Net Income (YTD)', d.netIncome)}
            ${row('Liab. + Equity', d.totalAssets, 'total highlight-strong')}
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
