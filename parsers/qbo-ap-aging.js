// A/P Aging — same QBO format as A/R, but vendors instead of customers.
// Reuses parseAgingCSV() and agingDateKey() from qbo-ar-aging.js.
const PARSER_AP_AGING = {
  id: 'qbo-ap-aging',
  label: 'QuickBooks — A/P Aging Summary',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → A/P Aging Summary → Export to CSV',
  storageStrategy: 'snapshot',
  expectedReportType: /a\/?p\s*aging\s*summary/i,

  getPeriodKey(data) { return agingDateKey(data.meta?.period); },

  async parse(file) {
    const text = await file.text();
    const r = parseAgingCSV(text);
    return {
      meta: { reportType: r.reportType, period: r.period, parsedAt: new Date().toISOString(), vendorCount: r.entities.length },
      vendors: r.entities,
      summary: r.total,
      pastDue: r.pastDue,
      pastDuePct: r.pastDuePct,
    };
  },

  validate(data) {
    const errors = [], warnings = [];
    if (!data.vendors || data.vendors.length === 0) errors.push('No vendor rows found.');
    if (data.summary?.total === 0) warnings.push('Zero total AP — verify the as-of date.');
    if (data.pastDuePct > 30) warnings.push(`${data.pastDuePct}% of AP is past due — vendor relationships at risk.`);
    return { errors, warnings };
  },

  renderPreview(data) {
    const d = data;
    const total = d.summary.total;
    const bucketRows = [
      ['Current',     d.summary.current],
      ['1 – 30',      d.summary.days1_30],
      ['31 – 60',     d.summary.days31_60],
      ['61 – 90',     d.summary.days61_90],
      ['91 and over', d.summary.days91_plus],
    ].map(([label, val]) =>
      `<tr><td>${label}</td><td>${fmt(val)}</td><td class="muted">${total ? (val/total*100).toFixed(1)+'%' : '—'}</td></tr>`
    ).join('');

    const vendRows = d.vendors.slice(0, 15).map((v, i) =>
      `<tr><td class="muted">${i+1}</td><td>${v.name}</td><td>${fmt(v.total)}</td><td class="muted">${v.days91_plus > 0 ? `<span style="color:var(--red)">${fmt(v.days91_plus)} 91+</span>` : ''}</td></tr>`
    ).join('');

    return `
      <div class="preview-meta">${d.meta.period} · Snapshot key: <strong>${this.getPeriodKey(d)}</strong> · ${d.meta.vendorCount} vendors</div>
      <div class="preview-cols">
        <div>
          <div class="preview-sub-title">Aging buckets</div>
          <table class="preview-table">
            <tr><th>Bucket</th><th>Amount</th><th>% of Total</th></tr>
            ${bucketRows}
            <tr class="total"><td>Total AP</td><td>${fmt(total)}</td><td>100%</td></tr>
          </table>
          <div class="preview-kpis">
            <div class="pkpi"><span class="pkpi-label">Past Due %</span><span class="pkpi-val ${d.pastDuePct > 30 ? 'red' : d.pastDuePct > 15 ? 'orange' : 'green'}">${d.pastDuePct}%</span></div>
          </div>
        </div>
        <div>
          <div class="preview-sub-title">Top 15 vendors by AP</div>
          <table class="preview-table">
            <tr><th>#</th><th>Vendor</th><th>Total</th><th></th></tr>
            ${vendRows}
          </table>
        </div>
      </div>`;
  }
};
