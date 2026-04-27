const PARSER_PL = {
  id: 'qbo-pl',
  label: 'QuickBooks — Profit & Loss',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → Profit and Loss → Export to CSV',

  async parse(file) {
    const text = await file.text();
    const { meta, rows } = parseQBORows(text);

    // Key lookups
    const get = (...pats) => (findRow(rows, ...pats) || {}).value;

    const revenue       = get('total for income', 'total income');
    const cogsTotal     = get('total for cost of goods sold');
    const grossProfit   = get('gross profit');
    const opexTotal     = get('total for expenses');
    const netOpIncome   = get('net operating income');
    const netIncome     = get('net income');
    const depreciation  = get('depreciation');

    // COGS line items (rows between "Cost of Goods Sold" section and its Total)
    const cogsSection = findSection(rows, 'cost of goods sold', 'total for cost of goods sold');
    const cogsItems = {};
    cogsSection.filter(r => r.value != null && !r.isTotal).forEach(r => {
      cogsItems[r.name] = r.value;
    });

    // OpEx line items
    const opexSection = findSection(rows, 'expenses', 'total for expenses');
    const opexItems = {};
    opexSection.filter(r => r.value != null && !r.isTotal && !r.name.startsWith('Total')).forEach(r => {
      // Collapse "Total for Payroll Expenses" etc. into parent
      if (!r.name.startsWith('Total for')) opexItems[r.name] = (opexItems[r.name] || 0) + r.value;
    });

    return {
      meta: { ...meta, parsedAt: new Date().toISOString() },
      revenue, cogsTotal, grossProfit, opexTotal, netOpIncome, netIncome, depreciation,
      grossMarginPct: revenue ? +(grossProfit / revenue * 100).toFixed(2) : null,
      netMarginPct:   revenue ? +(netIncome / revenue * 100).toFixed(2) : null,
      ebitda: netIncome != null && depreciation != null && opexItems['Interest Paid'] != null
        ? netIncome + depreciation + (opexItems['Interest Paid'] || 0) : null,
      cogs: cogsItems,
      opex: opexItems,
      rawRows: rows.map(r => ({ name: r.name, value: r.value, isTotal: r.isTotal, indent: r.indent }))
    };
  },

  renderPreview(data) {
    const r = data;
    const row = (label, val, sub, cls='') =>
      `<tr class="${cls}"><td>${label}</td><td>${val != null ? fmt(val) : '—'}</td><td class="muted">${sub||''}</td></tr>`;

    let cogsRows = Object.entries(r.cogs||{}).map(([k,v]) =>
      row('  ' + k, v, fmtPct(v, r.revenue), 'sub')).join('');
    let opexRows = Object.entries(r.opex||{}).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,v]) =>
      row('  ' + k, v, fmtPct(v, r.revenue), 'sub')).join('');

    return `
      <div class="preview-meta">${r.meta.period} · ${r.meta.basis||'Accrual'}</div>
      <table class="preview-table">
        <tr><th>Line Item</th><th>Amount</th><th>% Revenue</th></tr>
        ${row('Total Revenue', r.revenue, '100%', 'total')}
        ${row('Cost of Goods Sold', r.cogsTotal ? -r.cogsTotal : null, fmtPct(r.cogsTotal, r.revenue), 'total')}
        ${cogsRows}
        ${row('Gross Profit', r.grossProfit, r.grossMarginPct!=null ? r.grossMarginPct.toFixed(1)+'%' : '', 'total highlight')}
        ${row('Operating Expenses', r.opexTotal ? -r.opexTotal : null, fmtPct(r.opexTotal, r.revenue), 'total')}
        ${opexRows}
        ${row('Net Operating Income', r.netOpIncome, fmtPct(r.netOpIncome, r.revenue), 'total highlight')}
        ${r.depreciation != null ? row('  Depreciation', -r.depreciation, '', 'sub') : ''}
        ${row('Net Income', r.netIncome, r.netMarginPct!=null ? r.netMarginPct.toFixed(1)+'%' : '', 'total highlight-strong')}
        ${r.ebitda != null ? row('EBITDA (est.)', r.ebitda, fmtPct(r.ebitda, r.revenue)) : ''}
      </table>`;
  }
};
