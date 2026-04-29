/* ════════════════════════════════════════════════════════════════════════
   SFS DASHBOARD — SHARED CORE
   ────────────────────────────────────────────────────────────────────────
   ▶▶▶ READ docs/CONTEXT.md FIRST ◀◀◀
   That document is the long-form business + industry context that every
   threshold and metric in this file relies on. The summary below is the
   minimum you need; CONTEXT.md is the rules of the world.
   ────────────────────────────────────────────────────────────────────────
   This file is the single source of truth for:
     1. How raw Firebase data gets normalized for reports
     2. How Knowify pipeline data gets re-classified per Dylan's rules
     3. Every derived metric the reports use (DSO, concentration, runway, …)
     4. Cross-data combinations (customer × AR × pipeline, etc.)
     5. Auto-generated business insights
 
   ────────────────────────────────────────────────────────────────────────
   FOR FUTURE CLAUDE CHATS — READ THIS BEFORE TOUCHING REPORTING LOGIC
   ────────────────────────────────────────────────────────────────────────
 
   The business: Semper Fi Striping LLC — a Texas pavement-marking
   subcontractor (DFW/Weatherford). SDVOSB-certified. Three owners:
   Dylan Petty (CEO), Tyler Petty (COO), James Thetford (CRO). They sell
   striping/sealcoating/ADA work mostly to general contractors (GCs). A
   single project may be bid through 3+ GCs simultaneously, and only one
   GC wins the prime contract — that affects how we measure win rate.
 
   Industry rules that change interpretation:
   ────────────────────────────────────────
   • PAST DUE IS NOT AN ALARM. In TX construction subcontracting an invoice
     is considered due the moment it's sent — there's no enforceable
     deadline. The right metric is "days to pay" (how long it takes the
     customer to actually pay), not "% past due". Reports must re-frame
     aging buckets as informational time bands, not collections alarms.
     daysToPayStats() and the customers.html page are the canonical
     example of this framing.
 
   • KNOWIFY DATA IS DIRTY. SFS uses Knowify in non-standard ways and the
     export reflects that. Four rules + one annotation reshape it before
     win-rate calculations:
       1. Stale bids → losses: Bidding-status jobs older than 120 days are
          reclassified as losses. Awards normally happen in 30–60 days; a
          bid sitting >120 days is effectively lost.
       2. Unbilled closed → losses: Closed jobs with 0 invoiced are
          reclassified as losses (no invoice = no revenue).
       3. Relationship leads excluded: Sales Lead in {James Thetford,
          Tyler Petty, Jenna Napier} → these are pre-sold, outcome is
          determined by relationship not price competitiveness. Excluded
          from win-rate calcs and shown separately.
       4. Competitive channel = the rest: Estimating Department, blank
          Sales Lead, all Rejected jobs. THIS is what win-rate metrics
          are computed on.
       5. Multi-GC dedup is annotated, not removed. ~38% of competitive
          bids are duplicates across multiple GCs for the same project.
          Per-GC-bid is the right unit for evaluating "which GCs to
          pursue", but absolute loss counts overstate competitive losses
          (the GC just didn't win the prime).
     applyKnowifyRules() is the single implementation. Don't re-implement
     this in report pages — call it.
 
   ────────────────────────────────────────────────────────────────────────
   DATA SHAPES IN FIREBASE
   ────────────────────────────────────────────────────────────────────────
 
   Three storage strategies (defined in core/firebase.js):
 
     PERIOD ─ one record per period (e.g., one P&L per year). Path:
       dashboard/{datasetId}/periods/{periodKey}
       dashboard/{datasetId}/latest                 ← pointer
 
     SNAPSHOT ─ every dated snapshot kept forever (e.g., BS as-of dates).
       dashboard/{datasetId}/snapshots/{dateKey}
       dashboard/{datasetId}/latestDate             ← pointer
 
     MERGE ─ accumulating data merged at write time (sales monthly,
       transaction accounts, knowify summary). Path:
       dashboard/{datasetId}/                       ← flat, no sub-key
 
   Datasets and their strategies:
     qbo-pl              period (annual)    Profit & Loss
     qbo-pl-monthly      period (annual)    P&L by Month (current year)
     qbo-bs              snapshot (date)    Balance Sheet
     qbo-cf              period (annual)    Cash Flow Statement
     qbo-sales           merge              Sales by Customer Detail
     qbo-transactions    merge              Transaction Detail by Account
     qbo-ar-aging        snapshot (date)    A/R Aging Summary
     qbo-ap-aging        snapshot (date)    A/P Aging Summary
     qbo-open-invoices   snapshot (date)    Open Invoices (richer than AR Aging)
     knowify-jobs        merge              Knowify Advanced Jobs Report
 
   normalizeDashboardData(raw) collapses these into a flat object where
   each dataset is the LATEST period/snapshot, plus *_all containing the
   full history. Reports almost always call this via loadDashboard().
 
   ────────────────────────────────────────────────────────────────────────
   CROSS-DATA COMBINATIONS THIS FILE COMPUTES
   ────────────────────────────────────────────────────────────────────────
 
   These are the joins that turn raw datasets into business meaning:
 
     Customer × AR × Lifetime
       Combine qbo-sales.topCustomers + qbo-open-invoices.invoices to
       compute, per customer: lifetime revenue + currently-open AR + how
       long their open invoices have been outstanding. See customerLedger().
 
     Pipeline → Revenue projection
       Knowify pending bids × historical win rate = expected wins.
       Cross-check against P&L revenue trend. See pipelineProjection().
 
     Cash runway
       Latest BS cash / monthly avg OpEx (from latest P&L). Translates
       balance-sheet liquidity into a time horizon. See cashRunway().
 
     Debt service coverage (DSCR)
       EBITDA / annual debt service. Standard SBA threshold is ~1.25x.
       Used in the loan-readiness panel of the insights page.
 
     Working capital cycle
       DSO + DIO − DPO = cash conversion cycle (in days). Inventory ~0
       for a service business so we treat this as DSO − DPO. The lower
       the better. See workingCapitalCycle().
 
     Margin erosion detection
       Per-OpEx-category as % of revenue, year over year. Flags any
       category that grew >25% as % of revenue YoY. See marginErosion().
 
     Customer health score
       Composite: lifetime revenue (50%), payment timeliness (30%), open
       AR not too old (20%). 0–100 score. See customerHealth().
 
     Bid-funnel time analysis
       From Knowify date fields: bid created → won → invoiced → paid.
       Identifies bottlenecks. (Full implementation requires job-level
       invoice tracking we don't yet have — see partial in pipelineFunnel())
 
   ────────────────────────────────────────────────────────────────────────
   ADDING NEW METRICS — RULES OF THUMB
   ────────────────────────────────────────────────────────────────────────
 
   • Pure functions. Take normalized D as input. Return a value or null.
   • If a metric needs raw history, take D's *_all collections as input.
   • Always return null when inputs are missing — never NaN, never crash.
   • Document business meaning + thresholds in a JSDoc-style header.
   • If a metric is composite (combines >2 datasets), call out the
     dependency chain in the comment.
   • Add the metric to insights() if it should appear on the auto-insights page.
 
   ════════════════════════════════════════════════════════════════════ */
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 1 ─ DATA NORMALIZATION
// ════════════════════════════════════════════════════════════════════════
 
/**
 * Collapses the Firebase tree into a per-dataset object where each key is
 * the LATEST period/snapshot (whatever's most recent). Also exposes the
 * full history under {key}_all for trend reports.
 *
 * Why: 90% of the time a report wants "the latest" of each dataset, and
 * the rest of the time it wants every period/snapshot in order. This lets
 * pages consume D[id] without thinking about the storage strategy.
 */
function normalizeDashboardData(raw) {
  if (!raw) return {};
  const out = { meta: raw.meta || {} };
 
  // Period datasets: latest by pointer, fall back to chronological tail.
  ['qbo-pl', 'qbo-cf', 'qbo-pl-monthly'].forEach(id => {
    const ds = raw[id] || {};
    if (ds.periods) {
      const latestKey = ds.latest;
      out[id] = latestKey
        ? (ds.periods[latestKey] || {})
        : Object.values(ds.periods).sort((a,b) => (b._periodKey||'') > (a._periodKey||'') ? 1 : -1)[0] || {};
      out[id + '_all'] = ds.periods;
    } else {
      out[id] = {};
      out[id + '_all'] = {};
    }
  });
 
  // Snapshot datasets: latest by pointer, plus full snapshot history.
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
 
  // Merge datasets are already flat at the top level.
  out['qbo-sales']        = raw['qbo-sales']        || {};
  out['qbo-transactions'] = raw['qbo-transactions'] || {};
  out['knowify-jobs']     = raw['knowify-jobs']     || {};
 
  return out;
}
 
/** One-call data subscriber — every report uses this. */
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
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 2 ─ KNOWIFY RULE ENGINE
// ════════════════════════════════════════════════════════════════════════
//
// The single implementation of Dylan's four reclassification rules. Run
// this once per page from raw knowify.jobs and pass the result to
// downstream renderers. Don't re-implement individual rules elsewhere.
 
const RELATIONSHIP_LEADS = ['James Thetford', 'Tyler Petty', 'Jenna Napier'];
const STALE_BID_DAYS = 120;
 
function _knowifyDateAge(jobDateStr, asOf) {
  if (!jobDateStr) return null;
  const d = new Date(jobDateStr);
  if (isNaN(d)) return null;
  return Math.floor((asOf - d) / (1000 * 60 * 60 * 24));
}
 
function _normalizeName(name) {
  if (!name) return '';
  return String(name).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}
 
/**
 * Apply Dylan's 4 rules + multi-GC annotation. Returns:
 *   { competitive: { jobs, wins, losses, pending, winRate, dollarWinRate, … },
 *     relationship: { jobs, bids, wonCV, wonCount },
 *     multiGC:    { projectCount, bidsInMultiGCProjects, avgGCsPerProject },
 *     byGC:       per-GC breakdown sorted by total bid value,
 *     byLead:     per-Sales-Lead breakdown,
 *     rawCounts:  { Active, Closed, Bidding, Rejected } }
 */
function applyKnowifyRules(rawJobs, opts = {}) {
  const asOf = opts.asOf instanceof Date ? opts.asOf : new Date();
  const all = [
    ...(rawJobs?.Active   || []).map(j => ({ ...j, originalStatus: 'Active'   })),
    ...(rawJobs?.Closed   || []).map(j => ({ ...j, originalStatus: 'Closed'   })),
    ...(rawJobs?.Bidding  || []).map(j => ({ ...j, originalStatus: 'Bidding'  })),
    ...(rawJobs?.Rejected || []).map(j => ({ ...j, originalStatus: 'Rejected' })),
  ];
 
  // RULE 1+2: outcome reclassification
  const classified = all.map(j => {
    const ageDays = _knowifyDateAge(j.createdDate, asOf);
    let outcome = null, reclassReason = null;
    if (j.originalStatus === 'Rejected') outcome = 'loss';
    else if (j.originalStatus === 'Active') outcome = 'win';
    else if (j.originalStatus === 'Closed') {
      if ((j.invoiced || 0) <= 0) { outcome = 'loss'; reclassReason = 'unbilled-closed'; }
      else outcome = 'win';
    } else if (j.originalStatus === 'Bidding') {
      if (ageDays != null && ageDays > STALE_BID_DAYS) { outcome = 'loss'; reclassReason = 'stale-bid'; }
      else outcome = 'pending';
    }
    return { ...j, ageDays, outcome, reclassReason };
  });
 
  // RULE 3: relationship vs competitive split
  const isRel = j => RELATIONSHIP_LEADS.includes((j.salesLead || '').trim());
  const competitive = classified.filter(j => !isRel(j));
  const relationship = classified.filter(isRel);
 
  // RULE 5: multi-GC dedup annotation (jobs grouped by normalized name)
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
  competitive.forEach(j => { j.isMultiGC = multiGCBidIds.has(j); });
 
  // Headline metrics
  const decided = competitive.filter(j => j.outcome === 'win' || j.outcome === 'loss');
  const wins    = decided.filter(j => j.outcome === 'win');
  const losses  = decided.filter(j => j.outcome === 'loss');
  const pending = competitive.filter(j => j.outcome === 'pending');
  const wonCV     = wins.reduce((s, j) => s + (j.contractTotal || 0), 0);
  const lostCV    = losses.reduce((s, j) => s + (j.contractTotal || 0), 0);
  const pendingCV = pending.reduce((s, j) => s + (j.contractTotal || 0), 0);
  const winRate       = decided.length ? +(wins.length / decided.length * 100).toFixed(1) : null;
  const dollarWinRate = (wonCV + lostCV) ? +(wonCV / (wonCV + lostCV) * 100).toFixed(1) : null;
 
  // Per-GC breakdown
  const byGC = {};
  competitive.forEach(j => {
    // Canonicalize the client name so known aliases (e.g. "JPI" + "JPI Companies")
    // merge into a single byGC row. Falls through to the raw name if the
    // alias map isn't loaded.
    const rawGc = (j.client || '').trim() || '— Unknown —';
    const gc = (typeof canonicalGCName === 'function') ? canonicalGCName(rawGc) : rawGc;
    if (!byGC[gc]) byGC[gc] = { gc, bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0 };
    byGC[gc].bids++;
    if (j.outcome === 'win')      { byGC[gc].wins++; byGC[gc].wonCV += j.contractTotal || 0; }
    else if (j.outcome === 'loss'){ byGC[gc].losses++; byGC[gc].lostCV += j.contractTotal || 0; }
    else                          { byGC[gc].pending++; byGC[gc].pendingCV += j.contractTotal || 0; }
  });
  Object.values(byGC).forEach(g => {
    g.totalCV = g.wonCV + g.lostCV + g.pendingCV;
    g.winRate = (g.wins + g.losses) ? +(g.wins / (g.wins + g.losses) * 100).toFixed(1) : null;
  });
 
  // Per-Sales-Lead breakdown
  const byLead = {};
  competitive.forEach(j => {
    const lead = (j.salesLead || '').trim() || '— Unassigned —';
    if (!byLead[lead]) byLead[lead] = { lead, bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0 };
    byLead[lead].bids++;
    if (j.outcome === 'win')      { byLead[lead].wins++; byLead[lead].wonCV += j.contractTotal || 0; }
    else if (j.outcome === 'loss'){ byLead[lead].losses++; }
    else                          { byLead[lead].pending++; }
  });
  Object.values(byLead).forEach(l => {
    l.winRate = (l.wins + l.losses) ? +(l.wins / (l.wins + l.losses) * 100).toFixed(1) : null;
  });
 
  // Relationship-channel summary
  const relWins = relationship.filter(j => j.originalStatus === 'Active' || (j.originalStatus === 'Closed' && (j.invoiced || 0) > 0));
  const relCV   = relWins.reduce((s, j) => s + (j.contractTotal || 0), 0);
 
  return {
    asOf: asOf.toISOString(),
    rules: { staleBidDays: STALE_BID_DAYS, relationshipLeads: RELATIONSHIP_LEADS },
    competitive: {
      jobs: competitive,
      decidedCount: decided.length,
      wins: wins.length, losses: losses.length, pending: pending.length,
      wonCV, lostCV, pendingCV,
      winRate, dollarWinRate,
      reclassifiedStale:    competitive.filter(j => j.reclassReason === 'stale-bid').length,
      reclassifiedUnbilled: competitive.filter(j => j.reclassReason === 'unbilled-closed').length,
    },
    relationship: { jobs: relationship, bids: relationship.length, wonCV: relCV, wonCount: relWins.length },
    multiGC: {
      projectCount: multiGCProjects.length,
      bidsInMultiGCProjects: multiGCBidIds.size,
      avgGCsPerProject: multiGCProjects.length ? +(multiGCBidIds.size / multiGCProjects.length).toFixed(1) : 0,
    },
    byGC:   Object.values(byGC).sort((a, b) => b.totalCV - a.totalCV),
    byLead: Object.values(byLead).sort((a, b) => b.bids - a.bids),
    rawCounts: {
      Active:   (rawJobs?.Active   || []).length,
      Closed:   (rawJobs?.Closed   || []).length,
      Bidding:  (rawJobs?.Bidding  || []).length,
      Rejected: (rawJobs?.Rejected || []).length,
    },
  };
}
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 3 ─ INDUSTRY BANDS (calibrated from docs/CONTEXT.md §4)
// ════════════════════════════════════════════════════════════════════════
//
// These are the apples-to-apples industry norms for a sub-$50M-revenue
// commercial construction subcontractor in TX. Reports must use these
// instead of generic "60% concentration = bad" guesses.
//
// Updating: when CONTEXT.md §4 changes, mirror the change here.
 
const BANDS = {
  // Customer concentration (top-N as % of total revenue). SBA flags >40%.
  concentration: { healthy: 30, watch: 40, risk: 60 },
 
  // P&L margins
  grossMargin:  { weak: 25, healthy: 35, strong: 50 },
  netMargin:    { weak:  3, healthy:  6, strong: 12 },
 
  // DSO — Days Sales Outstanding. Construction industry runs 60-90 days
  // normal. SFS at 50-80 is healthy, 80-100 means a slow GC is dragging,
  // 100+ across the book is a real issue.
  dso:          { healthy: 80, watch: 100, slow: 120 },
 
  // DPO mirrored
  dpo:          { healthy: 30, watch: 60 },
 
  // Working capital cycle (DSO − DPO). 20-50 days normal.
  wcCycle:      { healthy: 50, watch: 70 },
 
  // Liquidity ratios
  currentRatio: { weak: 1.0, healthy: 1.5, strong: 2.0 },
  debtToEquity: { strong: 1.0, healthy: 2.0, weak: 3.0 },
 
  // SBA DSCR — minimum 1.15x, lenders prefer 1.25x+
  dscr:         { sba: 1.15, lender: 1.25, strong: 1.5 },
 
  // Knowify pipeline — competitive win rate. Construction sub bid-win
  // rates are generally 10-30% on truly competitive bids; higher than
  // 30% often indicates the relationship-channel filter isn't working.
  winRate:      { weak: 8, healthy: 15, strong: 25 },
};
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 3b ─ CORE DERIVED METRICS
// ════════════════════════════════════════════════════════════════════════
 
/**
 * Top-N customer concentration as % of total revenue.
 * Threshold guidance: <30% healthy, 30-60% watch, >60% concentration risk.
 * SBA lenders flag anything over 40%.
 */
function customerConcentration(topCustomers, totalRevenue, n = 5) {
  if (!topCustomers || !topCustomers.length || !totalRevenue) return null;
  const topNRevenue = topCustomers.slice(0, n).reduce((s, c) => s + (c.total || 0), 0);
  return {
    n, topNRevenue,
    pctOfTotal: +(topNRevenue / totalRevenue * 100).toFixed(1),
    customers: topCustomers.slice(0, n).map(c => ({
      name: c.name, revenue: c.total, pct: +(c.total / totalRevenue * 100).toFixed(1),
    })),
  };
}
 
/**
 * "Days to pay" stats from the open invoices array.
 * INTERPRET AS: how long customers historically take to pay, NOT how late
 * they are. In TX construction the invoice is due when sent and there's
 * no enforceable deadline — past-due % is meaningless.
 *
 * Returns: { avgDays, medianDays, p90Days, maxDays, invoiceCount, buckets }
 */
function daysToPayStats(invoices) {
  if (!invoices || !invoices.length) return null;
  const ages = invoices
    .map(i => i.daysPastDue)
    .filter(d => typeof d === 'number' && !isNaN(d) && d >= 0);
  if (!ages.length) return null;
  ages.sort((a, b) => a - b);
  const sum = ages.reduce((s, v) => s + v, 0);
  const median = ages[Math.floor(ages.length / 2)];
  const p90    = ages[Math.floor(ages.length * 0.9)];
  const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d91_120: 0, d121_plus: 0 };
  ages.forEach(d => {
    if (d <= 30) buckets.d0_30++;
    else if (d <= 60) buckets.d31_60++;
    else if (d <= 90) buckets.d61_90++;
    else if (d <= 120) buckets.d91_120++;
    else buckets.d121_plus++;
  });
  return {
    invoiceCount: ages.length,
    avgDays: +(sum / ages.length).toFixed(1),
    medianDays: median,
    p90Days: p90,
    maxDays: ages[ages.length - 1],
    buckets,
  };
}
 
/** Effective DSO from a current AR balance and annualized revenue. */
function calcDSO(arBalance, annualRevenue) {
  if (!arBalance || !annualRevenue) return null;
  return +(arBalance / (annualRevenue / 365)).toFixed(1);
}
 
/** Effective DPO — Days Payable Outstanding. Mirror of DSO for the AP side. */
function calcDPO(apBalance, annualCOGS) {
  if (!apBalance || !annualCOGS) return null;
  return +(apBalance / (annualCOGS / 365)).toFixed(1);
}
 
/** Standard liquidity ratios from a single BS snapshot. Inventory is
 *  treated as zero for SFS (service business, no held materials). */
function balanceRatios(bs) {
  if (!bs || !bs.totalCurrentAssets || !bs.totalCurrentLiab) return null;
  const currentRatio = bs.totalCurrentLiab > 0 ? +(bs.totalCurrentAssets / bs.totalCurrentLiab).toFixed(2) : null;
  const quickRatio = currentRatio;  // ≈ current for service businesses
  const debtToEquity = bs.totalEquity ? +(bs.totalLiabilities / bs.totalEquity).toFixed(2) : null;
  const workingCapital = bs.totalCurrentAssets - bs.totalCurrentLiab;
  return { currentRatio, quickRatio, debtToEquity, workingCapital };
}
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 4 ─ CROSS-DATA COMBINATIONS
// ════════════════════════════════════════════════════════════════════════
 
/**
 * Working-capital cycle in days = DSO − DPO (inventory ~0 for service).
 * Lower = better. Negative = customers pay before vendors are paid (rare,
 * very healthy). Positive = financing customers' payment terms.
 */
function workingCapitalCycle(D) {
  const ar = D['qbo-open-invoices']?.summary?.totalOpen ?? D['qbo-bs']?.ar;
  const ap = D['qbo-ap-aging']?.summary?.total ?? D['qbo-bs']?.ap;
  const latestPL = _latestAnnualPL(D);
  if (!latestPL) return null;
  const dso = calcDSO(ar, latestPL.revenue);
  const dpo = calcDPO(ap, latestPL.cogsTotal);
  if (dso == null) return null;
  return {
    dso, dpo,
    cycleDays: dpo != null ? +(dso - dpo).toFixed(1) : null,
    arBalance: ar, apBalance: ap,
  };
}
 
/**
 * Cash runway in months: latest cash / average monthly burn (negative
 * operating cash flow). If operating CF is positive there's no burn —
 * returns Infinity-style { runwayMonths: null, burning: false }.
 */
function cashRunway(D) {
  const cash = D['qbo-bs']?.cash;
  const cf = D['qbo-cf'];
  if (cash == null || !cf) return null;
  // OperatingCF is annual — divide by 12 for monthly. Negative = burn.
  const monthlyOpCF = (cf.operatingCF || 0) / 12;
  if (monthlyOpCF >= 0) {
    return { cash, monthlyOpCF, burning: false, runwayMonths: null };
  }
  const burn = Math.abs(monthlyOpCF);
  return {
    cash, monthlyOpCF, burning: true,
    monthlyBurn: burn,
    runwayMonths: +(cash / burn).toFixed(1),
  };
}
 
/**
 * Debt service coverage ratio: EBITDA ÷ annual debt service (interest +
 * principal). Standard SBA threshold is 1.25x. Below 1.0 means business
 * isn't generating enough cash to cover loan obligations.
 *
 * NOTE: We approximate annual debt service from the BS long-term-debt
 * delta year-over-year + interest paid (from P&L). This is a rough cut —
 * for a real loan application Dylan should pull the actual loan amort
 * schedules.
 */
function dscr(D) {
  const pl = _latestAnnualPL(D);
  if (!pl || !pl.ebitda) return null;
  const interestPaid = (pl.opex || {})['Interest Paid'] || (pl.opex || {})['Interest_Paid'] || 0;
  // Estimate principal portion from BS LT debt delta (very rough)
  const snaps = D['qbo-bs_all'] || {};
  const dates = Object.keys(snaps).sort();
  let principalAnnualEst = null;
  if (dates.length >= 2) {
    const newest = snaps[dates[dates.length - 1]];
    const yearAgo = snaps[dates.find(d => d.startsWith(String(new Date().getFullYear() - 1)))] || snaps[dates[0]];
    if (newest?.longTermLiab != null && yearAgo?.longTermLiab != null) {
      const delta = yearAgo.longTermLiab - newest.longTermLiab;
      principalAnnualEst = delta > 0 ? delta : null;
    }
  }
  const debtService = (interestPaid || 0) + (principalAnnualEst || 0);
  if (debtService <= 0) return { ebitda: pl.ebitda, debtService: 0, ratio: null, note: 'no measurable debt service' };
  return {
    ebitda: pl.ebitda,
    interestPaid,
    principalAnnualEst,
    debtService,
    ratio: +(pl.ebitda / debtService).toFixed(2),
    sbaThreshold: 1.25,
    passes: pl.ebitda / debtService >= 1.25,
  };
}
 
/**
 * Margin-erosion detector: per OpEx category, compute % of revenue in
 * the latest year vs the prior year. Flags categories that grew >25% as
 * a share of revenue — these are eating into margin.
 */
function marginErosion(D) {
  const all = D['qbo-pl_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  if (years.length < 2) return null;
  const latest = all[years[years.length - 1]];
  const prior  = all[years[years.length - 2]];
  if (!latest?.opex || !prior?.opex || !latest.revenue || !prior.revenue) return null;
 
  const findings = [];
  Object.entries(latest.opex).forEach(([cat, amt]) => {
    const priorAmt = prior.opex[cat] || prior.opex[cat.replace(/_/g, ' ')] || 0;
    if (!priorAmt && !amt) return;
    const latestPct = amt / latest.revenue * 100;
    const priorPct  = priorAmt / prior.revenue * 100;
    const deltaPct  = latestPct - priorPct;
    // Only flag if category is non-trivial (>0.5% of revenue) and grew
    // by more than 25% as a share of revenue
    if (latestPct >= 0.5 && priorPct > 0 && (deltaPct / priorPct * 100) > 25) {
      findings.push({
        category: cat,
        priorAmt, latestAmt: amt,
        priorPct: +priorPct.toFixed(2),
        latestPct: +latestPct.toFixed(2),
        deltaPct: +deltaPct.toFixed(2),
        relGrowth: +(deltaPct / priorPct * 100).toFixed(1),
      });
    }
  });
  findings.sort((a, b) => b.deltaPct - a.deltaPct);
  return { yearLatest: years[years.length - 1], yearPrior: years[years.length - 2], findings };
}
 
/**
 * Customer ledger — combines lifetime sales, current open AR, days-to-pay
 * patterns. For each customer: { name, lifetimeRevenue, currentOpen,
 * openInvoiceCount, oldestOpenDays, isInPipeline }.
 *
 * "isInPipeline" cross-references with Knowify byGC to flag customers
 * who are also active bid GCs.
 */
function customerLedger(D) {
  const sales = D['qbo-sales'] || {};
  const oi    = D['qbo-open-invoices'] || {};
  const knowify = D['knowify-jobs'];
  const gcSet = new Set();
  if (knowify?.jobs) {
    const r = applyKnowifyRules(knowify.jobs);
    r.byGC.forEach(g => gcSet.add(_normalizeName(g.gc)));
  }
  const lifetime = {};
  (sales.topCustomers || []).forEach(c => { lifetime[c.name] = c.total || 0; });
  const open = {};
  (oi.customers || []).forEach(c => {
    open[c.name] = { totalOpen: c.totalOpen, invoiceCount: c.invoiceCount, oldestDays: c.oldestDays };
  });
  // Union of customer names from both sources
  const names = new Set([...Object.keys(lifetime), ...Object.keys(open)]);
  const rows = [...names].map(name => ({
    name,
    lifetimeRevenue: lifetime[name] || 0,
    currentOpen: open[name]?.totalOpen || 0,
    openInvoiceCount: open[name]?.invoiceCount || 0,
    oldestOpenDays: open[name]?.oldestDays || 0,
    isInPipeline: gcSet.has(_normalizeName(name)),
  }));
  // Composite sort: lifetime + 2x current AR (current AR weighted because
  // it represents money on the table right now)
  rows.sort((a, b) => (b.lifetimeRevenue + b.currentOpen * 2) - (a.lifetimeRevenue + a.currentOpen * 2));
  return rows;
}
 
/**
 * Customer health score (0–100) — composite indicator combining:
 *   • Lifetime revenue (50%) — bigger customer = better
 *   • Payment timeliness (30%) — lower oldestOpenDays = better
 *   • Open AR not too high relative to lifetime (20%) — high open vs
 *     lifetime = unusual concentration of risk
 *
 * Use case: "which customers should we pursue more business with" —
 * high-revenue + fast-paying customers are the keepers.
 */
function customerHealth(ledgerRow, totalLifetimeRevenue) {
  if (!ledgerRow) return null;
  const lifeScore = totalLifetimeRevenue
    ? Math.min(100, ledgerRow.lifetimeRevenue / totalLifetimeRevenue * 1000)  // top customer ≈ 100
    : 0;
  // Pay timeliness — 0 days = 100, 180+ days = 0. Linear in between.
  const days = ledgerRow.oldestOpenDays || 0;
  const timeScore = Math.max(0, 100 - (days / 180 * 100));
  // Open AR vs lifetime — if open AR > 10% of lifetime, flag as risk
  const openRatio = ledgerRow.lifetimeRevenue > 0 ? (ledgerRow.currentOpen / ledgerRow.lifetimeRevenue) : 0;
  const arScore = Math.max(0, 100 - openRatio * 1000);   // 10% open → 0 score
  return +(lifeScore * 0.5 + timeScore * 0.3 + arScore * 0.2).toFixed(0);
}
 
/**
 * Pipeline → expected revenue projection. Multiplies pending bid value
 * by historical win rate to estimate "likely revenue we'll book" from
 * what's currently bidding. Doesn't account for time-to-revenue yet —
 * call it a leading indicator, not a forecast.
 */
function pipelineProjection(D) {
  const knowify = D['knowify-jobs'];
  if (!knowify?.jobs) return null;
  const r = applyKnowifyRules(knowify.jobs);
  if (r.competitive.dollarWinRate == null) return null;
  return {
    pendingValue:   r.competitive.pendingCV,
    historicalRate: r.competitive.dollarWinRate,
    expectedWinValue: +(r.competitive.pendingCV * r.competitive.dollarWinRate / 100).toFixed(2),
    pendingBids:    r.competitive.pending,
  };
}
 
/**
 * Cash flow conversion: NI → operating CF. Indicates "quality of earnings."
 * Healthy SaaS hits 100%+ (depreciation/amortization adds back). Service
 * businesses with growing AR can have OCF lower than NI (working capital
 * absorbs cash). Below 50% over multiple years is a flag — earnings exist
 * on paper but aren't turning into cash.
 */
function cashFlowConversion(D) {
  const all = D['qbo-cf_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  return years.map(y => {
    const cf = all[y];
    const ni = cf.netIncome || 0;
    const ocf = cf.operatingCF || 0;
    return {
      year: y,
      netIncome: ni,
      operatingCF: ocf,
      conversionPct: ni !== 0 ? +(ocf / ni * 100).toFixed(1) : null,
    };
  });
}
 
/**
 * Revenue YoY growth rates across all available years.
 */
function revenueGrowth(D) {
  const all = D['qbo-pl_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  return years.map((y, i) => {
    const rev = all[y].revenue || 0;
    const prior = i > 0 ? (all[years[i - 1]].revenue || 0) : null;
    return {
      year: y,
      revenue: rev,
      yoyPct: prior ? +(((rev - prior) / prior) * 100).toFixed(1) : null,
    };
  });
}
 
/**
 * Cost line items as % of revenue, year by year. Surfaces creeping cost
 * ratios. Returns categoryTrend[catName] → [{year, pctOfRevenue}, …].
 */
function opexTrend(D) {
  const all = D['qbo-pl_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  const cats = new Set();
  years.forEach(y => Object.keys(all[y].opex || {}).forEach(c => cats.add(c)));
  const out = {};
  [...cats].forEach(cat => {
    out[cat] = years.map(y => {
      const opex = all[y].opex || {};
      const amt = opex[cat] || 0;
      const rev = all[y].revenue || 0;
      return { year: y, amt, pctOfRevenue: rev ? +(amt / rev * 100).toFixed(2) : null };
    });
  });
  return out;
}
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 4b ─ OPERATIONAL METRICS (most-actionable for SFS)
// ════════════════════════════════════════════════════════════════════════
//
// These are the metrics Dylan actually runs the business on. Per the
// CONTEXT.md note, "past due" is a misnomer (TX subs have no enforceable
// deadline), so we frame everything as days-to-pay and customer payment
// behavior, not collections crises.
 
/**
 * Per-customer payment-behavior summary from currently-open invoices.
 * For each customer with open AR, compute their average days-out across
 * their open invoices, plus their slowest one. This is the "which
 * customers actually pay on time vs which drag" leaderboard.
 *
 * Output rows: { name, openCount, totalOpen, avgDaysOut, oldestDaysOut,
 *                hasInvoiceOver90, hasInvoiceOver120 }
 *
 * Sort: by avgDaysOut descending (slowest payers first) — that's the
 * leaderboard SFS needs to see when prioritizing collection calls or
 * deciding which GCs to require deposits from.
 */
function customerPaymentPatterns(D) {
  const oi = D?.['qbo-open-invoices'];
  if (!oi?.invoices?.length) return null;
 
  const byCustomer = {};
  for (const inv of oi.invoices) {
    const c = inv.customer || '— Unknown —';
    if (!byCustomer[c]) byCustomer[c] = {
      name: c, openCount: 0, totalOpen: 0,
      daysSum: 0, daysCount: 0, oldestDaysOut: 0,
      hasInvoiceOver90: false, hasInvoiceOver120: false,
    };
    const row = byCustomer[c];
    row.openCount++;
    row.totalOpen += inv.openBalance || 0;
    const d = inv.daysPastDue;
    if (typeof d === 'number' && d >= 0 && isFinite(d)) {
      row.daysSum += d;
      row.daysCount++;
      if (d > row.oldestDaysOut) row.oldestDaysOut = d;
      if (d > 90)  row.hasInvoiceOver90  = true;
      if (d > 120) row.hasInvoiceOver120 = true;
    }
  }
  const rows = Object.values(byCustomer).map(r => ({
    name: r.name,
    openCount: r.openCount,
    totalOpen: +r.totalOpen.toFixed(2),
    avgDaysOut: r.daysCount ? +(r.daysSum / r.daysCount).toFixed(1) : null,
    oldestDaysOut: r.oldestDaysOut,
    hasInvoiceOver90: r.hasInvoiceOver90,
    hasInvoiceOver120: r.hasInvoiceOver120,
  }));
  rows.sort((a, b) => (b.avgDaysOut || 0) - (a.avgDaysOut || 0));
  return rows;
}
 
/**
 * Seasonal calibration — comparing each month of the current year against
 * the same month from the prior full year. Returns null if we don't have
 * enough monthly history.
 *
 * Sources:
 *   • qbo-pl-monthly (current year per-line monthly)
 *   • qbo-sales.monthlyByYear (historical per-month revenue from Sales by
 *     Customer Detail). Note this is sales-by-customer revenue, which
 *     understates P&L revenue by 5-25% (uncategorized income, deposits).
 *     For YoY-shape comparison the gap is OK; for absolute $ comparison
 *     it's a caveat.
 *
 * Output: { currentYear, priorYear, months: [{name, currentRev, priorRev,
 *           yoyPct, ytdSamePeriodCY, ytdSamePeriodPY, ytdYoyPct}, …] }
 */
function seasonalRevenueCompare(D) {
  const monthly = D?.['qbo-pl-monthly'];
  const monthlyByYear = D?.['qbo-sales']?.monthlyByYear;
  if (!monthly?.revenue?.months || !monthly.meta?.year || !monthlyByYear) return null;
 
  const currentYear = monthly.meta.year;
  const priorYear   = String(parseInt(currentYear, 10) - 1);
  const priorRow    = monthlyByYear[priorYear];
  if (!priorRow) return null;
 
  const cyRev = monthly.revenue.months;       // length = months in YTD export
  const monthHeaders = monthly.meta.monthHeaders || [];
 
  let cyYTD = 0, pyYTD = 0;
  const months = cyRev.map((cy, i) => {
    const py = priorRow[i] || 0;
    cyYTD += cy || 0;
    pyYTD += py || 0;
    return {
      name: monthHeaders[i] || `M${i+1}`,
      currentRev: cy || 0,
      priorRev: py,
      yoyPct: py > 0 ? +(((cy - py) / py) * 100).toFixed(1) : null,
      ytdSamePeriodCY: cyYTD,
      ytdSamePeriodPY: pyYTD,
      ytdYoyPct: pyYTD > 0 ? +(((cyYTD - pyYTD) / pyYTD) * 100).toFixed(1) : null,
    };
  });
  return { currentYear, priorYear, months };
}
 
/**
 * Cost productivity — for each OpEx category, how much revenue does
 * each dollar of spend produce, and is it trending up (productive) or
 * down (creeping cost)? This is the "is this spend earning its keep"
 * lens for OpEx review.
 *
 * Output: array of { category, latestPctOfRevenue, priorPctOfRevenue,
 *                    deltaPct, isCreeping, materiality }
 */
function costProductivity(D) {
  const all = D?.['qbo-pl_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  if (years.length < 2) return null;
  const cy = years[years.length - 1], py = years[years.length - 2];
  const latest = all[cy], prior = all[py];
  if (!latest?.opex || !prior?.opex || !latest.revenue || !prior.revenue) return null;
 
  const findings = [];
  for (const [cat, amt] of Object.entries(latest.opex)) {
    const priorAmt = prior.opex[cat] || prior.opex[cat.replace(/_/g, ' ')] || 0;
    const latestPct = +(amt / latest.revenue * 100).toFixed(2);
    const priorPct  = priorAmt > 0 ? +(priorAmt / prior.revenue * 100).toFixed(2) : null;
    findings.push({
      category: cat,
      latestAmt: amt,
      priorAmt,
      latestPctOfRevenue: latestPct,
      priorPctOfRevenue: priorPct,
      deltaPct: priorPct != null ? +(latestPct - priorPct).toFixed(2) : null,
      isCreeping: priorPct != null && latestPct > priorPct + 0.5 && latestPct >= 1,
      isShrinking: priorPct != null && latestPct < priorPct - 0.5,
      materiality: latestPct,   // bigger = more important to review
    });
  }
  findings.sort((a, b) => b.materiality - a.materiality);
  return { yearLatest: cy, yearPrior: py, findings };
}
 
/**
 * Pipeline velocity — for closed (Active+Closed) jobs in Knowify, how
 * many days from creation to award. Approximates "decision time" so SFS
 * can plan capacity.
 *
 * Note: this only works on jobs that DO have outcomes (won), and
 * approximates "time to award" as creation→today (since Knowify doesn't
 * record award date separately). Useful as a leading-edge view of how
 * fast the GC market is moving.
 *
 * Output: { medianDays, p25, p75, sample }
 */
function pipelineVelocity(D) {
  const knowify = D?.['knowify-jobs'];
  if (!knowify?.jobs) return null;
  const r = applyKnowifyRules(knowify.jobs);
  const wonJobs = r.competitive.jobs.filter(j => j.outcome === 'win' && j.ageDays != null && j.ageDays >= 0);
  if (wonJobs.length === 0) return null;
  const ages = wonJobs.map(j => j.ageDays).sort((a, b) => a - b);
  const median = ages[Math.floor(ages.length / 2)];
  const p25 = ages[Math.floor(ages.length * 0.25)];
  const p75 = ages[Math.floor(ages.length * 0.75)];
  return { medianDays: median, p25, p75, sample: ages.length };
}
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 4c ─ GC SEGMENTATION (Group A / B / C — see CONTEXT.md §2.5)
// ════════════════════════════════════════════════════════════════════════
//
// SFS_Outreach_Action_List.xlsx classifies GCs into descriptive groups:
//   • Group A — derived live from Knowify (≥70% WR, ≥5 decided bids)
//   • Group B — 26 GCs in core/gc-segmentation.js (active competitive)
//   • Group C-STOP — chain-locked-pattern GCs (~22 GCs; PlanHub EXCLUDED)
//   • Group C-PUB — public-sector zero-win (25 GCs)
//   • Group C-MIX — mixed-commercial zero-win (103 GCs)
//   • DATA-ARTIFACT — PlanHub. Won bids get renamed to the real GC after
//     award; the apparent 0% WR is not a real signal. Don't aggregate.
//
// IMPORTANT — these are *descriptive* groupings. The pricing-analysis
// recommendations attached to each group (dinner with these, stop those)
// are analyst suggestions, not auto-actions. The dashboard does NOT
// generate "stop bidding GC X" or "save Y hours/year" insights. It just
// shows the segmentation as context.
//
// The classification table is loaded from core/gc-segmentation.js into
// window.GC_CLASSIFICATION. classifyGCByOutreach() looks up a GC name
// against that table. Group A is computed at runtime from byGC stats,
// not hardcoded — it stays current as bid history accumulates.
 
/**
 * Classify a GC name against the static outreach-list groups + the
 * dynamic Group A derivation (from current Knowify byGC stats).
 *
 * Returns: { name, group, source, raw, count } where:
 *   group ∈ {'A','B','C-STOP','C-PUB','C-MIX','CHAIN','UNCLASSIFIED'}
 *   source = 'live-A' (computed) | 'segmentation-list' | 'unknown'
 */
function classifyGCByOutreach(gcName, byGC) {
  if (!gcName) return { name: gcName, group: 'UNCLASSIFIED', source: 'unknown' };
  // 1. Try the static list first (window.GC_CLASSIFICATION from gc-segmentation.js)
  const fromList = (typeof classifyGC === 'function') ? classifyGC(gcName) : null;
  // 2. Compute live Group A independently from Knowify
  const norm = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
  let liveA = null;
  if (Array.isArray(byGC)) {
    const target = norm(gcName);
    const match = byGC.find(g => norm(g.gc) === target);
    if (match) {
      const decided = (match.wins || 0) + (match.losses || 0);
      const wr = decided ? (match.wins / decided * 100) : null;
      // Group A threshold per CONTEXT.md §2.5 — ≥70% WR over ≥5 decided.
      if (decided >= 5 && wr != null && wr >= 70) {
        liveA = { wr: +wr.toFixed(1), bids: match.bids, wins: match.wins, decided };
      }
    }
  }
  // Group A overrides static classification IF it would have been C-MIX (zero-win
  // categories should never override this — only "no win history" cases).
  // In practice the static list never assigns Group A, so this is purely additive.
  if (liveA) {
    return { name: gcName, group: 'A', source: 'live-A', meta: liveA, raw: fromList?.raw || gcName };
  }
  if (fromList) {
    return { name: gcName, group: fromList.group, source: 'segmentation-list', raw: fromList.raw, count: fromList.count };
  }
  return { name: gcName, group: 'UNCLASSIFIED', source: 'unknown', raw: gcName };
}
 
/**
 * Pipeline by outreach group — for the *live* pending bids in Knowify,
 * how does pending value distribute across A / B / C-STOP / C-PUB /
 * C-MIX / UNCLASSIFIED?
 *
 * Output:
 *   {
 *     groups: { A: {gcs, bids, pendingCV, wonCV}, B: {…}, … },
 *     unclassifiedCount, unclassifiedGCs[],
 *   }
 */
function pipelineByGroup(D) {
  const k = D?.['knowify-jobs'];
  if (!k?.jobs) return null;
  const R = applyKnowifyRules(k.jobs);
  const out = {
    A:           { label: 'Group A — Maintain',        gcs: [], bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0 },
    B:           { label: 'Group B — Dinner targets',  gcs: [], bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0 },
   'C-STOP':     { label: 'C — Stop bidding',           gcs: [], bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0 },
   'C-PUB':      { label: 'C — Cert-check (pub-sector)',gcs: [], bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0 },
   'C-MIX':      { label: 'C — Post-loss call needed',  gcs: [], bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0 },
    CHAIN:       { label: 'Chain-builder GC',           gcs: [], bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0 },
    UNCLASSIFIED:{ label: 'Unclassified',               gcs: [], bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0 },
  };
  R.byGC.forEach(g => {
    const c = classifyGCByOutreach(g.gc, R.byGC);
    const bucket = out[c.group] || out.UNCLASSIFIED;
    bucket.gcs.push({ gc: g.gc, group: c.group, bids: g.bids, wins: g.wins, losses: g.losses, pending: g.pending, pendingCV: g.pendingCV, wonCV: g.wonCV, lostCV: g.lostCV, totalCV: g.totalCV });
    bucket.bids      += g.bids || 0;
    bucket.pending   += g.pending || 0;
    bucket.pendingCV += g.pendingCV || 0;
    bucket.wonCV     += g.wonCV || 0;
    bucket.lostCV    += g.lostCV || 0;
  });
  // Sort each bucket by total CV bid (descending — biggest exposures first)
  Object.values(out).forEach(b => b.gcs.sort((a, c) => c.totalCV - a.totalCV));
  return out;
}
 
/**
 * Bid-volume distribution by group — purely descriptive. Tells you how
 * many bids and how much pending CV currently sit in each segmentation
 * bucket. No recommendations attached. (Per CONTEXT.md §2.5: groupings
 * are descriptive context, not auto-actions.)
 *
 * Output: { groups: { groupKey: { gcCount, bids, pending, pendingCV,
 *                                  wonCV, lostCV, sampleGCs } } }
 */
function bidDistributionByGroup(D) {
  const k = D?.['knowify-jobs'];
  if (!k?.jobs) return null;
  const R = applyKnowifyRules(k.jobs);
  const out = {
    A:             { gcCount: 0, bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0, sampleGCs: [] },
    B:             { gcCount: 0, bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0, sampleGCs: [] },
   'C-STOP':       { gcCount: 0, bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0, sampleGCs: [] },
   'C-PUB':        { gcCount: 0, bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0, sampleGCs: [] },
   'C-MIX':        { gcCount: 0, bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0, sampleGCs: [] },
    CHAIN:         { gcCount: 0, bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0, sampleGCs: [] },
   'DATA-ARTIFACT':{ gcCount: 0, bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0, sampleGCs: [] },
    UNCLASSIFIED:  { gcCount: 0, bids: 0, pending: 0, pendingCV: 0, wonCV: 0, lostCV: 0, sampleGCs: [] },
  };
  R.byGC.forEach(g => {
    const c = classifyGCByOutreach(g.gc, R.byGC);
    const bucket = out[c.group] || out.UNCLASSIFIED;
    bucket.gcCount   += 1;
    bucket.bids      += g.bids || 0;
    bucket.pending   += g.pending || 0;
    bucket.pendingCV += g.pendingCV || 0;
    bucket.wonCV     += g.wonCV || 0;
    bucket.lostCV    += g.lostCV || 0;
    bucket.sampleGCs.push({ gc: g.gc, bids: g.bids, wins: g.wins, losses: g.losses, pending: g.pending, pendingCV: g.pendingCV, wonCV: g.wonCV, lostCV: g.lostCV, totalCV: g.totalCV });
  });
  Object.values(out).forEach(b => b.sampleGCs.sort((a, c) => c.totalCV - a.totalCV));
  return out;
}
 
/**
 * Group B follow-up candidates — recent (last 90 days) competitive
 * losses on Group B GCs. These are the specific lost bids Dylan would
 * reference in dinner conversations: "We bid X in March — who got it?"
 *
 * Output: array of { gc, jobName, contractValue, ageDays, group:'B' }
 * sorted by recency.
 */
function groupBRecentLosses(D, days = 90) {
  const k = D?.['knowify-jobs'];
  if (!k?.jobs) return null;
  const R = applyKnowifyRules(k.jobs);
  const cutoffMs = days * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const out = [];
  // Canonicalize the per-job client name once so aliases (e.g. "JPI" →
  // "JPI Companies") resolve correctly against the static segmentation map.
  const canon = (n) => (typeof canonicalGCName === 'function') ? canonicalGCName(n) : n;
  R.competitive.jobs.forEach(j => {
    if (j.outcome !== 'loss') return;
    const canonClient = canon(j.client);
    const c = classifyGCByOutreach(canonClient, R.byGC);
    if (c.group !== 'B') return;
    if (j.ageDays != null && j.ageDays * 24 * 60 * 60 * 1000 > cutoffMs) return;
    out.push({
      gc: canonClient, jobName: j.name || j.jobName,
      contractValue: j.contractTotal,
      ageDays: j.ageDays, salesLead: j.salesLead,
    });
  });
  out.sort((a, b) => (a.ageDays || 9999) - (b.ageDays || 9999));
  return out;
}
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 5 ─ AUTO-INSIGHTS
// ════════════════════════════════════════════════════════════════════════
//
// generateInsights(D) returns an ordered list of natural-language insights
// based on whatever data is currently in Firebase. Used by the Insights
// report page. Each insight has:
//   { id, category, severity, title, message, value, recommendation }
 
// IMPORTANT FOR FUTURE CHATS:
// SFS controls *internal levers*: pricing/margin, OpEx, crew/capacity,
// service mix, hiring. They do NOT control: when GCs pay, which GCs win
// primes (since SFS bids every job they can), customer relationships at
// scale. Auto-insights must focus on what Dylan can act on.
//
// Don't generate AR-collection alarms (Dylan: "We can't control when ARs
// get paid, so focusing on that will do nothing"). Don't generate
// per-customer or per-GC pursuit recommendations (Dylan: "We will be
// doing every bid we can already. We're not picky about what bids we
// do"). Customer/GC data belongs in descriptive views, not insights.
function generateInsights(D) {
  const out = [];
 
  // ── 1. Net margin (pricing/cost discipline — internal lever) ─────
  const pl = _latestAnnualPL(D);
  if (pl?.netMarginPct != null) {
    const m = pl.netMarginPct;
    if (m < BANDS.netMargin.weak) {
      out.push({
        id: 'net-margin-weak', category: 'margin', severity: 'warning',
        title: `Net margin ${m.toFixed(1)}% — below industry median`,
        message: `Construction-subcontractor peers run 5-10% net median; top decile >20%. Last full year landed at ${m.toFixed(1)}%.`,
        value: `${m.toFixed(1)}%`,
        recommendation: 'Two internal levers: bid pricing discipline (industry standard add is 30-40% over cost) and OpEx ratio review (see cost productivity below).',
      });
    } else if (m >= BANDS.netMargin.strong) {
      out.push({
        id: 'net-margin-strong', category: 'margin', severity: 'positive',
        title: `Net margin ${m.toFixed(1)}% — top-quartile`,
        message: `Construction-sub peers median 5-10%. SFS at ${m.toFixed(1)}% is top-quartile.`,
        value: `${m.toFixed(1)}%`, recommendation: '',
      });
    }
  }
 
  // ── 2. Gross margin trajectory (pricing power signal) ────────────
  // Multi-year GM trend tells whether SFS is holding pricing or eroding.
  const all = D['qbo-pl_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  if (years.length >= 3) {
    const recent = years.slice(-3).map(y => all[y].grossMarginPct).filter(v => v != null);
    if (recent.length >= 3) {
      const drop = recent[0] - recent[recent.length - 1];
      if (drop > 5) {
        out.push({
          id: 'gm-erosion', category: 'margin', severity: 'warning',
          title: `Gross margin compressed ${drop.toFixed(1)}pp over 3 years`,
          message: `${years[years.length-3]}: ${recent[0]}% → ${years[years.length-1]}: ${recent[recent.length-1]}%. Either bid prices haven't kept up with COGS, or the job mix has shifted toward lower-margin work.`,
          value: `-${drop.toFixed(1)}pp`,
          recommendation: 'Worth a bid-pricing audit on the next 5-10 jobs: what % was added over estimated cost?',
        });
      } else if (drop < -5) {
        out.push({
          id: 'gm-expansion', category: 'margin', severity: 'positive',
          title: `Gross margin expanded ${Math.abs(drop).toFixed(1)}pp over 3 years`,
          message: `${years[years.length-3]}: ${recent[0]}% → ${years[years.length-1]}: ${recent[recent.length-1]}%. Pricing or mix improvement is working.`,
          value: `+${Math.abs(drop).toFixed(1)}pp`, recommendation: '',
        });
      }
    }
  }
 
  // ── 3. OpEx categories creeping vs producing revenue ─────────────
  // The "is this cost producing matching revenue?" lens — a controllable.
  const cp = costProductivity(D);
  if (cp) {
    const creeping = cp.findings.filter(f => f.isCreeping).slice(0, 4);
    if (creeping.length) {
      out.push({
        id: 'cost-creep', category: 'cost', severity: creeping[0].deltaPct > 5 ? 'warning' : 'info',
        title: `${creeping.length} OpEx categor${creeping.length === 1 ? 'y' : 'ies'} grew faster than revenue`,
        message: `${cp.yearLatest} vs ${cp.yearPrior}: ` +
          creeping.map(f => `${f.category.replace(/_/g, ' ')} (${f.priorPctOfRevenue}%→${f.latestPctOfRevenue}%)`).join(', ') + '.',
        value: creeping[0].category.replace(/_/g, ' '),
        recommendation: 'For each category: did the extra spend create equivalent revenue capacity? If yes, the growth is investment. If not, it\'s margin leak.',
      });
    }
    const shrinking = cp.findings.filter(f => f.isShrinking && f.materiality >= 1).slice(0, 3);
    if (shrinking.length >= 2) {
      out.push({
        id: 'cost-discipline', category: 'cost', severity: 'positive',
        title: `${shrinking.length} OpEx categories shrank as a share of revenue`,
        message: `Cost discipline visible on: ` +
          shrinking.map(f => `${f.category.replace(/_/g, ' ')} (${f.priorPctOfRevenue}%→${f.latestPctOfRevenue}%)`).join(', ') + '.',
        value: 'OK', recommendation: '',
      });
    }
  }
 
  // ── 4. Crew productivity / labor leverage ────────────────────────
  // Revenue ÷ (Wages COGS + Salaries OpEx) tells you how much top-line
  // each labor dollar is producing. Going up = more efficient delivery.
  if (pl?.revenue) {
    const wagesCogs = (pl.cogs || {})['Wages_COGS_'] || (pl.cogs || {})['Wages(COGS)'] || 0;
    const salariesOpex = (pl.opex || {})['Salaries___Wages'] || (pl.opex || {})['Salaries & Wages'] || 0;
    const totalLabor = wagesCogs + salariesOpex;
    if (totalLabor > 0) {
      const revPerLabor = pl.revenue / totalLabor;
      // Compare to prior year if available
      const priorYr = years[years.length - 2];
      const priorPL = priorYr ? all[priorYr] : null;
      let priorRevPerLabor = null;
      if (priorPL?.revenue) {
        const pw = (priorPL.cogs || {})['Wages_COGS_'] || (priorPL.cogs || {})['Wages(COGS)'] || 0;
        const ps = (priorPL.opex || {})['Salaries___Wages'] || (priorPL.opex || {})['Salaries & Wages'] || 0;
        if (pw + ps > 0) priorRevPerLabor = priorPL.revenue / (pw + ps);
      }
      const deltaPct = priorRevPerLabor ? ((revPerLabor - priorRevPerLabor) / priorRevPerLabor * 100) : null;
      if (deltaPct != null && Math.abs(deltaPct) > 10) {
        out.push({
          id: 'labor-leverage', category: 'productivity', severity: deltaPct > 0 ? 'positive' : 'warning',
          title: deltaPct > 0
            ? `Each labor $ producing ${deltaPct.toFixed(0)}% more revenue YoY`
            : `Each labor $ producing ${Math.abs(deltaPct).toFixed(0)}% less revenue YoY`,
          message: `${pl.meta?.period || ''}: $${revPerLabor.toFixed(2)} of revenue per $1 of labor (Wages COGS + Salaries). Prior: $${priorRevPerLabor.toFixed(2)}.`,
          value: `$${revPerLabor.toFixed(2)}/$1`,
          recommendation: deltaPct > 0
            ? ''
            : 'Lower labor leverage usually means: hired ahead of demand, or work mix shifted toward lower-revenue jobs per crew-hour. Check capacity utilization next.',
        });
      }
    }
  }
 
  // ── 5. Seasonal pace (this year vs same months last year) ────────
  // Tells Dylan whether the current year is on/off track relative to
  // the seasonal expectation. Q1 is normally weakest in TX striping.
  const season = seasonalRevenueCompare(D);
  if (season?.months?.length) {
    const lastMonth = season.months[season.months.length - 1];
    if (lastMonth.ytdYoyPct != null && Math.abs(lastMonth.ytdYoyPct) > 10) {
      const yoy = lastMonth.ytdYoyPct;
      const sev = yoy > 25 ? 'positive' : yoy < -20 ? 'warning' : 'info';
      out.push({
        id: 'seasonal-pace', category: 'pace', severity: sev,
        title: `${season.currentYear} YTD pacing ${yoy >= 0 ? '+' : ''}${yoy}% vs ${season.priorYear} same months`,
        message: `Through ${lastMonth.name}: ${fmt(lastMonth.ytdSamePeriodCY)} this year vs ${fmt(lastMonth.ytdSamePeriodPY)} the same months last year.`,
        value: `${yoy >= 0 ? '+' : ''}${yoy}%`,
        recommendation: yoy < -20 ? 'Q1 is normally weakest in TX striping (April-Nov is peak); a Q1 dip alone may just be timing. Re-check after May/June numbers.' : '',
      });
    }
  }
 
  // ── 6. Pipeline forecast (forward visibility — operational) ──────
  const proj = pipelineProjection(D);
  if (proj) {
    out.push({
      id: 'pipeline-forecast', category: 'pipeline', severity: 'info',
      title: 'Forward booking floor from current pipeline',
      message: `${fmt(proj.pendingValue)} in pending bids × ${proj.historicalRate}% historical $ win rate = ${fmt(proj.expectedWinValue)} expected wins.`,
      value: fmt(proj.expectedWinValue),
      recommendation: 'Use as a planning floor for crew/equipment commitments over the next ~60-90 days.',
    });
  }
 
  // ── 7. Pipeline velocity (planning input) ────────────────────────
  const vel = pipelineVelocity(D);
  if (vel?.medianDays != null) {
    out.push({
      id: 'pipeline-velocity', category: 'pipeline', severity: 'info',
      title: `Bid → award median: ${vel.medianDays} days`,
      message: `Across ${vel.sample} won bids: 25th-pct ${vel.p25}d, median ${vel.medianDays}d, 75th-pct ${vel.p75}d.`,
      value: `${vel.medianDays}d`,
      recommendation: 'For capacity planning: a bid submitted today typically books as work ~' + vel.medianDays + ' days out.',
    });
  }
 
  // ── 8. Knowify data quality flag (informational) ─────────────────
  const k = D['knowify-jobs'];
  if (k?.jobs) {
    const r = applyKnowifyRules(k.jobs);
    const reclassified = r.competitive.reclassifiedStale + r.competitive.reclassifiedUnbilled;
    if (reclassified > 50) {
      out.push({
        id: 'knowify-quality', category: 'data', severity: 'info',
        title: `${reclassified} stale Knowify bids auto-reclassified`,
        message: `${r.competitive.reclassifiedStale} stale (>120d) + ${r.competitive.reclassifiedUnbilled} unbilled-closed bids flipped to losses by SFS rules. Win-rate metrics use the cleaned set.`,
        value: reclassified,
        recommendation: '',
      });
    }
  }
 
  return out;
}
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 6 ─ HELPERS
// ════════════════════════════════════════════════════════════════════════
 
/** Helper used by several metrics — get the latest annual P&L (not YTD). */
function _latestAnnualPL(D) {
  const all = D['qbo-pl_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  // Prefer the second-to-last if the last is current year (likely YTD).
  // But if there's only one year, take it.
  if (years.length === 0) return null;
  const currentYr = String(new Date().getFullYear());
  if (years[years.length - 1] === currentYr && years.length > 1) {
    return all[years[years.length - 2]];
  }
  return all[years[years.length - 1]];
}
 
 
// ════════════════════════════════════════════════════════════════════════
// SECTION 7 ─ CHART.JS THEME
// ════════════════════════════════════════════════════════════════════════
 
function setupChartTheme() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = '#8a90a0';
  Chart.defaults.borderColor = '#252a38';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size = 11;
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
 
const CHART_COLORS = {
  yellow:'#f5c842', orange:'#e07b2b', red:'#e05252', green:'#3ecf8e',
  blue:'#4a9eff', purple:'#9b6dff', muted:'#555c70', bright:'#e8eaf0',
};
