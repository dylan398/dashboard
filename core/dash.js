// Shared dashboard core: data normalization, Knowify rule engine,
// derived metrics (DSO / customer concentration / etc.), Chart.js theme.

// ── DATA NORMALIZATION ────────────────────────────────────────────────
// Pulls the latest period/snapshot out of each storage shape so reports
// don't have to repeat this logic.
function normalizeDashboardData(raw) {
  if (!raw) return {};
  const out = { meta: raw.meta || {} };

  // Period datasets — read whichever period the "latest" pointer references,
  // falling back to the chronologically last key if pointer is missing.
  ['qbo-pl', 'qbo-cf', 'qbo-pl-monthly'].forEach(id => {
    const ds = raw[id] || {};
    if (ds.periods) {
      const latestKey = ds.latest;
      out[id] = latestKey
        ? (ds.periods[latestKey] || {})
        : Object.values(ds.periods).sort((a,b) => (b._periodKey||'') > (a._periodKey||'') ? 1 : -1)[0] || {};
      // Always keep the full periods object too — annual trends need every year.
      out[id + '_all'] = ds.periods;
    } else {
      out[id] = {};
      out[id + '_all'] = {};
    }
  });

  // Snapshot datasets — latest snapshot + full history.
  ['qbo-bs', 'qbo-ar-aging', 'qbo-ap-aging', 'qbo-open-invoices'].forEach(id => {
    const ds = raw[id] || {};
    if (ds.snapshots) {
      const latestKey = ds.latestDate;
      out[id] = latestKey
        ? (ds.snapshots[latestKey] || {})
        : Object.values(ds.snapshots).sort((a,b) => (b._dateKey||'') > (a._dateKey||'') ? 1 : -1)[0] || {};
      out[id + '_all'] = ds.snapshots;
    } else {
      out[id] = {};
      out[id + '_all'] = {};
    }
  });

  // Merge datasets — already flat at top level
  out['qbo-sales']         = raw['qbo-sales'] || {};
  out['qbo-transactions']  = raw['qbo-transactions'] || {};
  out['knowify-jobs']      = raw['knowify-jobs'] || {};

  return out;
}

// One-call data loader for any report. Subscribes to live updates and
// re-renders on change. Pages call this in their init.
function loadDashboard(callback) {
  if (typeof DB === 'undefined') {
    console.error('DB not initialized — load core/firebase.js first');
    return;
  }
  DB.onAll(raw => {
    if (!raw || !Object.keys(raw).filter(k => !k.startsWith('_')).length) {
      callback(null, raw || {});
      return;
    }
    callback(normalizeDashboardData(raw), raw);
  });
}

// ── KNOWIFY RULE ENGINE ───────────────────────────────────────────────
// Applies Dylan's four rules to convert the raw Knowify export into a
// "competitive bid dataset" suitable for win-rate analysis.
//
//   1. Stale bids reclassified as losses (Bidding > 120 days old)
//   2. Unbilled closed jobs reclassified as losses (Closed with 0% billed)
//   3. Relationship leads excluded (James Thetford, Tyler Petty, Jenna Napier)
//   4. Everything else = competitive channel (Estimating, blank lead, all Rejected)
//   5. Multi-GC project deduplication is annotated but bids stay separate
//      (per-GC-bid is the right unit for "which GCs to pursue")

const RELATIONSHIP_LEADS = ['James Thetford', 'Tyler Petty', 'Jenna Napier'];
const STALE_BID_DAYS = 120;

function _knowifyDateAge(jobDateStr, asOf) {
  if (!jobDateStr) return null;
  // Knowify dates come through as M/D/YYYY (or full date strings)
  const d = new Date(jobDateStr);
  if (isNaN(d)) return null;
  return Math.floor((asOf - d) / (1000 * 60 * 60 * 24));
}

function _normalizeName(name) {
  if (!name) return '';
  // Lowercase, strip punctuation, normalize whitespace — for fuzzy job-name matching.
  return String(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function applyKnowifyRules(rawJobs, opts = {}) {
  const asOf = opts.asOf instanceof Date ? opts.asOf : new Date();
  const all = [
    ...(rawJobs?.Active   || []).map(j => ({ ...j, originalStatus: 'Active'   })),
    ...(rawJobs?.Closed   || []).map(j => ({ ...j, originalStatus: 'Closed'   })),
    ...(rawJobs?.Bidding  || []).map(j => ({ ...j, originalStatus: 'Bidding'  })),
    ...(rawJobs?.Rejected || []).map(j => ({ ...j, originalStatus: 'Rejected' })),
  ];

  // Step 1 + 2: reclassify outcomes
  const classified = all.map(j => {
    const ageDays = _knowifyDateAge(j.createdDate, asOf);
    let outcome = null;       // 'win' | 'loss' | null
    let reclassReason = null;
    if (j.originalStatus === 'Rejected') {
      outcome = 'loss';
    } else if (j.originalStatus === 'Active') {
      outcome = 'win';
    } else if (j.originalStatus === 'Closed') {
      // Rule 2: Closed with 0 invoiced → loss
      if ((j.invoiced || 0) <= 0) {
        outcome = 'loss';
        reclassReason = 'unbilled-closed';
      } else {
        outcome = 'win';
      }
    } else if (j.originalStatus === 'Bidding') {
      // Rule 1: stale bidding → loss
      if (ageDays != null && ageDays > STALE_BID_DAYS) {
        outcome = 'loss';
        reclassReason = 'stale-bid';
      } else {
        outcome = 'pending';
      }
    }
    return { ...j, ageDays, outcome, reclassReason };
  });

  // Step 3 + 4: split into channels
  const isRelationship = (j) => RELATIONSHIP_LEADS.includes((j.salesLead || '').trim());
  const competitive = classified.filter(j => !isRelationship(j));
  const relationship = classified.filter(isRelationship);

  // Step 5: multi-GC dedup detection on the competitive set
  const projectGroups = {};
  competitive.forEach(j => {
    const key = _normalizeName(j.jobName);
    if (!key) return;
    if (!projectGroups[key]) projectGroups[key] = { name: j.jobName, key, bids: [] };
    projectGroups[key].bids.push(j);
  });
  const multiGCProjects = Object.values(projectGroups).filter(g => g.bids.length > 1);
  const multiGCBidIds = new Set();
  multiGCProjects.forEach(g => g.bids.forEach(b => multiGCBidIds.add(b)));

  // Tag each competitive bid with whether it's part of a multi-GC project
  competitive.forEach(j => {
    j.isMultiGC = multiGCBidIds.has(j);
  });

  // Headline win-rate metrics
  const decided = competitive.filter(j => j.outcome === 'win' || j.outcome === 'loss');
  const wins    = decided.filter(j => j.outcome === 'win');
  const losses  = decided.filter(j => j.outcome === 'loss');
  const pending = competitive.filter(j => j.outcome === 'pending');

  const wonCV   = wins.reduce((s, j) => s + (j.contractTotal || 0), 0);
  const lostCV  = losses.reduce((s, j) => s + (j.contractTotal || 0), 0);
  const pendingCV = pending.reduce((s, j) => s + (j.contractTotal || 0), 0);

  const winRate = decided.length ? +(wins.length / decided.length * 100).toFixed(1) : null;
  const dollarWinRate = (wonCV + lostCV) ? +(wonCV / (wonCV + lostCV) * 100).toFixed(1) : null;

  // Per-GC breakdown (top 25 by total bid value)
  const byGC = {};
  competitive.forEach(j => {
    const gc = (j.client || '').trim() || '— Unknown —';
    if (!byGC[gc]) byGC[gc] = { gc, bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0 };
    byGC[gc].bids++;
    if (j.outcome === 'win') {
      byGC[gc].wins++;
      byGC[gc].wonCV += j.contractTotal || 0;
    } else if (j.outcome === 'loss') {
      byGC[gc].losses++;
      byGC[gc].lostCV += j.contractTotal || 0;
    } else if (j.outcome === 'pending') {
      byGC[gc].pending++;
      byGC[gc].pendingCV += j.contractTotal || 0;
    }
  });
  Object.values(byGC).forEach(g => {
    g.totalCV = g.wonCV + g.lostCV + g.pendingCV;
    g.winRate = (g.wins + g.losses) ? +(g.wins / (g.wins + g.losses) * 100).toFixed(1) : null;
  });
  const gcRows = Object.values(byGC).sort((a, b) => b.totalCV - a.totalCV);

  // Per-sales-lead breakdown (the "competitive" set was carved out specifically
  // to evaluate channel performance — Estimating Dept, blank lead, Rejected).
  const byLead = {};
  competitive.forEach(j => {
    const lead = (j.salesLead || '').trim() || '— Unassigned —';
    if (!byLead[lead]) byLead[lead] = { lead, bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0 };
    byLead[lead].bids++;
    if (j.outcome === 'win')        { byLead[lead].wins++; byLead[lead].wonCV += j.contractTotal || 0; }
    else if (j.outcome === 'loss')  { byLead[lead].losses++; }
    else if (j.outcome === 'pending'){ byLead[lead].pending++; }
  });
  Object.values(byLead).forEach(l => {
    l.winRate = (l.wins + l.losses) ? +(l.wins / (l.wins + l.losses) * 100).toFixed(1) : null;
  });
  const leadRows = Object.values(byLead).sort((a, b) => b.bids - a.bids);

  // Relationship-channel summary (different model — these are pre-sold)
  const relWins   = relationship.filter(j => j.originalStatus === 'Active' || (j.originalStatus === 'Closed' && (j.invoiced || 0) > 0));
  const relCV     = relWins.reduce((s, j) => s + (j.contractTotal || 0), 0);

  return {
    asOf: asOf.toISOString(),
    rules: {
      staleBidDays: STALE_BID_DAYS,
      relationshipLeads: RELATIONSHIP_LEADS,
    },
    competitive: {
      jobs: competitive,
      decidedCount: decided.length,
      wins: wins.length,
      losses: losses.length,
      pending: pending.length,
      wonCV, lostCV, pendingCV,
      winRate, dollarWinRate,
      reclassifiedStale:    competitive.filter(j => j.reclassReason === 'stale-bid').length,
      reclassifiedUnbilled: competitive.filter(j => j.reclassReason === 'unbilled-closed').length,
    },
    relationship: {
      jobs: relationship,
      bids: relationship.length,
      wonCV: relCV,
      wonCount: relWins.length,
    },
    multiGC: {
      projectCount:         multiGCProjects.length,
      bidsInMultiGCProjects: multiGCBidIds.size,
      avgGCsPerProject:     multiGCProjects.length ? +(multiGCBidIds.size / multiGCProjects.length).toFixed(1) : 0,
    },
    byGC: gcRows,
    byLead: leadRows,
    rawCounts: {
      Active:   (rawJobs?.Active   || []).length,
      Closed:   (rawJobs?.Closed   || []).length,
      Bidding:  (rawJobs?.Bidding  || []).length,
      Rejected: (rawJobs?.Rejected || []).length,
    },
  };
}

// ── DERIVED FINANCIAL METRICS ─────────────────────────────────────────

// Customer concentration — top-N as % of total revenue. Risk indicator.
function customerConcentration(topCustomers, totalRevenue, n = 5) {
  if (!topCustomers || !topCustomers.length || !totalRevenue) return null;
  const topNRevenue = topCustomers.slice(0, n).reduce((s, c) => s + (c.total || 0), 0);
  return {
    n,
    topNRevenue,
    pctOfTotal: +(topNRevenue / totalRevenue * 100).toFixed(1),
    customers: topCustomers.slice(0, n).map(c => ({
      name: c.name,
      revenue: c.total,
      pct: +(c.total / totalRevenue * 100).toFixed(1),
    })),
  };
}

// "Days to pay" stats from Open Invoices — the construction-Texas reframe of
// AR aging. We stop calling these "past due" because in this industry an
// invoice IS due when sent and customers pay when they pay. The right metric
// is just how long it takes them.
function daysToPayStats(invoices, asOfStr) {
  if (!invoices || !invoices.length) return null;
  const ages = invoices
    .map(i => i.daysPastDue)
    .filter(d => typeof d === 'number' && !isNaN(d) && d >= 0);
  if (!ages.length) return null;
  ages.sort((a, b) => a - b);
  const sum = ages.reduce((s, v) => s + v, 0);
  const median = ages[Math.floor(ages.length / 2)];
  const p90    = ages[Math.floor(ages.length * 0.9)];
  // Bucket counts (used in dashboards as informational, not alarming)
  const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d91_120: 0, d121_plus: 0 };
  ages.forEach(d => {
    if      (d <= 30)  buckets.d0_30++;
    else if (d <= 60)  buckets.d31_60++;
    else if (d <= 90)  buckets.d61_90++;
    else if (d <= 120) buckets.d91_120++;
    else               buckets.d121_plus++;
  });
  return {
    invoiceCount: ages.length,
    avgDays:    +(sum / ages.length).toFixed(1),
    medianDays: median,
    p90Days:    p90,
    maxDays:    ages[ages.length - 1],
    buckets,
  };
}

// Effective DSO: AR / (annualized revenue / 365). Interpret cautiously when
// revenue is YTD-only.
function calcDSO(arBalance, annualRevenue) {
  if (!arBalance || !annualRevenue) return null;
  return +(arBalance / (annualRevenue / 365)).toFixed(1);
}

// Current ratio, quick ratio, debt-to-equity from a balance sheet snapshot.
function balanceRatios(bs) {
  if (!bs || !bs.totalCurrentAssets || !bs.totalCurrentLiab) return null;
  const currentRatio = bs.totalCurrentLiab > 0 ? +(bs.totalCurrentAssets / bs.totalCurrentLiab).toFixed(2) : null;
  // Quick = (current assets − inventory) / current liab. We don't have inventory
  // tracked separately, so quick≈current here. Construction usually has minimal
  // physical inventory anyway.
  const quickRatio = currentRatio;
  const debtToEquity = bs.totalEquity ? +(bs.totalLiabilities / bs.totalEquity).toFixed(2) : null;
  const workingCapital = bs.totalCurrentAssets - bs.totalCurrentLiab;
  return { currentRatio, quickRatio, debtToEquity, workingCapital };
}

// ── CHART.JS THEME ────────────────────────────────────────────────────
// Call once per page after Chart.js loads.
function setupChartTheme() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = '#8a90a0';
  Chart.defaults.borderColor = '#252a38';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size = 11;
  // Plugin defaults
  if (Chart.defaults.plugins) {
    if (Chart.defaults.plugins.legend) {
      Chart.defaults.plugins.legend.labels = Object.assign({}, Chart.defaults.plugins.legend.labels, {
        font: { family: "'Barlow Condensed', sans-serif", weight: '600', size: 11 },
        padding: 12,
      });
    }
    if (Chart.defaults.plugins.tooltip) {
      Chart.defaults.plugins.tooltip.titleFont = { family: "'Barlow Condensed', sans-serif", weight: '700' };
      Chart.defaults.plugins.tooltip.bodyFont  = { family: "'JetBrains Mono', monospace" };
      Chart.defaults.plugins.tooltip.backgroundColor = '#13161e';
      Chart.defaults.plugins.tooltip.borderColor = '#2e3448';
      Chart.defaults.plugins.tooltip.borderWidth = 1;
    }
  }
}

// Friendly chart palette pulled from the existing CSS variables.
const CHART_COLORS = {
  yellow:'#f5c842', orange:'#e07b2b', red:'#e05252', green:'#3ecf8e',
  blue:'#4a9eff', purple:'#9b6dff', muted:'#555c70', bright:'#e8eaf0',
};
