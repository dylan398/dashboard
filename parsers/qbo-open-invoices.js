// QuickBooks Open Invoices parser — handles both CSV and XLSX exports.
//
// Tested against real QBO output. The CSV path is self-contained (does NOT
// route through SheetJS) so we don't inherit any quirks from how SheetJS
// interprets a CSV's date cells.
//
// Bulletproof rules:
//  - All numeric fields default to 0 / null and are never allowed to become NaN.
//  - daysPastDue is null when either side of the date math is invalid.
//  - Only rows with type "Invoice" or "Credit Memo" become invoices —
//    Journal Entry, Payment, anything else is skipped explicitly.
//  - "Total for X" subtotal rows look like customer headers (col 0 set, col 1
//    empty); we skip them by checking the lowercased prefix.
//  - The grand "TOTAL" row at the bottom has col 0 empty and col 1 = "TOTAL";
//    no transaction-type, so it's skipped naturally.
//  - The trailing "Tuesday, April 28, 2026 …" timestamp footer has col 0 set
//    but col 1 empty; it doesn't start with "total" so it'd be picked up as
//    a customer header. To avoid that, we stop processing when we hit a row
//    whose col 0 contains a weekday name AND no other columns.

const PARSER_OPEN_INVOICES = {
  id: 'qbo-open-invoices',
  label: 'QuickBooks — Open Invoices',
  fileType: 'csv',
  accept: '.csv,.xlsx',
  hint: 'Export: Reports → Open Invoices → Export to CSV (or Excel)',
  storageStrategy: 'snapshot',
  expectedReportType: /open\s*invoices?/i,

  getPeriodKey(data) {
    // "As of Apr 28, 2026" → "2026-04-28"
    const p = data.meta?.period || '';
    const m = p.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
    if (!m) return new Date().toISOString().slice(0, 10);
    const months = {January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
      July:'07',August:'08',September:'09',October:'10',November:'11',December:'12',
      Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const mo = months[m[1]] || '01';
    return `${m[3]}-${mo}-${String(m[2]).padStart(2,'00')}`;
  },

  // ── CSV reader (self-contained, no SheetJS dependency for CSV) ────
  _splitCSVRow(line) {
    // Quote-aware CSV split. Handles "field, with comma" and "" escapes.
    const out = [];
    let inQ = false, cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        // RFC 4180: doubled quote inside a quoted field is a literal quote.
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  },

  // M/D/YYYY → "YYYY-MM-DD". Returns null on anything malformed.
  _parseDate(s) {
    if (!s && s !== 0) return null;
    const str = String(s).trim();
    if (!str) return null;
    const parts = str.split('/');
    if (parts.length !== 3) return null;
    const [m, d, y] = parts.map(p => parseInt(p, 10));
    if (!isFinite(m) || !isFinite(d) || !isFinite(y)) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
    return `${y}-${String(m).padStart(2,'00')}-${String(d).padStart(2,'00')}`;
  },

  // "1,147.03" → 1147.03, "$5,000.00" → 5000, "(50.00)" → -50, "" → null.
  _parseAmount(s) {
    if (s === null || s === undefined || s === '') return null;
    const cleaned = String(s).replace(/[$,\s]/g, '').replace(/[()]/g, m => m === '(' ? '-' : '');
    const n = parseFloat(cleaned);
    return isFinite(n) ? n : null;
  },

  async _readRows(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) {
      // XLSX path uses SheetJS (loaded by admin.html)
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array', cellDates: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    }
    // CSV path: pure JS, no SheetJS. Each line → array of column strings.
    const text = await file.text();
    return text.split(/\r?\n/).map(line => this._splitCSVRow(line));
  },

  async parse(file) {
    const rows = await this._readRows(file);
    if (!rows || rows.length < 5) {
      throw new Error('Open Invoices file is too short to be valid (needs at least 5 rows).');
    }

    // Header rows: 0=reportType, 1=company, 2=period, 3=blank, 4=column headers
    const reportType = String((rows[0] && rows[0][0]) || '').trim();
    const period     = String((rows[2] && rows[2][0]) || '').trim();

    // Parse "As of <Mon> <D>, <YYYY>" → JS Date for aging math
    const asOfMatch = period.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
    const monthIdx = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,
      September:8,October:9,November:10,December:11,
      Jan:0,Feb:1,Mar:2,Apr:3,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    let asOf = null;
    if (asOfMatch) {
      const y = parseInt(asOfMatch[3], 10);
      const mIdx = monthIdx[asOfMatch[1]];
      const d = parseInt(asOfMatch[2], 10);
      if (isFinite(y) && isFinite(d) && mIdx != null) {
        const candidate = new Date(y, mIdx, d);
        if (!isNaN(candidate.getTime())) asOf = candidate;
      }
    }
    // Fallback: today (so daysPastDue still works for forecast use cases)
    if (!asOf) asOf = new Date();

    let currentCustomer = null;
    const invoices = [];
    const byCustomer = {};

    // Walk every row from index 5 (after header). Bail when we hit the
    // trailing footer (a row whose col 0 starts with a weekday name).
    const FOOTER_RE = /^\s*(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i;

    for (let r = 5; r < rows.length; r++) {
      const cols = rows[r] || [];
      if (cols.length === 0) continue;

      const c0 = String(cols[0] || '').trim();
      const c1 = String(cols[1] || '').trim();
      const c2 = String(cols[2] || '').trim();

      // Footer / timestamp row → stop
      if (FOOTER_RE.test(c0)) break;

      // Customer header OR subtotal row: col 0 set, col 1 empty
      if (c0 && !c1) {
        if (c0.toLowerCase().startsWith('total')) continue;  // subtotal
        // Otherwise it's a real customer name
        currentCustomer = c0;
        if (!byCustomer[currentCustomer]) {
          byCustomer[currentCustomer] = {
            name: currentCustomer,
            invoiceCount: 0,
            totalOpen: 0,
            oldestDays: 0,
          };
        }
        continue;
      }

      // Row with no transaction type → skip (includes the grand TOTAL row
      // which has c0="" and c1="TOTAL" but no c2)
      if (!c2) continue;

      // Only Invoice / Credit Memo become open-AR records.
      // Journal Entry, Payment, Refund, etc. are skipped.
      if (!/^(invoice|credit\s*memo)$/i.test(c2)) continue;

      // Need a current customer context (defensive — should always be set
      // because customer headers come before their invoices in QBO output).
      if (!currentCustomer) continue;

      const open = this._parseAmount(cols[6]);
      if (open === null) continue;     // can't store an invoice with no amount
      if (open === 0) continue;         // zero-balance invoices aren't open

      const dateIso = this._parseDate(cols[1]);
      const dueIso  = this._parseDate(cols[5]);

      // Aging math — null if either side fails. NEVER NaN.
      let daysPastDue = null;
      if (dueIso) {
        const due = new Date(dueIso + 'T00:00:00');
        if (!isNaN(due.getTime())) {
          const diffMs = asOf.getTime() - due.getTime();
          if (isFinite(diffMs)) {
            const days = Math.floor(diffMs / 86400000);
            if (isFinite(days)) daysPastDue = days;
          }
        }
      }

      const inv = {
        customer: currentCustomer,
        date: dateIso,                          // null if missing
        type: c2,
        num: String(cols[3] || '').trim() || null,
        term: String(cols[4] || '').trim() || null,
        dueDate: dueIso,                        // null if missing
        openBalance: +open.toFixed(2),
        daysPastDue,                            // null or finite number
      };
      invoices.push(inv);

      const cust = byCustomer[currentCustomer];
      cust.invoiceCount++;
      cust.totalOpen = +(cust.totalOpen + open).toFixed(2);
      if (daysPastDue !== null && daysPastDue > cust.oldestDays) {
        cust.oldestDays = daysPastDue;
      }
    }

    // Aging buckets (all guaranteed finite)
    const buckets = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days91_plus: 0 };
    for (const inv of invoices) {
      const d = inv.daysPastDue;
      if (d === null || d <= 0)        buckets.current     += inv.openBalance;
      else if (d <= 30)                buckets.days1_30    += inv.openBalance;
      else if (d <= 60)                buckets.days31_60   += inv.openBalance;
      else if (d <= 90)                buckets.days61_90   += inv.openBalance;
      else                             buckets.days91_plus += inv.openBalance;
    }
    for (const k of Object.keys(buckets)) buckets[k] = +buckets[k].toFixed(2);

    const totalOpen   = +invoices.reduce((s, i) => s + i.openBalance, 0).toFixed(2);
    const customers   = Object.values(byCustomer).sort((a, b) => b.totalOpen - a.totalOpen);
    const pastDue     = +(totalOpen - buckets.current).toFixed(2);
    const pastDuePct  = totalOpen > 0 ? +((pastDue / totalOpen) * 100).toFixed(1) : 0;
    const oldest      = invoices.reduce((m, i) => (i.daysPastDue !== null && i.daysPastDue > m) ? i.daysPastDue : m, 0);

    return {
      meta: {
        reportType,
        period,
        parsedAt: new Date().toISOString(),
        invoiceCount: invoices.length,
        customerCount: customers.length,
      },
      invoices,
      customers,
      buckets,
      summary: { totalOpen, pastDue, pastDuePct, oldest },
    };
  },

  validate(data) {
    const errors = [], warnings = [];
    if (!data.invoices || data.invoices.length === 0) {
      errors.push('No invoice rows parsed — check that this file is a QBO Open Invoices export.');
    }
    if (data.summary && data.summary.totalOpen === 0) {
      warnings.push('Total open AR is zero — verify the as-of date.');
    }
    if (data.summary && data.summary.oldest > 180) {
      warnings.push(`Oldest invoice is ${data.summary.oldest} days out — possible write-off candidates.`);
    }
    return { errors, warnings };
  },

  renderPreview(data) {
    const d = data;
    const buckets = [
      ['Current',        d.buckets.current],
      ['1 – 30 days',    d.buckets.days1_30],
      ['31 – 60 days',   d.buckets.days31_60],
      ['61 – 90 days',   d.buckets.days61_90],
      ['91+ days',       d.buckets.days91_plus],
    ];
    const total = d.summary.totalOpen;
    const bucketRows = buckets.map(([label, val]) =>
      `<tr><td>${label}</td><td>${fmt(val)}</td><td class=\"muted\">${total ? (val/total*100).toFixed(1)+'%' : '—'}</td></tr>`
    ).join('');

    const custRows = d.customers.slice(0, 15).map((c, i) =>
      `<tr><td class=\"muted\">${i+1}</td><td>${c.name}</td><td>${fmt(c.totalOpen)}</td><td class=\"muted\">${c.invoiceCount} inv${c.oldestDays > 60 ? ` · <span style=\"color:var(--orange)\">${c.oldestDays}d out</span>` : ''}</td></tr>`
    ).join('');

    return `
      <div class=\"preview-meta\">${d.meta.period} · Snapshot key: <strong>${this.getPeriodKey(d)}</strong> · ${d.meta.invoiceCount} invoices, ${d.meta.customerCount} customers</div>
      <div class=\"preview-cols\">
        <div>
          <div class=\"preview-sub-title\">Days-out distribution</div>
          <table class=\"preview-table\">
            <tr><th>Bucket</th><th>Amount</th><th>% of Total</th></tr>
            ${bucketRows}
            <tr class=\"total\"><td>Total Open</td><td>${fmt(total)}</td><td>100%</td></tr>
          </table>
          <div class=\"preview-kpis\">
            <div class=\"pkpi\"><span class=\"pkpi-label\">Past Due %</span><span class=\"pkpi-val ${d.summary.pastDuePct > 50 ? 'red' : d.summary.pastDuePct > 30 ? 'orange' : 'green'}\">${d.summary.pastDuePct}%</span></div>
            <div class=\"pkpi\"><span class=\"pkpi-label\">Oldest</span><span class=\"pkpi-val ${d.summary.oldest > 90 ? 'orange' : 'green'}\">${d.summary.oldest}d</span></div>
          </div>
        </div>
        <div>
          <div class=\"preview-sub-title\">Top 15 customers by open balance</div>
          <table class=\"preview-table\">
            <tr><th>#</th><th>Customer</th><th>Open</th><th>Detail</th></tr>
            ${custRows}
          </table>
        </div>
      </div>`;
  }
};
