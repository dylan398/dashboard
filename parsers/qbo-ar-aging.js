// Shared aging-summary parser logic — used by both A/R and A/P.
// QBO Aging Summary CSV format:
//   Row 0: "<reportname>"   (e.g. "A/R Aging Summary" or "A/P Aging Summary")
//   Row 1: company
//   Row 2: "As of <date>"
//   Row 3: blank
//   Row 4: header — ,Current,1 - 30,31 - 60,61 - 90,91 and over,Total
//   Row 5+: customer/vendor name + 6 numeric columns
//   Final: TOTAL row
function parseAgingCSV(csvText) {
  const lines = csvText.split(/\r?\n/);
  const reportType = (splitCSVRow(lines[0])[0] || '').replace(/^"|"$/g,'').trim();
  const period     = (splitCSVRow(lines[2])[0] || '').replace(/^"|"$/g,'').trim();

  // Find the header row (contains "Current" and "Total")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const l = lines[i].toLowerCase();
    if (l.includes('current') && l.includes('total')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('Could not find aging header row in CSV');

  const entities = [];   // customers (A/R) or vendors (A/P)
  let total = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCSVRow(lines[i]).map(c => c.replace(/^"|"$/g,'').trim());
    if (!cols[0]) continue;
    const name = cols[0];
    const isTotal = /^total$/i.test(name) || name.toLowerCase().startsWith('total ');

    const row = {
      name,
      current:    parseAmount(cols[1]) ?? 0,
      days1_30:   parseAmount(cols[2]) ?? 0,
      days31_60:  parseAmount(cols[3]) ?? 0,
      days61_90:  parseAmount(cols[4]) ?? 0,
      days91_plus:parseAmount(cols[5]) ?? 0,
      total:      parseAmount(cols[6]) ?? 0,
    };
    if (isTotal) {
      total = row;
      break;  // grand total is the last meaningful row
    }
    if (row.total !== 0) entities.push(row);
  }

  entities.sort((a, b) => b.total - a.total);

  if (!total) {
    // Synthesize total from rows if the CSV omitted a TOTAL line
    total = entities.reduce((acc, r) => ({
      name: 'TOTAL',
      current: acc.current + r.current,
      days1_30: acc.days1_30 + r.days1_30,
      days31_60: acc.days31_60 + r.days31_60,
      days61_90: acc.days61_90 + r.days61_90,
      days91_plus: acc.days91_plus + r.days91_plus,
      total: acc.total + r.total,
    }), { name: 'TOTAL', current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days91_plus: 0, total: 0 });
  }

  const pastDue    = total.total - total.current;
  const pastDuePct = total.total ? +((pastDue / total.total) * 100).toFixed(1) : 0;

  return { reportType, period, entities, total, pastDue: +pastDue.toFixed(2), pastDuePct };
}

// Convert "As of Apr 22, 2026" → "2026-04-22" (shared by A/R + A/P)
function agingDateKey(period) {
  const m = (period || '').match(/(\w+)\s+(\d+),?\s+(\d{4})/);
  if (!m) return new Date().toISOString().slice(0, 10);
  const months = {January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
    July:'07',August:'08',September:'09',October:'10',November:'11',December:'12',
    Jan:'01',Feb:'02',Mar:'03',Apr:'04',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  return `${m[3]}-${months[m[1]] || '01'}-${String(m[2]).padStart(2,'0')}`;
}

const PARSER_AR_AGING = {
  id: 'qbo-ar-aging',
  label: 'QuickBooks — A/R Aging Summary',
  fileType: 'csv',
  accept: '.csv',
  hint: 'Export: Reports → A/R Aging Summary → Export to CSV',
  storageStrategy: 'snapshot',
  expectedReportType: /a\/?r\s*aging\s*summary/i,

  getPeriodKey(data) { return agingDateKey(data.meta?.period); },

  async parse(file) {
    const text = await file.text();
    const r = parseAgingCSV(text);
    return {
      meta: { reportType: r.reportType, period: r.period, parsedAt: new Date().toISOString(), customerCount: r.entities.length },
      customers: r.entities,
      summary: r.total,
      pastDue: r.pastDue,
      pastDuePct: r.pastDuePct,
    };
  },

  validate(data) {
    const errors = [], warnings = [];
    if (!data.customers || data.customers.length === 0) errors.push('No customer rows found.');
    if (data.summary?.total === 0) warnings.push('Zero total AR — verify the as-of date.');
    if (data.pastDuePct > 50) warnings.push(`${data.pastDuePct}% of AR is past due — review collections.`);
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

    const custRows = d.customers.slice(0, 15).map((c, i) =>
      `<tr><td class="muted">${i+1}</td><td>${c.name}</td><td>${fmt(c.total)}</td><td class="muted">${c.days91_plus > 0 ? `<span style="color:var(--red)">${fmt(c.days91_plus)} 91+</span>` : ''}</td></tr>`
    ).join('');

    return `
      <div class="preview-meta">${d.meta.period} · Snapshot key: <strong>${this.getPeriodKey(d)}</strong> · ${d.meta.customerCount} customers</div>
      <div class="preview-cols">
        <div>
          <div class="preview-sub-title">Aging buckets</div>
          <table class="preview-table">
            <tr><th>Bucket</th><th>Amount</th><th>% of Total</th></tr>
            ${bucketRows}
            <tr class="total"><td>Total AR</td><td>${fmt(total)}</td><td>100%</td></tr>
          </table>
          <div class="preview-kpis">
            <div class="pkpi"><span class="pkpi-label">Past Due %</span><span class="pkpi-val ${d.pastDuePct > 50 ? 'red' : d.pastDuePct > 30 ? 'orange' : 'green'}">${d.pastDuePct}%</span></div>
          </div>
        </div>
        <div>
          <div class="preview-sub-title">Top 15 customers by AR</div>
          <table class="preview-table">
            <tr><th>#</th><th>Customer</th><th>Total</th><th></th></tr>
            ${custRows}
          </table>
        </div>
      </div>`;
  }
};
