const PARSER_OPEN_INVOICES = {
  id: 'qbo-open-invoices',
  label: 'QuickBooks — Open Invoices',
  fileType: 'xlsx',
  accept: '.xlsx',
  hint: 'Export: Reports → Open Invoices → Export to Excel',
  storageStrategy: 'snapshot',
  // No expectedReportType — XLSX has no header row to sniff. validate() catches wrong files.

  getPeriodKey(data) {
    // "As of Apr 22, 2026" → "2026-04-22"
    const p = data.meta?.period || '';
    const m = p.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
    if (!m) return new Date().toISOString().slice(0, 10);
    const months = {January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',
      July:'07',August:'08',September:'09',October:'10',November:'11',December:'12',
      Jan:'01',Feb:'02',Mar:'03',Apr:'04',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const mo = months[m[1]] || '01';
    return `${m[3]}-${mo}-${String(m[2]).padStart(2,'0')}`;
  },

  // Parse a US-format date string ("MM/DD/YYYY" or "M/D/YYYY") into ISO YYYY-MM-DD
  _parseUSDate(s) {
    if (!s) return null;
    const parts = String(s).trim().split('/');
    if (parts.length !== 3) return null;
    const [m, d, y] = parts.map(p => parseInt(p, 10));
    if (!m || !d || !y) return null;
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  },

  async parse(file) {
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });

    if (rows.length < 6) throw new Error('Open Invoices file is too short to be valid.');
    const reportType = String(rows[0][0] || '').trim();
    const period     = String(rows[2][0] || '').trim();   // "As of <date>"

    // As-of date for aging math (parsed from the "As of …" line)
    const asOfMatch = period.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
    const months = {January:0,February:1,March:2,April:3,May:4,June:5,July:6,August:7,September:8,October:9,November:10,December:11,
                    Jan:0,Feb:1,Mar:2,Apr:3,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    const asOf = asOfMatch
      ? new Date(parseInt(asOfMatch[3]), months[asOfMatch[1]] || 0, parseInt(asOfMatch[2]))
      : new Date();

    // Header row should be "[blank], Date, Transaction type, Num, Term, Due date, Open balance" at row 5 (index 4)
    let currentCustomer = null;
    const invoices = [];
    const byCustomer = {};

    for (let r = 5; r < rows.length; r++) {
      const cols = rows[r];
      const c0 = String(cols[0] || '').trim();

      // Customer header row: name in col 0, nothing in col 1
      if (c0 && !cols[1]) {
        if (c0.toLowerCase().startsWith('total')) continue;  // skip "Total for X" subtotals
        currentCustomer = c0;
        if (!byCustomer[c0]) byCustomer[c0] = { name: c0, invoiceCount: 0, totalOpen: 0, oldestDays: 0 };
        continue;
      }

      // Invoice row: type column should be "Invoice" or "Credit Memo"
      const txType = String(cols[2] || '').trim();
      if (!txType || !currentCustomer) continue;
      if (!/invoice|credit/i.test(txType)) continue;

      const dueIso  = this._parseUSDate(cols[5]);
      const dateIso = this._parseUSDate(cols[1]);
      const open    = parseAmount(cols[6]);
      if (open == null) continue;

      let daysPastDue = null;
      if (dueIso) {
        const due = new Date(dueIso);
        daysPastDue = Math.floor((asOf - due) / (1000 * 60 * 60 * 24));
      }

      const inv = {
        customer: currentCustomer,
        date: dateIso,
        type: txType,
        num: String(cols[3] || '').trim(),
        term: String(cols[4] || '').trim(),
        dueDate: dueIso,
        openBalance: +open.toFixed(2),
        daysPastDue,
      };
      invoices.push(inv);

      byCustomer[currentCustomer].invoiceCount++;
      byCustomer[currentCustomer].totalOpen = +(byCustomer[currentCustomer].totalOpen + open).toFixed(2);
      if (daysPastDue != null && daysPastDue > byCustomer[currentCustomer].oldestDays) {
        byCustomer[currentCustomer].oldestDays = daysPastDue;
      }
    }

    // Aging buckets
    const buckets = { current: 0, days1_30: 0, days31_60: 0, days61_90: 0, days91_plus: 0 };
    invoices.forEach(i => {
      const d = i.daysPastDue;
      if (d == null || d <= 0)      buckets.current      += i.openBalance;
      else if (d <= 30)             buckets.days1_30     += i.openBalance;
      else if (d <= 60)             buckets.days31_60    += i.openBalance;
      else if (d <= 90)             buckets.days61_90    += i.openBalance;
      else                          buckets.days91_plus  += i.openBalance;
    });
    Object.keys(buckets).forEach(k => buckets[k] = +buckets[k].toFixed(2));

    const totalOpen = +invoices.reduce((s,i) => s + i.openBalance, 0).toFixed(2);
    const customers = Object.values(byCustomer).sort((a,b) => b.totalOpen - a.totalOpen);
    const pastDue   = totalOpen - buckets.current;
    const pastDuePct = totalOpen ? +((pastDue / totalOpen) * 100).toFixed(1) : 0;

    return {
      meta: { reportType, period, parsedAt: new Date().toISOString(), invoiceCount: invoices.length, customerCount: customers.length },
      invoices,
      customers,
      buckets,
      summary: {
        totalOpen,
        pastDue: +pastDue.toFixed(2),
        pastDuePct,
        oldest: invoices.reduce((m, i) => (i.daysPastDue || 0) > m ? i.daysPastDue : m, 0),
      }
    };
  },

  validate(data) {
    const errors = [], warnings = [];
    if (!data.invoices || data.invoices.length === 0) {
      errors.push('No invoice rows parsed — file may not be an Open Invoices export.');
    }
    if (data.summary?.totalOpen === 0) {
      warnings.push('Zero open AR — verify the as-of date.');
    }
    if (data.summary?.pastDuePct > 50) {
      warnings.push(`${data.summary.pastDuePct}% of AR is past due — review collections.`);
    }
    if (data.summary?.oldest > 120) {
      warnings.push(`Oldest invoice is ${data.summary.oldest} days past due — likely write-off candidates.`);
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
      `<tr><td>${label}</td><td>${fmt(val)}</td><td class="muted">${total ? (val/total*100).toFixed(1)+'%' : '—'}</td></tr>`
    ).join('');

    const custRows = d.customers.slice(0, 15).map((c, i) =>
      `<tr><td class="muted">${i+1}</td><td>${c.name}</td><td>${fmt(c.totalOpen)}</td><td class="muted">${c.invoiceCount} inv${c.oldestDays > 60 ? ` · <span style="color:var(--orange)">${c.oldestDays}d old</span>` : ''}</td></tr>`
    ).join('');

    return `
      <div class="preview-meta">${d.meta.period} · Snapshot key: <strong>${this.getPeriodKey(d)}</strong> · ${d.meta.invoiceCount} invoices, ${d.meta.customerCount} customers</div>
      <div class="preview-cols">
        <div>
          <div class="preview-sub-title">Aging buckets</div>
          <table class="preview-table">
            <tr><th>Bucket</th><th>Amount</th><th>% of Total</th></tr>
            ${bucketRows}
            <tr class="total"><td>Total Open</td><td>${fmt(total)}</td><td>100%</td></tr>
          </table>
          <div class="preview-kpis">
            <div class="pkpi"><span class="pkpi-label">Past Due %</span><span class="pkpi-val ${d.summary.pastDuePct > 50 ? 'red' : d.summary.pastDuePct > 30 ? 'orange' : 'green'}">${d.summary.pastDuePct}%</span></div>
            <div class="pkpi"><span class="pkpi-label">Oldest</span><span class="pkpi-val ${d.summary.oldest > 90 ? 'red' : d.summary.oldest > 30 ? 'orange' : 'green'}">${d.summary.oldest}d</span></div>
          </div>
        </div>
        <div>
          <div class="preview-sub-title">Top 15 customers by AR</div>
          <table class="preview-table">
            <tr><th>#</th><th>Customer</th><th>Open</th><th>Detail</th></tr>
            ${custRows}
          </table>
        </div>
      </div>`;
  }
};
