const PARSER_SALES = {
  id: 'qbo-sales',
  label: 'QuickBooks — Sales by Customer Detail',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → Sales by Customer Detail → All Dates → Export to CSV',
  storageStrategy: 'merge',  // monthly data merged, never overwritten

  getPeriodKey(data) {
    return data.meta?.period || 'all-dates';
  },

  async parse(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/);

    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Transaction date')) { headerIdx = i; break; }
    }
    if (headerIdx < 0) throw new Error('Could not find header row in Sales by Customer CSV');

    const period = lines[2] ? lines[2].replace(/^"|"$/g,'').replace(/,+$/,'').trim() : '';
    const dateIdx=1, productIdx=4, amtIdx=8;

    const customers = {};
    let currentCustomer = '';
    const monthly = {};
    const services = {};

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const cols = splitCSVRow(lines[i]);
      if (!cols || !cols[0] && !cols[1]) continue;

      if (cols[0] && cols[0].trim() && !cols[1]) {
        const name = cols[0].replace(/^"|"$/g,'').trim();
        if (!name.startsWith('Total for') && name) {
          currentCustomer = name;
          if (!customers[currentCustomer]) customers[currentCustomer] = { name: currentCustomer, total: 0, txCount: 0 };
        }
        continue;
      }
      if (cols[0] && cols[0].includes('Total for')) continue;

      const dateStr = cols[dateIdx] ? cols[dateIdx].replace(/^"|"$/g,'').trim() : '';
      const amt = parseAmount(cols[amtIdx]);
      if (!dateStr || amt == null || !currentCustomer) continue;

      const dateParts = dateStr.split('/');
      if (dateParts.length !== 3) continue;
      const [mon, , yr] = dateParts;
      const monthKey = yr + '-' + mon.padStart(2,'0');

      if (customers[currentCustomer]) {
        customers[currentCustomer].total += amt;
        customers[currentCustomer].txCount++;
      }
      monthly[monthKey] = (monthly[monthKey] || 0) + amt;

      const product = cols[productIdx] ? cols[productIdx].replace(/^"|"$/g,'').trim() : 'Unknown';
      if (product) services[product] = (services[product] || 0) + amt;
    }

    const topCustomers = Object.values(customers)
      .sort((a,b) => b.total - a.total).slice(0, 25)
      .map(c => ({ ...c, total: +c.total.toFixed(2) }));

    const monthlyByYear = {};
    Object.entries(monthly).forEach(([key, val]) => {
      const [yr, mo] = key.split('-');
      if (!monthlyByYear[yr]) monthlyByYear[yr] = new Array(12).fill(0);
      monthlyByYear[yr][parseInt(mo)-1] += val;
    });
    Object.keys(monthlyByYear).forEach(yr => {
      monthlyByYear[yr] = monthlyByYear[yr].map(v => +v.toFixed(2));
    });

    const annualTotals = {};
    Object.entries(monthlyByYear).forEach(([yr, months]) => {
      annualTotals[yr] = +months.reduce((s,v)=>s+v,0).toFixed(2);
    });

    const topServices = Object.entries(services)
      .sort((a,b) => b[1]-a[1]).slice(0, 20)
      .map(([name, amount]) => ({ name, amount: +amount.toFixed(2) }));

    return {
      meta: { period, parsedAt: new Date().toISOString() },
      topCustomers, monthlyByYear, annualTotals, topServices,
      totalRevenue: +Object.values(annualTotals).reduce((s,v)=>s+v,0).toFixed(2)
    };
  },

  renderPreview(data) {
    const d = data;
    const years = Object.keys(d.annualTotals||{}).sort();
    const annualRows = years.map(yr =>
      `<tr><td>${yr}</td><td>${fmt(d.annualTotals[yr])}</td></tr>`).join('');

    const custRows = (d.topCustomers||[]).slice(0,12).map((c,i) =>
      `<tr><td class="muted">${String(i+1).padStart(2,'0')}</td><td>${c.name}</td><td>${fmt(c.total)}</td><td class="muted">${c.txCount} tx</td></tr>`
    ).join('');

    const svcRows = (d.topServices||[]).slice(0,10).map(s =>
      `<tr><td>${s.name}</td><td>${fmt(s.amount)}</td></tr>`).join('');

    return `
      <div class="preview-meta">${d.meta.period} · Strategy: <strong>MERGE</strong> — new months add, existing months update, nothing deleted</div>
      <div class="preview-cols">
        <div>
          <div class="preview-sub-title">Annual Revenue (this upload)</div>
          <table class="preview-table">
            <tr><th>Year</th><th>Revenue</th></tr>
            ${annualRows}
            <tr class="total"><td>Total</td><td>${fmt(d.totalRevenue)}</td></tr>
          </table>
        </div>
        <div>
          <div class="preview-sub-title">Top Services</div>
          <table class="preview-table">${svcRows}</table>
        </div>
      </div>
      <div class="preview-sub-title">Top 12 Customers</div>
      <table class="preview-table">
        <tr><th>#</th><th>Customer</th><th>Revenue</th><th>Transactions</th></tr>
        ${custRows}
      </table>`;
  }
};
