const PARSER_CF = {
  id: 'qbo-cf',
  label: 'QuickBooks — Cash Flow',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → Statement of Cash Flows → Export to CSV',

  async parse(file) {
    const text = await file.text();
    const { meta, rows } = parseQBORows(text);
    const get = (...pats) => (findRow(rows, ...pats) || {}).value;

    const netIncome      = get('net income');
    const operatingCF    = get('net cash provided by operating');
    const investingCF    = get('net cash provided by investing');
    const financingCF    = get('net cash provided by financing');
    const netCashChange  = get('net cash increase', 'net cash decrease');
    const beginCash      = get('cash at beginning');
    const endCash        = get('cash at end');

    // Operating adjustments detail
    const opAdj = findSection(rows, 'adjustments to reconcile', 'net cash provided by operating');
    const opAdjItems = opAdj
      .filter(r => r.value != null && !r.isTotal && Math.abs(r.value) > 0)
      .map(r => ({ name: r.name, value: r.value }));

    // Financing detail
    const finSection = findSection(rows, 'financing activities', 'net cash provided by financing');
    const finItems = finSection
      .filter(r => r.value != null && !r.isTotal && Math.abs(r.value) > 0)
      .map(r => ({ name: r.name, value: r.value }));

    return {
      meta: { ...meta, parsedAt: new Date().toISOString() },
      netIncome, operatingCF, investingCF, financingCF,
      netCashChange, beginCash, endCash,
      opAdjItems, finItems,
      rawRows: rows.map(r => ({ name: r.name, value: r.value, isTotal: r.isTotal }))
    };
  },

  renderPreview(data) {
    const d = data;
    const row = (label, val, cls='') =>
      `<tr class="${cls}"><td>${label}</td><td style="color:${val>0?'var(--green)':val<0?'var(--red)':'inherit'}">${val!=null?fmt(val):'—'}</td></tr>`;

    return `
      <div class="preview-meta">${d.meta.period}</div>
      <table class="preview-table">
        <tr><th>Activity</th><th>Amount</th></tr>
        ${row('Net Income', d.netIncome)}
        ${row('Operating Activities', d.operatingCF, 'total')}
        ${row('Investing Activities', d.investingCF, 'total')}
        ${row('Financing Activities', d.financingCF, 'total')}
        <tr class="divider"><td colspan="2"></td></tr>
        ${row('Net Cash Change', d.netCashChange, 'total highlight')}
        ${row('Beginning Cash', d.beginCash)}
        ${row('Ending Cash', d.endCash, 'total highlight-strong')}
      </table>
      ${d.finItems && d.finItems.length ? `
      <div class="preview-sub-title">Financing detail</div>
      <table class="preview-table">
        ${d.finItems.map(i => row('  '+i.name, i.value, 'sub')).join('')}
      </table>` : ''}`;
  }
};
