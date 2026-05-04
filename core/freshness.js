// ════════════════════════════════════════════════════════════════════════
// Data Freshness — for AR aging, AP aging, and Open Invoices
// ════════════════════════════════════════════════════════════════════════
//
// These three datasets drift faster than annual P&L or static segmentation —
// a customer pays an invoice today and tomorrow's open-AR snapshot is wrong
// if it isn't refreshed. So we surface "last imported X days ago" with a
// soft warning when it's been >7 days.
//
// CONTEXT.md §8.0: this is a SOFT warning, not an alarm. The user is in
// charge of when to re-upload — we just make staleness visible.
//
// Usage:
//   1. Load this script after firebase.js + utils.js.
//   2. Add `<div data-freshness-bar></div>` somewhere near the top of the
//      page (ideally just below `<main class="main">` and the page title).
//   3. After loadDashboard's callback fires, call:
//        FreshnessBar.mount(D)
//      The bar reads D['qbo-ar-aging'], D['qbo-ap-aging'], D['qbo-open-invoices']
//      from the loaded data and renders three pills with the parsedAt date
//      and a colored age indicator.
//
// Spec datasets are configurable via FreshnessBar.configure({ datasets: [...] }).
// Default: AR aging, AP aging, Open Invoices.
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const DEFAULTS = [
    { key: 'qbo-ar-aging',       label: 'AR aging',       threshold: 7 },
    { key: 'qbo-ap-aging',       label: 'AP aging',       threshold: 7 },
    { key: 'qbo-open-invoices',  label: 'Open invoices',  threshold: 7 },
  ];

  let _config = { datasets: DEFAULTS };

  function configure(opts) {
    if (opts && Array.isArray(opts.datasets)) _config.datasets = opts.datasets;
  }

  // Returns { ageDays, parsedAt, fresh, stale, present } for a dataset.
  function dataAge(D, key) {
    const ds = D && D[key];
    if (!ds) return { present: false };
    // Prefer meta.parsedAt (set by parsers). Fall back to _savedAt.
    const ts = (ds.meta && ds.meta.parsedAt) || ds._savedAt || ds.savedAt || ds.updatedAt;
    if (!ts) return { present: true, parsedAt: null, ageDays: null };
    const t = new Date(ts);
    if (isNaN(t)) return { present: true, parsedAt: null, ageDays: null };
    const ageDays = Math.floor((Date.now() - t.getTime()) / 86400000);
    return {
      present: true,
      parsedAt: t.toISOString().slice(0, 10),
      parsedTs: ts,
      ageDays,
    };
  }

  function _injectStyles() {
    if (document.getElementById('freshness-styles')) return;
    const css = `
      .freshness-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--bg-card);border:1px solid var(--border);padding:10px 14px;margin-bottom:14px;font-family:var(--font-mono);font-size:11.5px}
      .freshness-bar .lbl{font-family:var(--font-display);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--txt-muted);margin-right:8px;font-weight:600}
      .freshness-pill{display:flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--border);border-left:3px solid var(--c,var(--border-bright));background:var(--bg-panel)}
      .freshness-pill.fresh{--c:var(--green)}
      .freshness-pill.aging{--c:var(--yellow)}
      .freshness-pill.stale{--c:var(--orange)}
      .freshness-pill.missing{--c:var(--txt-muted)}
      .freshness-pill .name{color:var(--txt-secondary);font-family:var(--font-display);font-size:11px;letter-spacing:.06em;text-transform:uppercase;font-weight:600}
      .freshness-pill .date{color:var(--txt-primary)}
      .freshness-pill .age{color:var(--txt-muted)}
      .freshness-pill.aging .age{color:var(--yellow)}
      .freshness-pill.stale .age{color:var(--orange)}
      .freshness-pill.missing .age{color:var(--txt-muted);font-style:italic}
    `;
    const tag = document.createElement('style');
    tag.id = 'freshness-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function _classify(ageDays, threshold) {
    if (ageDays == null) return 'missing';
    if (ageDays > threshold * 2) return 'stale';
    if (ageDays > threshold)     return 'aging';
    return 'fresh';
  }

  function pillHtml(D, ds) {
    const age = dataAge(D, ds.key);
    if (!age.present) {
      return '<div class="freshness-pill missing">' +
        '<span class="name">' + ds.label + '</span>' +
        '<span class="age">not imported</span></div>';
    }
    if (age.ageDays == null) {
      return '<div class="freshness-pill missing">' +
        '<span class="name">' + ds.label + '</span>' +
        '<span class="age">no timestamp</span></div>';
    }
    const cls = _classify(age.ageDays, ds.threshold);
    return '<div class="freshness-pill ' + cls + '" title="threshold: ' + ds.threshold + ' days">' +
      '<span class="name">' + ds.label + '</span>' +
      '<span class="date">' + age.parsedAt + '</span>' +
      '<span class="age">· ' + age.ageDays + 'd ago</span>' +
      '</div>';
  }

  function mount(D) {
    _injectStyles();
    const slots = document.querySelectorAll('[data-freshness-bar]');
    if (!slots.length) return;
    const pills = _config.datasets.map(function (ds) { return pillHtml(D, ds); }).join('');
    const html = '<div class="freshness-bar"><span class="lbl">Data freshness</span>' + pills + '</div>';
    slots.forEach(function (slot) { slot.innerHTML = html; });
  }

  if (typeof window !== 'undefined') {
    window.FreshnessBar = { mount: mount, configure: configure, dataAge: dataAge, pillHtml: pillHtml };
  }
})();
