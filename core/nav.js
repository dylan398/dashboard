const NAV_PAGES = [
  { id: 'index',  label: 'Reports',  href: '/dashboard/' },
  { id: 'viewer', label: 'Viewer',   href: '/dashboard/viewer.html' },
  { id: 'admin',  label: 'Admin',    href: '/dashboard/admin.html' },
];

function renderNav(activeId) {
  const links = NAV_PAGES.map(p => {
    const active = p.id === activeId ? 'style="color:var(--yellow);border-bottom:2px solid var(--yellow)"' : '';
    return `<a href="${p.href}" class="nav-link" ${active}>${p.label}</a>`;
  }).join('');

  const html = `
  <header class="header">
    <div class="header-left">
      <div class="logo-mark">SF</div>
      <div>
        <div class="company-name">Semper Fi Striping</div>
        <div class="company-sub">Financial Platform</div>
      </div>
    </div>
    <nav class="header-nav">${links}</nav>
    <div id="db-status" class="db-status">
      <div class="status-dot" id="status-dot"></div>
      <span id="status-label">Connecting…</span>
    </div>
  </header>`;

  document.body.insertAdjacentHTML('afterbegin', html);

  // Check Firebase connection
  getDB().ref('.info/connected').on('value', snap => {
    const connected = snap.val();
    const dot = document.getElementById('status-dot');
    const lbl = document.getElementById('status-label');
    if (dot) dot.style.background = connected ? 'var(--green)' : 'var(--red)';
    if (lbl) lbl.textContent = connected ? 'Live' : 'Offline';
  });
}
