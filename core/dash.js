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
    const gc = (j.client || '').trim() || '— Unknown —';
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
// SECTION 3 ─ CORE DERIVED METRICS
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
// SECTION 5 ─ AUTO-INSIGHTS
// ════════════════════════════════════════════════════════════════════════
//
// generateInsights(D) returns an ordered list of natural-language insights
// based on whatever data is currently in Firebase. Used by the Insights
// report page. Each insight has:
//   { id, category, severity, title, message, value, recommendation }
 
function generateInsights(D) {
  const out = [];
 
  // ── Revenue & profit trajectory ──────────────────────────────────
  const growth = revenueGrowth(D);
  const latestGrowth = growth[growth.length - 1];
  if (latestGrowth?.yoyPct != null) {
    if (latestGrowth.yoyPct >= 50) {
      out.push({
        id: 'rev-growth-high', category: 'performance', severity: 'positive',
        title: `Revenue ${latestGrowth.yoyPct >= 100 ? 'doubled' : 'jumped sharply'}`,
        message: `${latestGrowth.year} revenue is ${latestGrowth.yoyPct}% above ${growth[growth.length - 2]?.year}.`,
        value: `${latestGrowth.yoyPct}%`,
        recommendation: 'Confirm capacity (crews, equipment, working capital) is keeping up. Rapid revenue growth without margin discipline is the #1 cause of small-business failure.',
      });
    } else if (latestGrowth.yoyPct < 0) {
      out.push({
        id: 'rev-decline', category: 'performance', severity: 'warning',
        title: 'Revenue declined year over year',
        message: `${latestGrowth.year} is ${Math.abs(latestGrowth.yoyPct)}% below ${growth[growth.length - 2]?.year}.`,
        value: `${latestGrowth.yoyPct}%`,
        recommendation: 'Check whether this is YTD-vs-full-year (apples to apples requires a full year on both sides).',
      });
    }
  }
 
  // ── Margin erosion ────────────────────────────────────────────────
  const erosion = marginErosion(D);
  if (erosion && erosion.findings.length) {
    const top = erosion.findings.slice(0, 3);
    out.push({
      id: 'margin-erosion', category: 'cost', severity: top[0].relGrowth > 50 ? 'warning' : 'info',
      title: 'Cost categories growing faster than revenue',
      message: `${top.length} category${top.length > 1 ? 'ies are' : ' is'} eating into margin: ` +
        top.map(f => `${f.category} (${f.priorPct}%→${f.latestPct}% of revenue)`).join(', ') + '.',
      value: top[0].category,
      recommendation: 'Look at each category — is the spend producing equivalent value? If not, time to renegotiate or trim.',
    });
  }
 
  // ── Customer concentration ────────────────────────────────────────
  const sales = D['qbo-sales'] || {};
  const conc = customerConcentration(sales.topCustomers, sales.totalRevenue, 5);
  if (conc) {
    if (conc.pctOfTotal > 60) {
      out.push({
        id: 'concentration-high', category: 'risk', severity: 'warning',
        title: 'High customer concentration',
        message: `Top 5 customers represent ${conc.pctOfTotal}% of lifetime revenue. SBA lenders flag anything over 40%.`,
        value: `${conc.pctOfTotal}%`,
        recommendation: 'Diversify the customer book before applying for credit. Explicitly name your top 3 in any loan narrative.',
      });
    } else if (conc.pctOfTotal < 30) {
      out.push({
        id: 'concentration-low', category: 'risk', severity: 'positive',
        title: 'Healthy customer diversification',
        message: `Top 5 customers are ${conc.pctOfTotal}% of revenue — well diversified.`,
        value: `${conc.pctOfTotal}%`,
        recommendation: 'Strong position for credit applications and negotiations.',
      });
    }
  }
 
  // ── Days-to-pay ───────────────────────────────────────────────────
  const oi = D['qbo-open-invoices'];
  const dtp = oi?.invoices ? daysToPayStats(oi.invoices) : null;
  if (dtp) {
    const slow = oi.customers?.filter(c => c.oldestDays > 90).slice(0, 3) || [];
    if (slow.length) {
      out.push({
        id: 'slow-payers', category: 'cash', severity: 'info',
        title: `${slow.length} customer${slow.length > 1 ? 's have' : ' has'} an invoice 90+ days out`,
        message: `Slowest open: ${slow.map(c => `${c.name} (${c.oldestDays}d)`).join(', ')}.`,
        value: `${slow.length} customers`,
        recommendation: "Construction-Texas note: 'past due' isn't binding — but knowing who pays slow informs how to price future bids and whether to require deposits.",
      });
    }
  }
 
  // ── Cash runway ───────────────────────────────────────────────────
  const runway = cashRunway(D);
  if (runway?.burning) {
    out.push({
      id: 'cash-runway', category: 'cash', severity: runway.runwayMonths < 3 ? 'critical' : 'warning',
      title: `${runway.runwayMonths} months of cash runway`,
      message: `At the current rate of operating burn (${fmt(runway.monthlyBurn)}/month), cash lasts ~${runway.runwayMonths} months.`,
      value: `${runway.runwayMonths}mo`,
      recommendation: runway.runwayMonths < 3 ? 'Immediate action — accelerate AR collection, defer non-essential AP, draw on credit.' : 'Plan a bridge: AR collection push, financing line, or selective cost cuts.',
    });
  } else if (runway && !runway.burning) {
    out.push({
      id: 'cash-positive', category: 'cash', severity: 'positive',
      title: 'Cash flow positive',
      message: `Operating CF is positive — the business is generating cash, not burning it. Latest cash balance: ${fmt(runway.cash)}.`,
      value: 'OK',
      recommendation: '',
    });
  }
 
  // ── Working capital cycle ─────────────────────────────────────────
  const cycle = workingCapitalCycle(D);
  if (cycle?.cycleDays != null) {
    if (cycle.cycleDays > 60) {
      out.push({
        id: 'wc-cycle-long', category: 'cash', severity: cycle.cycleDays > 90 ? 'warning' : 'info',
        title: `${cycle.cycleDays}-day working capital cycle`,
        message: `Customers take ${cycle.dso}d to pay, vendors get paid in ${cycle.dpo}d. SFS is essentially financing ${cycle.cycleDays} days of operations.`,
        value: `${cycle.cycleDays}d`,
        recommendation: 'Negotiate longer vendor terms or shorter customer terms. Each 10 days reduction frees up significant working capital.',
      });
    }
  }
 
  // ── DSCR / SBA readiness ──────────────────────────────────────────
  const ds = dscr(D);
  if (ds?.ratio != null) {
    if (ds.ratio < 1.25) {
      out.push({
        id: 'dscr-low', category: 'loan', severity: ds.ratio < 1.0 ? 'critical' : 'warning',
        title: `DSCR ${ds.ratio}x — below SBA threshold`,
        message: `EBITDA (${fmt(ds.ebitda)}) covers debt service (${fmt(ds.debtService)}) at ${ds.ratio}x. SBA wants ≥1.25x.`,
        value: `${ds.ratio}x`,
        recommendation: 'Either grow EBITDA, restructure debt to lower service, or wait for next cycle to apply.',
      });
    } else {
      out.push({
        id: 'dscr-ok', category: 'loan', severity: 'positive',
        title: `DSCR ${ds.ratio}x — meets SBA threshold`,
        message: `EBITDA covers debt service at ${ds.ratio}x. Lenders typically want ≥1.25x.`,
        value: `${ds.ratio}x`,
        recommendation: '',
      });
    }
  }
 
  // ── Pipeline health ───────────────────────────────────────────────
  const proj = pipelineProjection(D);
  if (proj) {
    out.push({
      id: 'pipeline-projection', category: 'pipeline', severity: 'info',
      title: 'Pipeline → expected revenue',
      message: `${fmt(proj.pendingValue)} in pending bids × ${proj.historicalRate}% historical dollar win rate ≈ ${fmt(proj.expectedWinValue)} expected wins.`,
      value: fmt(proj.expectedWinValue),
      recommendation: 'Use this as a forecast floor for the next 60-90 days of bookings.',
    });
  }
 
  // ── Knowify data quality flag ─────────────────────────────────────
  const k = D['knowify-jobs'];
  if (k?.jobs) {
    const r = applyKnowifyRules(k.jobs);
    const reclassified = r.competitive.reclassifiedStale + r.competitive.reclassifiedUnbilled;
    if (reclassified > 50) {
      out.push({
        id: 'knowify-quality', category: 'data-quality', severity: 'info',
        title: `${reclassified} bids reclassified by SFS rules`,
        message: `${r.competitive.reclassifiedStale} stale (>120d) and ${r.competitive.reclassifiedUnbilled} unbilled-closed bids were reclassified as losses.`,
        value: reclassified,
        recommendation: 'Closing out stale bids in Knowify directly would clean up reports. The reclassification rules will keep working either way.',
      });
    }
  }
 
  // ── Cash flow conversion quality ──────────────────────────────────
  const cfc = cashFlowConversion(D);
  const lastTwoConv = cfc.filter(c => c.conversionPct != null).slice(-2);
  if (lastTwoConv.length === 2 && lastTwoConv.every(c => c.conversionPct < 50)) {
    out.push({
      id: 'cf-conversion-low', category: 'cash', severity: 'info',
      title: 'NI → cash conversion is low',
      message: `Last two years averaged ${((lastTwoConv[0].conversionPct + lastTwoConv[1].conversionPct)/2).toFixed(0)}% — earnings on paper, not in the bank yet.`,
      value: 'low',
      recommendation: 'Usually means AR is growing faster than collections. Push collections, watch DSO.',
    });
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
