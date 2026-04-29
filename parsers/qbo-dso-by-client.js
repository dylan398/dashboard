// ─────────────────────────────────────────────────────────────────────────
// DEPRECATED — NOT LOADED BY admin.html.
//
// DSO is now computed automatically from the qbo-transactions data Dylan is
// already uploading. See computeDSOFromTransactions() in core/dash.js.
//
// This parser remains in the tree as a reference / fallback in case a
// pre-computed DSO Excel export is ever needed again. To re-enable, add
// <script src="parsers/qbo-dso-by-client.js"></script> to admin.html and
// add PARSER_DSO_BY_CLIENT to the PARSERS array.
// ─────────────────────────────────────────────────────────────────────────
//
// Original docstring follows.
//
// PARSER — Days-to-Pay by Client (XLSX)
//
// Source file: a 13-column reference table generated externally from QBO
// invoice + payment history. One row per client with their DSO statistics:
//   Client | # Paid | Mean DSO | Median DSO | P75 DSO | P90 DSO | Max DSO
//          | % Paid ≤30d | % Paid ≤60d | % Paid ≤90d | % Paid >120d
//          | Std Dev DSO | Total Paid ($)
//
// Storage strategy: 'period' keyed by parse-date — every fresh upload
// replaces the dataset. This is intentional: the table is a snapshot
// recompute, not a stream of new rows. (Old snapshots are not preserved
// because the recompute uses overlapping invoice history.)
//
// Why this dataset matters: it powers per-client payment-date estimates
// and the 30/60/90/120-day collection forecast on the Customers page.
// See estimatePaymentDate() and forecastCollections() in core/dash.js.
// ─────────────────────────────────────────────────────────────────────────

const PARSER_DSO_BY_CLIENT = {
  id: 'qbo-dso-by-client',
  label: 'Days to Pay by Company',
  fileType: 'xlsx',
  accept: '.xlsx',
  hint: 'XLSX file with Client + DSO statistics columns. Header row 4 (rows 1-3 are title, blurb, blank).',
  storageStrategy: 'period',
  expectedReportType: null, // XLSX — no header sniff

  getPeriodKey(data) {
    // Keyed by parse date — newer upload overwrites older. We do NOT key
    // by anything in the data because the upload is meant to refresh.
    return new Date().toISOString().slice(0, 10);
  },

  async parse(file) {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS (XLSX) not loaded.');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('No sheet found in workbook.');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

    // Find the header row — typically row 3 (zero-indexed) but locate it
    // robustly so a slightly different export still parses.
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i];
      if (!r) continue;
      const firstCell = (r[0] || '').toString().trim().toLowerCase();
      if (firstCell === 'client' && r.some(c => /mean dso/i.test(String(c||'')))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) throw new Error('Could not find header row (looking for "Client" + "Mean DSO" columns).');

    const header = rows[headerIdx].map(c => (c || '').toString().trim());
    const colIdx = (re) => header.findIndex(h => re.test(h));
    const idxClient   = 0;
    const idxNPaid    = colIdx(/^#\s*paid$/i);
    const idxMean     = colIdx(/mean\s*dso/i);
    const idxMedian   = colIdx(/median\s*dso/i);
    const idxP75      = colIdx(/p\s*75/i);
    const idxP90      = colIdx(/p\s*90/i);
    const idxMax      = colIdx(/max\s*dso/i);
    const idxPct30    = colIdx(/%\s*paid\s*[≤<=]\s*30/i);
    const idxPct60    = colIdx(/%\s*paid\s*[≤<=]\s*60/i);
    const idxPct90    = colIdx(/%\s*paid\s*[≤<=]\s*90/i);
    const idxPctOver  = colIdx(/%\s*paid\s*>\s*120/i);
    const idxStd      = colIdx(/std\s*dev/i);
    const idxTotal    = colIdx(/total\s*paid/i);

    if (idxNPaid < 0 || idxMean < 0 || idxMedian < 0) {
      throw new Error('Required columns missing. Expected at least: Client, # Paid, Mean DSO, Median DSO.');
    }

    const num = (v) => {
      if (v == null || v === '') return null;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
      return (isFinite(n) ? n : null);
    };

    const clients = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[idxClient]) continue;
      const name = String(r[idxClient]).trim();
      if (!name) continue;
      const nPaid = num(r[idxNPaid]);
      if (nPaid == null || nPaid <= 0) continue;
      clients.push({
        client:       name,
        nPaid:        Math.round(nPaid),
        meanDSO:      num(r[idxMean]),
        medianDSO:    num(r[idxMedian]),
        p75DSO:       num(r[idxP75]),
        p90DSO:       num(r[idxP90]),
        maxDSO:       num(r[idxMax]),
        pctPaid30d:   num(r[idxPct30]),     // 0..1 fraction
        pctPaid60d:   num(r[idxPct60]),
        pctPaid90d:   num(r[idxPct90]),
        pctPaidOver120d: num(r[idxPctOver]),
        stdDevDSO:    num(r[idxStd]),
        totalPaid:    num(r[idxTotal]),
      });
    }

    // Portfolio-wide stats (used as fallback when a client has no history)
    const totalInvoices = clients.reduce((s, c) => s + (c.nPaid || 0), 0);
    const totalPaid     = clients.reduce((s, c) => s + (c.totalPaid || 0), 0);
    // Weighted-average median DSO (weight by # paid invoices)
    let dsoSum = 0, dsoWt = 0;
    clients.forEach(c => {
      if (c.medianDSO != null && c.nPaid) { dsoSum += c.medianDSO * c.nPaid; dsoWt += c.nPaid; }
    });
    const portfolioMedianDSO = dsoWt > 0 ? +(dsoSum / dsoWt).toFixed(1) : null;

    // Sort by total paid (descending) — biggest customers first
    clients.sort((a, b) => (b.totalPaid || 0) - (a.totalPaid || 0));

    return {
      meta: {
        reportType: 'Days to Pay by Company',
        period: `Last refreshed ${new Date().toLocaleDateString()}`,
        parsedAt: new Date().toISOString(),
        clientCount: clients.length,
        totalInvoices,
      },
      summary: {
        clientCount: clients.length,
        totalInvoices,
        totalPaid: +totalPaid.toFixed(2),
        portfolioMedianDSO,
        clientsWith3Plus:  clients.filter(c => c.nPaid >= 3).length,
        clientsWith5Plus:  clients.filter(c => c.nPaid >= 5).length,
        clientsWith10Plus: clients.filter(c => c.nPaid >= 10).length,
      },
      clients,
    };
  },

  validate(data) {
    const errors = [], warnings = [];
    if (!data?.clients?.length) {
      errors.push('No client rows parsed. Verify the workbook has a header row with "Client" + "Mean DSO".');
      return { errors, warnings };
    }
    if (data.clients.length < 5) warnings.push(`Only ${data.clients.length} clients parsed — verify the file isn't truncated.`);
    if (data.summary.totalInvoices < 50) warnings.push('Fewer than 50 invoices in history — DSO estimates have low confidence.');
    if (data.summary.portfolioMedianDSO == null) warnings.push('Could not compute portfolio median DSO — check Median DSO column.');
    return { errors, warnings };
  },

  renderPreview(data) {
    const s = data.summary || {};
    const rows = (data.clients || []).slice(0, 15);
    const tr = (c) => `<tr>
      <td>${c.client}</td>
      <td class="num">${c.nPaid}</td>
      <td class="num">${c.medianDSO != null ? c.medianDSO.toFixed(1) : '—'}</td>
      <td class="num">${c.p75DSO != null ? c.p75DSO.toFixed(1) : '—'}</td>
      <td class="num">${c.totalPaid != null ? '$' + Math.round(c.totalPaid).toLocaleString() : '—'}</td>
    </tr>`;
    return `
      <div class="preview-meta">${data.meta.period} · ${s.clientCount} clients · ${s.totalInvoices} matched invoices</div>
      <div class="preview-kpis">
        <div class="pkpi"><span class="pkpi-label">Portfolio median DSO</span><span class="pkpi-val yellow">${s.portfolioMedianDSO ?? '—'} d</span></div>
        <div class="pkpi"><span class="pkpi-label">Clients ≥3 paid invoices</span><span class="pkpi-val">${s.clientsWith3Plus}</span></div>
        <div class="pkpi"><span class="pkpi-label">Clients ≥5 paid invoices</span><span class="pkpi-val">${s.clientsWith5Plus}</span></div>
        <div class="pkpi"><span class="pkpi-label">Total paid history</span><span class="pkpi-val">$${Math.round(s.totalPaid || 0).toLocaleString()}</span></div>
      </div>
      <table class="preview-table">
        <tr><th>Client</th><th>#Paid</th><th>Median DSO</th><th>P75 DSO</th><th>Total Paid</th></tr>
        ${rows.map(tr).join('')}
      </table>
      <div class="preview-meta" style="margin-top:8px;color:var(--txt-muted);font-size:11px">Showing top 15 by paid total. Full table goes to <code>dashboard/qbo-dso-by-client</code>.</div>`;
  }
};
