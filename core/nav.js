// Multi-report navigation header. Each page calls renderNav('<active-id>')
// after the body loads. Pages live in / or /reports/, so we resolve href
// based on whether the current page is inside the reports/ subdirectory.

const NAV_PAGES = [
  { id: 'overview',  label: 'Overview',  href: '/dashboard/' },
  { id: 'pl',        label: 'Revenue',   href: '/dashboard/reports/pl.html' },
  { id: 'cash',      label: 'Cash',      href: '/dashboard/reports/cash.html' },
  { id: 'customers', label: 'Customers', href: '/dashboard/reports/customers.html' },
  { id: 'vendors',   label: 'Vendors',   href: '/dashboard/reports/vendors.html' },
  { id: 'pipeline',  label: 'Pipeline',  href: '/dashboard/reports/pipeline.html' },
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
        <div class="company-name">Semper Fi 