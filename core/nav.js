// Multi-report navigation header. Each page calls renderNav('<active-id>')
// after the body loads. Pages live in / or /reports/, so we resolve href
// based on whether the current page is inside the reports/ subdirectory.

const NAV_PAGES = [
  { id: 'overview',  label: 'Overview',  href: '/dashboard/' },
  { id: 'insights',  label: 'Insights',  href: '/dashboard/reports/insights.html' },
  { id: 'pl',        label: 'Revenue',   href: '/dashboard/reports/pl.html' },
  { id: 'cash',      label: 'Cash',      href: '/dashboard/reports/cash.html' },
  { id: 'customers', label: 'Customers', href: '/dashboard/reports/customers.html' },
  { id: 'vendors',   label: 'Vendors',   href: '/dashboard/reports/vendors.html' },
  { id: 'pipeline',  label: 'Pipeline',  href: '/dashboard/reports/pipeline.html' },
  { id: 'outreach',  label: 'Outreach',  href: '/dashboard/reports/outreach.html' },
];
const NAV_OPS = [
  { id: 'viewer',  label: 'Viewer',  href: '/dashboard/viewer.html' },
  { id: 'admin',   label: 'Admin',   href: '/dashboard/admin.html' },
];

function renderNav(activeId) {
  const link = (p) => {
    const active = p.id === activeId
      ? 'style="color:var(--yellow);border-bottom-color:var(--yellow)"'
      : '';
    return `<a href="${p.href}" class="nav-link" ${active}>${p.label}</a>`;
  };
  const reportLinks = NAV_PAGES.map(link).join('');
  const opLinks     = NAV_OPS.map(link).join('');

  const html = `
  <header class="header">
    <div class="header-left">
      <div class="logo-mark">SF</div>
      <div>
        <div class="company-name">Semper Fi Striping</div>
        <div class="company-sub">Financial Platform</div>
      </div>
    </div>
    <nav class="header-nav">${reportLinks}<span class="nav-divider"></span>${opLinks}</nav>
    <div id="db-status" class="db-status">
      <div class="status-dot" id="status-dot"></div>
      <span id="status-label">Connecting…</span>
    </div>
  </header>`;

  document.body.insertAdjacentHTML('afterbegin', html);

  // Live Firebase connection indicator
  if (typeof getDB === 'function') {
    getDB().ref('.info/connected').on('value', snap => {
      const ok = snap.val();
      const dot = document.getElementById('status-dot');
      const lbl = document.getElementById('status-label');
      if (dot) dot.style.background = ok ? 'var(--green)' : 'var(--red)';
      if (lbl) lbl.textContent = ok ? 'Live' : 'Offline';
    });
  }
}

// Inject the standard nav stylesheet — every page calls this once so we don't
// duplicate the same CSS in every HTML file.
function injectNavStyles() {
  if (document.getElementById('nav-styles')) return;
  const css = `
    .header{background:var(--bg-panel);border-bottom:2px solid var(--yellow);padding:0 28px;display:flex;align-items:center;justify-content:space-between;height:64px;position:sticky;top:0;z-index:100}
    .header-left{display:flex;align-items:center;gap:16px}
    .logo-mark{width:38px;height:38px;background:var(--yellow);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:800;font-size:18px;color:#000}
    .company-name{font-family:var(--font-display);font-weight:700;font-size:22px;color:var(--txt-primary)}
    .company-sub{font-size:11px;color:var(--txt-muted);letter-spacing:.12em;text-transform:uppercase;margin-top:-2px}
    .header-nav{display:flex;gap:2px;flex-wrap:wrap;align-items:center}
    .nav-link{padding:8px 12px;font-size:12px;letter-spacing:.04em;color:var(--txt-secondary);border-bottom:2px solid transparent;transition:color .2s;text-decoration:none;font-family:var(--font-display);text-transform:uppercase;font-weight:600}
    .nav-link:hover{color:var(--txt-primary)}
    .nav-divider{width:1px;height:18px;background:var(--border-bright);margin:0 8px}
    .db-status{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--txt-muted);font-family:var(--font-mono)}
    .status-dot{width:8px;height:8px;border-radius:50%;background:var(--txt-muted);animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  `;
  const tag = document.createElement('style');
  tag.id = 'nav-styles';
  tag.textContent = css;
  document.head.appendChild(tag);
}
