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
 * Extract the GC company name from a Knowify job. Per Dylan: in the
 * SFS naming convention, jobs are named "Project - Location - Company"
 * (sometimes just "Project - Company" when location isn't recorded).
 * The LAST hyphen-separated segment is the GC company.
 *
 * Exception: PlanHub jobs keep j.client = "PlanHub" because the actual
 * builder isn't known at bid time (PlanHub is a blind-bid platform).
 *
 * Falls back to j.client if extraction fails.
 */
function extractGCFromJob(j) {
  if (!j) return null;
  // PlanHub stays as PlanHub — the real builder is unknown at bid time.
  const c = (j.client || '').trim();
  if (/^planhub$/i.test(c) || /planhub/i.test(j.name || '')) return 'PlanHub';

  // Try to pull the last " - " segment from the job name.
  const name = (j.name || '').trim();
  if (name) {
    // Split on " - " (with spaces) to avoid splitting hyphenated single words.
    const parts = name.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      // Sanity: last segment shouldn't be a tiny location code like "TX".
      // Treat 2-letter all-caps as a state code, fall back to client.
      if (last.length > 3 && !/^[A-Z]{2,3}$/.test(last)) return last;
    }
  }
  return c || '— Unknown —';
}

/**
 * Apply Dylan's 4 rules + multi-GC annotation. Returns:
 *   { competitive: { jobs, wins, losses, pending, winRate, dollarWinRate, … },
 *     relationship: { jobs, bids, wonCV, wonCount },
 *     multiGC:    { projectCount, bidsInMultiGCProjects, avgGCsPerProject },
 *     byGC:       per-GC breakdown sorted by total bid value,
 *     byLead:     per-Sales-Lead breakdown,
 *     rawCounts:  { Active, Closed, Bidding, Rejected } }
 *
 * GC name is extracted from j.name (last "Project - Location - Company"
 * segment) when possible, falling back to j.client. Aliases are then
 * applied via canonicalGCName so "JPI" merges with "JPI Companies".
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
 
  // Per-GC breakdown.
  // GC NAME EXTRACTION (per Dylan's spec): the actual GC is the last
  // " - " segment of j.name (format: "Project - Location - Company").
  // PlanHub keeps "PlanHub" as the GC because the real builder is
  // unknown at blind-bid time. After extraction, canonicalGCName merges
  // known aliases (e.g. "JPI" + "JPI Companies").
  const byGC = {};
  competitive.forEach(j => {
    const rawGc = extractGCFromJob(j);
    const gc = (typeof canonicalGCName === 'function') ? canonicalGCName(rawGc) : rawGc;
    // Stash the extracted name back on the job for downstream consumers
    // (estimatePaymentDate, classifyGCByOutreach, etc.) that read j.client.
    j._extractedGC = gc;
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
  // Complete years only — comparing partial-year OpEx to a full year
  // would falsely flag every fixed-cost category as "growing as % of
  // revenue" because of seasonal denominator suppression.
  const years = completeYears(D);
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
 * Pipeline → expected revenue projection.
 *
 * CONTEXT.md §2.5 architectural rule: PER-GROUP win rates, not a single
 * blended rate. $1 of Group A pending shouldn't be valued the same as $1
 * of Group C pending. So this prefers `pipelineExpectedByGroup()` for
 * the headline expectedWinValue, falling back to the blended rate only
 * when group classification can't run.
 *
 * `historicalRate` (blended) and `weightedRate` (per-group blended) are
 * both exposed — they should match for a healthy mix; a divergence is
 * itself informative.
 */
function pipelineProjection(D) {
  const knowify = D['knowify-jobs'];
  if (!knowify?.jobs) return null;
  const r = applyKnowifyRules(knowify.jobs);
  if (r.competitive.dollarWinRate == null) return null;

  const byGroup = (typeof pipelineExpectedByGroup === 'function') ? pipelineExpectedByGroup(D) : null;
  const usePerGroup = byGroup && byGroup.totalExpected != null;
  const expectedWinValue = usePerGroup
    ? +byGroup.totalExpected.toFixed(2)
    : +(r.competitive.pendingCV * r.competitive.dollarWinRate / 100).toFixed(2);

  return {
    pendingValue:    r.competitive.pendingCV,
    historicalRate:  r.competitive.dollarWinRate,                     // blended (won$ / decided$)
    weightedRate:    usePerGroup ? byGroup.weightedWinRate : r.competitive.dollarWinRate,
    expectedWinValue,
    pendingBids:     r.competitive.pending,
    rateSource:      usePerGroup ? 'per-group' : 'blended-fallback',
    groupBreakdown:  usePerGroup ? byGroup.groups : null,
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
 * Revenue YoY growth rates across all available years. Each row is
 * tagged with `isComplete` so reports can render partial-year bars
 * differently (greyed, hatched, footnoted) instead of treating a YTD
 * data point as a real annual number. Don't suppress the partial year
 * outright — it's useful to see, just labeled.
 */
function revenueGrowth(D) {
  const all = D['qbo-pl_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  return years.map((y, i) => {
    const rev = all[y].revenue || 0;
    const prior = i > 0 ? (all[years[i - 1]].revenue || 0) : null;
    const status = _yearStatus(D, y);
    return {
      year: y,
      revenue: rev,
      yoyPct: prior ? +(((rev - prior) / prior) * 100).toFixed(1) : null,
      isComplete: status.complete,
      monthsCovered: status.monthsCovered,
      monthName: status.monthName,
    };
  });
}
 
/**
 * Cost line items as % of revenue, year by year. Each year row is
 * tagged isComplete; partial years should not be banded against full-
 * year industry medians (the ratio's denominator is suppressed by
 * seasonality).
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
      const status = _yearStatus(D, y);
      return {
        year: y, amt,
        pctOfRevenue: rev ? +(amt / rev * 100).toFixed(2) : null,
        isComplete: status.complete,
      };
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
  // Use only complete years — comparing 2026-YTD to full 2025 would make
  // every fixed-cost category look like a creep due to seasonality of
  // revenue (the denominator). See CONTEXT.md §2.4.
  const years = completeYears(D);
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
  // Banded against industry medians — ONLY fire on complete-year data.
  // Comparing partial-year (YTD) net margin to a full-year industry
  // median is wrong: TX striping is heavily seasonal (CONTEXT.md §2.4),
  // so YTD revenue is suppressed against fixed OpEx and the ratio looks
  // worse than reality. _latestAnnualPL() already returns the latest
  // *complete* year only.
  const pl = _latestAnnualPL(D);
  if (pl?.netMarginPct != null) {
    const m = pl.netMarginPct;
    const yr = pl._year || '';
    if (m < BANDS.netMargin.weak) {
      out.push({
        id: 'net-margin-weak', category: 'margin', severity: 'warning',
        title: `Net margin ${m.toFixed(1)}% (${yr}) — below industry median`,
        message: `Construction-subcontractor peers run 5-10% net median; top decile >20%. ${yr} (last complete year) landed at ${m.toFixed(1)}%.`,
        value: `${m.toFixed(1)}%`,
        recommendation: 'Two internal levers: bid pricing discipline (industry standard add is 30-40% over cost) and OpEx ratio review (see cost productivity below).',
      });
    } else if (m >= BANDS.netMargin.strong) {
      out.push({
        id: 'net-margin-strong', category: 'margin', severity: 'positive',
        title: `Net margin ${m.toFixed(1)}% (${yr}) — top-quartile`,
        message: `Construction-sub peers median 5-10%. SFS in ${yr} at ${m.toFixed(1)}% is top-quartile.`,
        value: `${m.toFixed(1)}%`, recommendation: '',
      });
    }
  }
 
  // ── 1b. YTD pace (informational — same-period YoY only) ──────────
  // This is the right way to comment on the partial-year slice. Compare
  // CY-YTD to PY same months, NOT to PY full year. No band-vs-industry
  // check here — partial-year ratios aren't comparable to annual medians.
  const ytd = ytdVsPriorSamePeriod(D);
  if (ytd && ytd.yoyRevenuePct != null) {
    const sev = ytd.yoyRevenuePct >= 25 ? 'positive' : ytd.yoyRevenuePct <= -20 ? 'warning' : 'info';
    out.push({
      id: 'ytd-pace', category: 'pace', severity: sev,
      title: `${ytd.year} YTD through ${ytd.monthName}: ${ytd.yoyRevenuePct >= 0 ? '+' : ''}${ytd.yoyRevenuePct}% revenue vs same months ${parseInt(ytd.year,10)-1}`,
      message: `${fmt(ytd.cy.revenue)} CY-to-date vs ${fmt(ytd.py.revenue)} prior-year same months (${ytd.monthsCovered} months). Compared to the prior-year *same-period*, not the prior-year full total — partial-year vs full-year is apples-to-oranges in TX striping (Q1 normally weakest, Q3 normally strongest; see CONTEXT.md §2.4).`,
      value: `${ytd.yoyRevenuePct >= 0 ? '+' : ''}${ytd.yoyRevenuePct}%`,
      recommendation: ytd.yoyRevenuePct < -20 ? 'Don\'t over-react — Q1 is normally the weakest quarter. Re-check after May/June numbers. Same-period comparison is the right frame, not YTD vs PY full-year.' : '',
    });
  }
 
  // ── 2. Gross margin trajectory (pricing power signal) ────────────
  // Multi-year GM trend tells whether SFS is holding pricing or eroding.
  // Use ONLY complete years — a partial-year GM% is distorted by seasonal
  // revenue against fixed costs.
  const all = D['qbo-pl_all'] || {};
  const cYrs = completeYears(D);
  if (cYrs.length >= 3) {
    const recent = cYrs.slice(-3).map(y => all[y].grossMarginPct).filter(v => v != null);
    if (recent.length >= 3) {
      const drop = recent[0] - recent[recent.length - 1];
      if (drop > 5) {
        out.push({
          id: 'gm-erosion', category: 'margin', severity: 'warning',
          title: `Gross margin compressed ${drop.toFixed(1)}pp over 3 complete years`,
          message: `${cYrs[cYrs.length-3]}: ${recent[0]}% → ${cYrs[cYrs.length-1]}: ${recent[recent.length-1]}%. Either bid prices haven't kept up with COGS, or the job mix has shifted toward lower-margin work. (Comparison uses complete years only.)`,
          value: `-${drop.toFixed(1)}pp`,
          recommendation: 'Worth a bid-pricing audit on the next 5-10 jobs: what % was added over estimated cost?',
        });
      } else if (drop < -5) {
        out.push({
          id: 'gm-expansion', category: 'margin', severity: 'positive',
          title: `Gross margin expanded ${Math.abs(drop).toFixed(1)}pp over 3 complete years`,
          message: `${cYrs[cYrs.length-3]}: ${recent[0]}% → ${cYrs[cYrs.length-1]}: ${recent[recent.length-1]}%. Pricing or mix improvement is working.`,
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
  // BOTH years used here must be complete — labor ratios are seasonal,
  // so a YTD-vs-full-year compare would falsely show "lower leverage."
  if (pl?.revenue && cYrs.length >= 2) {
    const wagesCogs = (pl.cogs || {})['Wages_COGS_'] || (pl.cogs || {})['Wages(COGS)'] || 0;
    const salariesOpex = (pl.opex || {})['Salaries___Wages'] || (pl.opex || {})['Salaries & Wages'] || 0;
    const totalLabor = wagesCogs + salariesOpex;
    if (totalLabor > 0) {
      const revPerLabor = pl.revenue / totalLabor;
      // Step back one COMPLETE year (cYrs already excludes the partial
      // current year) — this was previously comparing latest-complete to
      // itself when a partial year existed in qbo-pl_all.
      const priorYr = cYrs[cYrs.length - 2];
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
            ? `Each labor $ producing ${deltaPct.toFixed(0)}% more revenue (${pl._year} vs ${priorYr})`
            : `Each labor $ producing ${Math.abs(deltaPct).toFixed(0)}% less revenue (${pl._year} vs ${priorYr})`,
          message: `${pl._year}: $${revPerLabor.toFixed(2)} of revenue per $1 of labor (Wages COGS + Salaries). ${priorYr}: $${priorRevPerLabor.toFixed(2)}. Comparison uses complete years only.`,
          value: `$${revPerLabor.toFixed(2)}/$1`,
          recommendation: deltaPct > 0
            ? ''
            : 'Lower labor leverage usually means: hired ahead of demand, or work mix shifted toward lower-revenue jobs per crew-hour. Check capacity utilization next.',
        });
      }
    }
  }
 
  // (Insight 5 was an older seasonal-pace based on sales-by-customer
  // monthly data; the new YTD-pace insight at §1b above replaces it
  // using the higher-precision monthly P&L feed. Don't double-report.)
 
  // ── 6. Pipeline forecast (forward visibility — operational) ──────
  const proj = pipelineProjection(D);
  if (proj) {
    const rateLabel = proj.rateSource === 'per-group'
      ? `${proj.weightedRate}% weighted $-win rate (per-group A/B/C, not blended)`
      : `${proj.historicalRate}% blended $-win rate`;
    out.push({
      id: 'pipeline-forecast', category: 'pipeline', severity: 'info',
      title: 'Forward booking floor from current pipeline',
      message: `${fmt(proj.pendingValue)} in pending bids × ${rateLabel} = ${fmt(proj.expectedWinValue)} expected wins.`,
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
 
// ─────────────────────────────────────────────────────────────────────────
// PARTIAL-YEAR HELPERS (CONTEXT.md §2.4 — TX striping is heavily seasonal,
// so any YTD-vs-full-year comparison or industry-band check on partial-year
// data is wrong. These helpers let metrics distinguish complete years from
// the current YTD slice and only band complete years against industry
// medians.)
// ─────────────────────────────────────────────────────────────────────────
 
/**
 * Detect whether a year is complete based on the monthly P&L feed.
 * If qbo-pl-monthly's meta.year matches and only N of 12 months have
 * non-zero revenue, the year is partial (N months covered).
 *
 * Returns: { complete:true, monthsCovered:12 } for any non-current year,
 * or { complete:false, monthsCovered:N, monthName:'April' } for the
 * current year if monthly data shows < 12 months populated.
 */
function _yearStatus(D, yearKey) {
  if (!yearKey) return { complete: false, monthsCovered: 0 };
  const monthly = D?.['qbo-pl-monthly'];
  // If the monthly feed doesn't match this year, treat as complete (best
  // we can do — fall back to "assume complete" rather than over-flagging).
  if (!monthly?.meta?.year || String(monthly.meta.year) !== String(yearKey)) {
    return { complete: true, monthsCovered: 12, year: yearKey };
  }
  const months = monthly.revenue?.months || [];
  const headers = monthly.meta.monthHeaders || [];
  // Count months with any signal (revenue OR cost) — defensive against a
  // weird month with $0 revenue but real expenses.
  const cogsM = monthly.cogs?.months || [];
  const opexM = monthly.opex?.months || [];
  let lastIdx = -1;
  for (let i = 0; i < 12; i++) {
    const r = months[i] || 0, c = cogsM[i] || 0, o = opexM[i] || 0;
    if (r !== 0 || c !== 0 || o !== 0) lastIdx = i;
  }
  const covered = lastIdx + 1;
  return {
    complete: covered === 12,
    monthsCovered: covered,
    monthName: covered > 0 ? (headers[lastIdx] || `M${covered}`) : null,
    year: yearKey,
  };
}
 
/**
 * Returns the sorted year keys for which the year is complete (≥ 12
 * months covered). The current calendar year is excluded if it shows
 * < 12 months in qbo-pl-monthly. Use this anywhere you would compute
 * margin trajectories, OpEx % trends, or labor leverage YoY — those
 * comparisons all break on partial-year data.
 */
function completeYears(D) {
  const all = D?.['qbo-pl_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  return years.filter(y => _yearStatus(D, y).complete);
}
 
/**
 * Returns whichever year keys exist in qbo-pl_all, paired with their
 * status. Lets reports differentiate complete bars from partial ones
 * in charts (greying or footnoting).
 */
function yearStatusList(D) {
  const all = D?.['qbo-pl_all'] || {};
  const years = Object.keys(all).filter(k => /^\d{4}$/.test(k)).sort();
  return years.map(y => Object.assign({}, _yearStatus(D, y), { year: y }));
}
 
/**
 * Helper used by several metrics — get the latest *complete* annual P&L
 * (never YTD). If the current year's qbo-pl-monthly shows < 12 months
 * covered, that year is skipped. Returns null if no complete year
 * exists (very fresh accounts).
 *
 * The returned object is the qbo-pl_all entry as-is, plus a non-
 * enumerable `_year` property for callers that need to know which
 * year they got.
 */
function _latestAnnualPL(D) {
  const all = D?.['qbo-pl_all'] || {};
  const cYrs = completeYears(D);
  if (cYrs.length === 0) return null;
  const yr = cYrs[cYrs.length - 1];
  const out = Object.assign({}, all[yr]);
  Object.defineProperty(out, '_year', { value: yr, enumerable: false });
  return out;
}
 
/**
 * YTD-versus-prior-year-same-period — the right way to compare partial-
 * year data. Sums the current YTD revenue/cogs/opex from qbo-pl-monthly
 * and the SAME number of months from the prior year (using qbo-sales
 * monthlyByYear for revenue and qbo-pl-monthly for the current year
 * comparison). Returns null if we don't have enough data to do the
 * comparison fairly.
 *
 * Output: {
 *   year, monthsCovered, monthName,                        // e.g. 'April'
 *   cy: { revenue, cogs?, opex?, grossMarginPct?, netMarginPct? },
 *   py: { revenue, … same shape, but ONLY the same N months },
 *   yoyRevenuePct,                                          // %
 * }
 *
 * IMPORTANT: For ratio metrics like gross margin %, only revenue
 * comparisons (which we have at month-grain in qbo-sales monthlyByYear)
 * are reliable. Cost categories may not be available month-by-month for
 * prior years, in which case those fields are null — DO NOT fall back
 * to PY-full-year for those, as that's the bug this helper exists to
 * prevent.
 */
function ytdVsPriorSamePeriod(D) {
  const monthly = D?.['qbo-pl-monthly'];
  const monthlyByYear = D?.['qbo-sales']?.monthlyByYear;
  if (!monthly?.meta?.year || !monthly?.revenue?.months) return null;
 
  const year = String(monthly.meta.year);
  const status = _yearStatus(D, year);
  if (!status.monthsCovered) return null;
 
  const N = status.monthsCovered;
  const monthsCY = monthly.revenue.months.slice(0, N);
  const cogsCY   = (monthly.cogs?.months || []).slice(0, N);
  const opexCY   = (monthly.opex?.months || []).slice(0, N);
  const sum = arr => arr.reduce((s, v) => s + (v || 0), 0);
 
  const cyRev  = sum(monthsCY);
  const cyCogs = sum(cogsCY);
  const cyOpex = sum(opexCY);
 
  const cy = {
    revenue: cyRev,
    cogs:    cyCogs,
    opex:    cyOpex,
    grossMarginPct: cyRev ? +((cyRev - cyCogs) / cyRev * 100).toFixed(2) : null,
    netMarginPct:   cyRev ? +((cyRev - cyCogs - cyOpex) / cyRev * 100).toFixed(2) : null,
  };
 
  // Build PY-same-period from monthlyByYear (revenue only — that's what
  // qbo-sales gives us). PY cost data at month-grain isn't available, so
  // grossMarginPct/netMarginPct on the PY side are intentionally null.
  let py = null, yoyRevenuePct = null;
  const priorYear = String(parseInt(year, 10) - 1);
  const priorRow = monthlyByYear?.[priorYear];
  if (priorRow && priorRow.length >= N) {
    const pyRev = sum(priorRow.slice(0, N));
    py = { revenue: pyRev, grossMarginPct: null, netMarginPct: null };
    yoyRevenuePct = pyRev ? +(((cyRev - pyRev) / pyRev) * 100).toFixed(1) : null;
  }
 
  return {
    year,
    monthsCovered: N,
    monthName: status.monthName,
    cy, py, yoyRevenuePct,
  };
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


// ════════════════════════════════════════════════════════════════════════
// SECTION 8 ─ DSO + COLLECTIONS FORECAST (auto-computed from qbo-transactions)
// ════════════════════════════════════════════════════════════════════════
//
// Per-client Days Sales Outstanding computed automatically by walking the
// AR account in qbo-transactions, separating Invoice rows from Payment
// rows, FIFO-matching them per customer. No manual XLSX upload needed.
//
// Resolution order for dsoForClient(D, name):
//   1. computeDSOFromTransactions(D)   — live, auto-computed
//   2. window.DSO_REFERENCE_FALLBACK   — static baseline in core/dso-reference.js
//
// CONTEXT.md §8.0 reminder: SFS does NOT control when AR pays. These
// helpers are forecast / planning inputs — never "chase customer X" alarms.

let _dsoComputedCache = null;
let _dsoComputedKey   = null;

function computeDSOFromTransactions(D) {
  const txn = D?.['qbo-transactions'];
  if (!txn?.accountDetail) return null;

  const cacheKey = txn.meta?.mergedAt || txn.meta?.parsedAt || '';
  if (_dsoComputedKey === cacheKey && _dsoComputedCache) return _dsoComputedCache;

  // Find the AR account — match the parser's isAR flag, then by name pattern.
  let arInfo = null;
  for (const [name, info] of Object.entries(txn.accountDetail)) {
    if (info.isAR || /accounts\s*receivable/i.test(name) || /\ba\/?r\b/i.test(name)) {
      arInfo = info; break;
    }
  }
  if (!arInfo?.items?.length) return null;

  const norm = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const byCustomer = {};
  for (const it of arInfo.items) {
    if (!it.name || !it.date) continue;
    const date = new Date(it.date);
    if (isNaN(date)) continue;
    const k = norm(it.name);
    if (!byCustomer[k]) byCustomer[k] = { name: it.name, invoices: [], payments: [] };
    const t = (it.type || '').toLowerCase();
    if (it.amount > 0 && /invoice/.test(t))                byCustomer[k].invoices.push({ date, amount: it.amount, raw: it });
    else if (it.amount < 0 && /(payment|deposit)/.test(t)) byCustomer[k].payments.push({ date, amount: -it.amount, raw: it });
    else if (it.amount > 0)                                byCustomer[k].invoices.push({ date, amount: it.amount, raw: it });
    else if (it.amount < 0)                                byCustomer[k].payments.push({ date, amount: -it.amount, raw: it });
  }

  const percentile = (sorted, p) => {
    if (!sorted.length) return null;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)));
    return sorted[i];
  };
  const clients = [];
  let earliestDate = null, latestDate = null, totalPaidGlobal = 0;
  for (const [k, c] of Object.entries(byCustomer)) {
    if (!c.invoices.length) continue;
    c.invoices.sort((a, b) => a.date - b.date);
    c.payments.sort((a, b) => a.date - b.date);
    const invQueue = c.invoices.map(inv => ({
      invDate: inv.date, original: inv.amount, remaining: inv.amount, firstPaymentDate: null,
    }));
    let pIdx = 0;
    for (let i = 0; i < invQueue.length && pIdx < c.payments.length; i++) {
      const inv = invQueue[i];
      while (inv.remaining > 0.005 && pIdx < c.payments.length) {
        const pay = c.payments[pIdx];
        if (pay.amount <= 0.005) { pIdx++; continue; }
        const apply = Math.min(inv.remaining, pay.amount);
        inv.remaining -= apply;
        pay.amount -= apply;
        if (!inv.firstPaymentDate) inv.firstPaymentDate = pay.date;
        if (pay.amount <= 0.005) pIdx++;
      }
    }
    const dsos = [];
    let paidTotal = 0;
    invQueue.forEach(inv => {
      if (inv.remaining < 0.01 && inv.firstPaymentDate) {
        const days = Math.max(0, Math.round((inv.firstPaymentDate - inv.invDate) / 86400000));
        dsos.push(days);
        paidTotal += inv.original;
        if (!earliestDate || inv.invDate < earliestDate) earliestDate = inv.invDate;
        if (!latestDate || inv.firstPaymentDate > latestDate) latestDate = inv.firstPaymentDate;
      }
    });
    if (!dsos.length) continue;
    dsos.sort((a, b) => a - b);
    const sum = dsos.reduce((s, v) => s + v, 0);
    const mean = +(sum / dsos.length).toFixed(2);
    const variance = dsos.reduce((s, v) => s + (v - mean) ** 2, 0) / dsos.length;
    const std = +Math.sqrt(variance).toFixed(1);
    const pct = (n) => +(dsos.filter(d => d <= n).length / dsos.length).toFixed(2);
    const pctOver = (n) => +(dsos.filter(d => d > n).length / dsos.length).toFixed(2);
    totalPaidGlobal += paidTotal;
    clients.push({
      client: c.name, nPaid: dsos.length, meanDSO: mean,
      medianDSO: percentile(dsos, 0.5), p75DSO: percentile(dsos, 0.75), p90DSO: percentile(dsos, 0.9),
      maxDSO: dsos[dsos.length - 1],
      pctPaid30d: pct(30), pctPaid60d: pct(60), pctPaid90d: pct(90), pctPaidOver120d: pctOver(120),
      stdDevDSO: std, totalPaid: +paidTotal.toFixed(2),
    });
  }
  if (!clients.length) return null;
  clients.sort((a, b) => (b.totalPaid || 0) - (a.totalPaid || 0));

  let dsoSum = 0, dsoWt = 0;
  clients.forEach(c => {
    if (c.medianDSO != null && c.nPaid) { dsoSum += c.medianDSO * c.nPaid; dsoWt += c.nPaid; }
  });
  const portfolioMedianDSO = dsoWt > 0 ? +(dsoSum / dsoWt).toFixed(1) : null;
  const totalInvoices = clients.reduce((s, c) => s + c.nPaid, 0);
  const byNorm = {};
  clients.forEach(c => { byNorm[norm(c.client)] = c; });

  const result = {
    summary: {
      clientCount: clients.length, totalInvoices, totalPaid: +totalPaidGlobal.toFixed(2),
      portfolioMedianDSO,
      clientsWith3Plus:  clients.filter(c => c.nPaid >= 3).length,
      clientsWith5Plus:  clients.filter(c => c.nPaid >= 5).length,
      clientsWith10Plus: clients.filter(c => c.nPaid >= 10).length,
    },
    clients, byNorm, source: 'computed-from-transactions',
    coverage: {
      firstDate: earliestDate ? earliestDate.toISOString().slice(0, 10) : null,
      lastDate:  latestDate   ? latestDate.toISOString().slice(0, 10)   : null,
      paidInvoiceCount: totalInvoices,
    },
  };
  _dsoComputedCache = result;
  _dsoComputedKey = cacheKey;
  return result;
}

function dsoForClient(D, clientName) {
  if (!clientName) return null;
  const norm = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const key = norm(clientName);
  const computed = computeDSOFromTransactions(D);
  if (computed?.byNorm?.[key]) return { ...computed.byNorm[key], source: 'computed-from-transactions' };
  if (typeof window !== 'undefined' && window.DSO_REFERENCE_FALLBACK?.byNorm?.[key]) {
    return { ...window.DSO_REFERENCE_FALLBACK.byNorm[key], source: 'static-baseline' };
  }
  return null;
}

function dsoPortfolioSummary(D) {
  const computed = computeDSOFromTransactions(D);
  if (computed?.summary?.portfolioMedianDSO != null) return { ...computed.summary, source: 'computed-from-transactions' };
  if (typeof window !== 'undefined' && window.DSO_REFERENCE_FALLBACK?.summary) {
    return { ...window.DSO_REFERENCE_FALLBACK.summary, source: 'static-baseline' };
  }
  return null;
}

function estimatePaymentDate(invoice, D) {
  // qbo-open-invoices stores invoice date under `inv.date`. Accept several
  // shapes defensively so this still works if the parser changes.
  const dateStr = invoice?.date || invoice?.invoiceDate || invoice?.txnDate || invoice?.transactionDate;
  if (!dateStr) return null;
  const MIN_SAMPLE = 3;
  const today = new Date();
  const inv = new Date(dateStr);
  if (isNaN(inv)) return null;
  const daysOpen = Math.max(0, Math.floor((today - inv) / 86400000));
  const customer = invoice.customer || invoice.client || invoice.name;

  let expected = null, p75 = null, p90 = null;
  let confidence = 'unknown', nPaid = 0;
  const stats = dsoForClient(D, customer);
  if (stats && stats.medianDSO != null && stats.nPaid >= MIN_SAMPLE) {
    expected = stats.medianDSO;
    p75 = stats.p75DSO ?? Math.round(expected * 1.3);
    p90 = stats.p90DSO ?? Math.round(expected * 1.6);
    confidence = 'client-history'; nPaid = stats.nPaid;
  } else if (stats && stats.medianDSO != null) {
    const port = dsoPortfolioSummary(D);
    const portMedian = port?.portfolioMedianDSO || 60;
    expected = +((stats.medianDSO + portMedian) / 2).toFixed(0);
    p75 = stats.p75DSO ?? Math.round(expected * 1.3);
    p90 = stats.p90DSO ?? Math.round(expected * 1.6);
    confidence = 'low-sample'; nPaid = stats.nPaid;
  } else {
    const port = dsoPortfolioSummary(D);
    if (port?.portfolioMedianDSO != null) {
      expected = port.portfolioMedianDSO;
      p75 = Math.round(expected * 1.4);
      p90 = Math.round(expected * 1.8);
      confidence = 'portfolio-fallback';
    }
  }
  if (expected == null) return null;
  const addDays = (date, days) => new Date(date.getTime() + days * 86400000).toISOString().slice(0, 10);
  const remainingDays = expected - daysOpen;
  return {
    invoiceDate: dateStr, customer,
    amount: invoice.openBalance ?? invoice.amount ?? null,
    daysOpen, expectedDaysToPay: expected, p75DaysToPay: p75, p90DaysToPay: p90,
    remainingDays,
    expectedPayDate: addDays(inv, expected),
    p75PayDate: addDays(inv, p75), p90PayDate: addDays(inv, p90),
    confidence, nPaid, isLate: remainingDays < 0,
  };
}

function forecastCollections(D) {
  const oi = D?.['qbo-open-invoices'];
  const invoices = oi?.invoices || [];
  if (!invoices.length) return null;
  const buckets = [
    { label: '0–30 days',   days: [0, 30],   amount: 0, count: 0, items: [] },
    { label: '31–60 days',  days: [31, 60],  amount: 0, count: 0, items: [] },
    { label: '61–90 days',  days: [61, 90],  amount: 0, count: 0, items: [] },
    { label: '91–120 days', days: [91, 120], amount: 0, count: 0, items: [] },
    { label: '120+ days',   days: [121, Infinity], amount: 0, count: 0, items: [] },
    { label: 'No estimate', days: [null, null], amount: 0, count: 0, items: [] },
  ];
  const confDollar = { 'client-history': 0, 'low-sample': 0, 'portfolio-fallback': 0, unknown: 0 };
  let totalOpen = 0;
  const all = [];
  for (const inv of invoices) {
    const est = estimatePaymentDate(inv, D);
    const amount = inv.openBalance || 0;
    totalOpen += amount;
    if (!est) {
      buckets[5].amount += amount; buckets[5].count++; buckets[5].items.push({ inv, est: null });
      confDollar.unknown += amount; all.push({ inv, est: null, sortKey: 99999 }); continue;
    }
    confDollar[est.confidence] = (confDollar[est.confidence] || 0) + amount;
    const remaining = Math.max(0, est.remainingDays);
    let i = 0;
    if (remaining > 30 && remaining <= 60) i = 1;
    else if (remaining > 60 && remaining <= 90) i = 2;
    else if (remaining > 90 && remaining <= 120) i = 3;
    else if (remaining > 120) i = 4;
    buckets[i].amount += amount; buckets[i].count++;
    buckets[i].items.push({ inv, est });
    all.push({ inv, est, sortKey: est.remainingDays });
  }
  buckets.forEach(b => { b.amount = +b.amount.toFixed(2); });
  all.sort((a, b) => a.sortKey - b.sortKey);
  return {
    asOf: oi?.meta?.parsedAt || new Date().toISOString(),
    totalOpen: +totalOpen.toFixed(2), invoiceCount: invoices.length, buckets,
    topExpectedSoonest: all.slice(0, 25),
    confidenceBreakdown: {
      clientHistory:     +confDollar['client-history'].toFixed(2),
      lowSample:         +confDollar['low-sample'].toFixed(2),
      portfolioFallback: +confDollar['portfolio-fallback'].toFixed(2),
      unknown:           +confDollar.unknown.toFixed(2),
    },
  };
}


// ════════════════════════════════════════════════════════════════════════
// SECTION 9 ─ UNIFIED FORECASTS (AR ↔ Pipeline ↔ Financial — interact)
// ════════════════════════════════════════════════════════════════════════
//
// Three forecast surfaces that need to talk to each other:
//   1. AR collections forecast  — open invoices × per-client DSO → cash
//      inflow timeline by 30/60/90/120-day bucket. Source: forecastCollections()
//   2. Pipeline-to-revenue      — pending Knowify bids × historical $-win
//      rate × bid-to-invoice lag → expected new revenue / new AR.
//   3. Financial projection     — extrapolate next 12 months of revenue and
//      OpEx using prior-year same-month shape × current-year YTD pace.
//
// The unified cash-inflow forecast combines (1) + (2): AR already on the
// books that will land soon, plus pipeline wins that will become AR and
// then cash with a typical lag. Financial projection (3) is the bigger-
// picture P&L view shown alongside as a sanity check.
//
// CONTEXT.md §8.0 reminder: these are *forecasts* — planning inputs.
// Don't generate "raise these collections" or "chase these bids" alarms.

/**
 * Median lag in days between a Knowify pipeline event and revenue
 * landing in QBO. Approximated from job-creation dates of completed
 * (Active or Closed-with-revenue) bids, since Knowify doesn't separately
 * record award/invoice dates.
 *
 * Falls back to 60 days (a reasonable industry default for commercial
 * subcontractors) if there's not enough data.
 */
/**
 * Per-group win rates from current Knowify data. Returns a map keyed by
 * outreach group ('A', 'B', 'C-STOP', 'C-PUB', 'C-MIX', 'CHAIN',
 * 'UNCLASSIFIED', 'DATA-ARTIFACT') with each group's bid count, wins,
 * losses, pending, won/lost contract value, and $-weighted win rate.
 *
 * Per-group rates are MUCH more accurate than the single blended rate
 * because Group A (>=70% historical win), Group B (30-69%), and the
 * Group C subgroups (~0% historical) have wildly different conversion
 * probabilities. Use these instead of one global rate.
 *
 * Output:
 *   {
 *     A: { bids, wins, losses, pending, wonCV, lostCV, pendingCV, dollarWinRate, sampleSize },
 *     B: {...}, 'C-STOP': {...}, 'C-PUB': {...}, 'C-MIX': {...},
 *     CHAIN: {...}, UNCLASSIFIED: {...},
 *   }
 */
function groupWinRates(D) {
  const knowify = D?.['knowify-jobs'];
  if (!knowify?.jobs) return null;
  const R = applyKnowifyRules(knowify.jobs);
  const out = {
    A:                { bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0, dollarWinRate: null, sampleSize: 0 },
    B:                { bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0, dollarWinRate: null, sampleSize: 0 },
   'C-STOP':          { bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0, dollarWinRate: null, sampleSize: 0 },
   'C-PUB':           { bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0, dollarWinRate: null, sampleSize: 0 },
   'C-MIX':           { bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0, dollarWinRate: null, sampleSize: 0 },
    CHAIN:            { bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0, dollarWinRate: null, sampleSize: 0 },
    UNCLASSIFIED:     { bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0, dollarWinRate: null, sampleSize: 0 },
   'DATA-ARTIFACT':   { bids: 0, wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, pendingCV: 0, dollarWinRate: null, sampleSize: 0 },
  };
  R.byGC.forEach(g => {
    const c = (typeof classifyGCByOutreach === 'function')
      ? classifyGCByOutreach(g.gc, R.byGC)
      : { group: 'UNCLASSIFIED' };
    const bucket = out[c.group] || out.UNCLASSIFIED;
    bucket.bids       += g.bids || 0;
    bucket.wins       += g.wins || 0;
    bucket.losses     += g.losses || 0;
    bucket.pending    += g.pending || 0;
    bucket.wonCV      += g.wonCV || 0;
    bucket.lostCV     += g.lostCV || 0;
    bucket.pendingCV  += g.pendingCV || 0;
  });
  Object.values(out).forEach(b => {
    const decidedCV = b.wonCV + b.lostCV;
    b.dollarWinRate = decidedCV > 0 ? +(b.wonCV / decidedCV * 100).toFixed(1) : null;
    b.sampleSize = b.wins + b.losses;
    b.wonCV     = +b.wonCV.toFixed(2);
    b.lostCV    = +b.lostCV.toFixed(2);
    b.pendingCV = +b.pendingCV.toFixed(2);
  });
  return out;
}


/**
 * Pipeline expected wins computed PER GROUP.
 * For each group: pendingCV × that group's $-win rate. Falls back to the
 * global $-win rate for groups with insufficient sample (< 5 decided).
 * PlanHub is discounted because its 0% win rate is a Knowify artifact.
 */
function pipelineExpectedByGroup(D) {
  const groups = groupWinRates(D);
  if (!groups) return null;
  const knowify = D?.['knowify-jobs'];
  const R = knowify?.jobs ? applyKnowifyRules(knowify.jobs) : null;
  const fallbackRate = R?.competitive?.dollarWinRate || 0;
  const result = { groups: {}, totalPending: 0, totalExpected: 0, weightedWinRate: null };
  Object.entries(groups).forEach(([key, g]) => {
    if (g.pendingCV <= 0) return;
    let rate = g.dollarWinRate;
    let source = 'group';
    if (key === 'DATA-ARTIFACT') {
      rate = fallbackRate * 0.5;
      source = 'data-artifact-discounted';
    } else if (rate == null || g.sampleSize < 5) {
      rate = fallbackRate;
      source = 'low-sample-fallback';
    }
    const expected = g.pendingCV * (rate || 0) / 100;
    result.groups[key] = {
      pendingCV: g.pendingCV, pendingCount: g.pending,
      winRate: rate, sampleSize: g.sampleSize,
      expectedValue: +expected.toFixed(2), source,
    };
    result.totalPending  += g.pendingCV;
    result.totalExpected += expected;
  });
  result.totalPending   = +result.totalPending.toFixed(2);
  result.totalExpected  = +result.totalExpected.toFixed(2);
  result.weightedWinRate = result.totalPending > 0
    ? +(result.totalExpected / result.totalPending * 100).toFixed(1)
    : null;
  result.blendedWinRate = fallbackRate;
  return result;
}

/**
 * Median lag in days between a Knowify pipeline event and revenue
 * landing in QBO. Falls back to 60 days if there's not enough data.
 */
function bidToRevenueLagDays(D) {
  if (typeof pipelineVelocity === 'function') {
    const v = pipelineVelocity(D);
    if (v?.medianDays && v.sample >= 5) return v.medianDays;
  }
  return 60;
}

/**
 * Unified cash-inflow forecast — keeps AR (precise, near-term) and
 * Pipeline (probability-weighted, lower confidence) DELIBERATELY SEPARATE.
 *
 * Stacking $500K of real-soon AR with $2M of probability-weighted pipeline
 * 120+ days out makes the AR look small; they're different kinds of
 * numbers and shouldn't be summed in the same chart.
 */
function unifiedCashInflowForecast(D) {
  const ar = forecastCollections(D);
  const groupExpected = (typeof pipelineExpectedByGroup === 'function') ? pipelineExpectedByGroup(D) : null;
  const port = dsoPortfolioSummary(D);
  const lagDays = bidToRevenueLagDays(D);
  const dsoDays = port?.portfolioMedianDSO || 60;
  const pipelineExpectedDays = lagDays + dsoDays;

  const arBuckets = [
    { label: '0–30 days',   days: [0, 30],   amount: 0, count: 0 },
    { label: '31–60 days',  days: [31, 60],  amount: 0, count: 0 },
    { label: '61–90 days',  days: [61, 90],  amount: 0, count: 0 },
    { label: '91–120 days', days: [91, 120], amount: 0, count: 0 },
    { label: '120+ days',   days: [121, Infinity], amount: 0, count: 0 },
  ];
  if (ar?.buckets) {
    ar.buckets.forEach(b => {
      const t = arBuckets.find(x => x.label === b.label);
      if (t) { t.amount += b.amount || 0; t.count += b.count || 0; }
    });
  }
  arBuckets.forEach(b => { b.amount = +b.amount.toFixed(2); });

  return {
    asOf: new Date().toISOString(),
    arBuckets,
    arTotal: ar?.totalOpen || 0,
    arInvoiceCount: ar?.invoiceCount || 0,
    pipelineByGroup: groupExpected?.groups || {},
    pipelineTotal: groupExpected?.totalExpected || 0,
    pipelinePending: groupExpected?.totalPending || 0,
    weightedWinRate: groupExpected?.weightedWinRate ?? null,
    blendedWinRate:  groupExpected?.blendedWinRate ?? null,
    timing: { lagDays, dsoDays, expectedCashLanding: pipelineExpectedDays },
  };
}

/**
 * 12-month financial projection. Prior-year monthly shape × current YoY
 * pace ratio. Holds OpEx at last-complete-year monthly average and
 * gross margin at last-year actual.
 */
function financialProjection(D) {
  const monthly = D?.['qbo-pl-monthly'];
  const monthlyByYear = D?.['qbo-sales']?.monthlyByYear;
  const all = D?.['qbo-pl_all'] || {};
  const completePL = (typeof _latestAnnualPL === 'function') ? _latestAnnualPL(D) : null;
  if (!completePL || !monthlyByYear) return null;
  const baseYear = parseInt(completePL._year, 10);
  const baseMonths = monthlyByYear[String(baseYear)];
  if (!baseMonths || baseMonths.length < 12) return null;

  let paceRatio = 1.0;
  const ytd = (typeof ytdVsPriorSamePeriod === 'function') ? ytdVsPriorSamePeriod(D) : null;
  if (ytd?.cy?.revenue && ytd?.py?.revenue) paceRatio = ytd.cy.revenue / ytd.py.revenue;

  const opexMonthly = (completePL.opexTotal || 0) / 12;
  const gmPct = completePL.grossMarginPct != null ? completePL.grossMarginPct / 100 : 0.35;

  const today = new Date();
  const startYr = today.getFullYear();
  const startMo = today.getMonth();
  const months = [];
  let totalRev = 0, totalGP = 0, totalOpEx = 0, totalNI = 0;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = 0; i < 12; i++) {
    const moIdx = (startMo + i) % 12;
    const yr = startYr + Math.floor((startMo + i) / 12);
    const baseRev = baseMonths[moIdx] || 0;
    const projRev = +(baseRev * paceRatio).toFixed(2);
    const cogs = +(projRev * (1 - gmPct)).toFixed(2);
    const gp = +(projRev - cogs).toFixed(2);
    const ni = +(gp - opexMonthly).toFixed(2);
    months.push({
      year: yr, month: moIdx + 1, label: `${monthNames[moIdx]} ${yr}`,
      revenue: projRev, cogs, grossProfit: gp, opex: +opexMonthly.toFixed(2),
      netIncome: ni,
      source: `${baseYear} ${monthNames[moIdx]} × ${paceRatio.toFixed(2)} pace`,
    });
    totalRev += projRev; totalGP += gp; totalOpEx += opexMonthly; totalNI += ni;
  }

  return {
    months,
    assumptions: {
      yoyPaceRatio: +paceRatio.toFixed(3),
      gmPct: +(gmPct * 100).toFixed(1),
      opexMonthly: +opexMonthly.toFixed(2),
      baseYear,
      sourceNotes: [
        `Revenue shape from ${baseYear} monthly; scaled by ${(paceRatio*100-100).toFixed(1)}% YoY pace.`,
        `Gross margin held at ${(gmPct*100).toFixed(1)}% (${baseYear} actual).`,
        `OpEx held at ${baseYear} monthly average ($${Math.round(opexMonthly).toLocaleString()}/mo).`,
        'Model is intentionally simple — does not anticipate hiring shifts, equipment purchases, or rate changes.',
      ],
    },
    summary: {
      totalRevenue: +totalRev.toFixed(2),
      totalGP:      +totalGP.toFixed(2),
      totalOpEx:    +totalOpEx.toFixed(2),
      totalNI:      +totalNI.toFixed(2),
    },
  };
}


// ════════════════════════════════════════════════════════════════════════
// SECTION 10 ─ FULL P&L FORECAST MODEL (in-year + next-12-month)
// ════════════════════════════════════════════════════════════════════════
//
// Builds an income-statement-shape monthly forecast that blends:
//   • Actual months (from qbo-pl-monthly) where data exists.
//   • Projected months using prior-year same-month shape × YoY pace.
//   • COGS as a variable cost — scales with projected revenue (1 - GM%).
//   • OpEx split into FIXED and VARIABLE buckets (by category keyword):
//       FIXED   = rent, insurance, salaries, utilities, software, depreciation, etc.
//       VARIABLE = fuel, vehicle, materials, subcontractors, supplies, etc.
//     Fixed projects flat (last-year monthly avg). Variable scales with revenue.
//
// Two views:
//   inYearForecast(D)        — Jan→Dec of CURRENT calendar year (actuals + projected).
//   next12MonthsForecast(D)  — rolling 12 months from current month forward.
//
// CONTEXT.md §8.0 reminder: this is a planning model, not a target. Don't
// generate "you're behind plan" alarms from it — variances are expected.

const FIXED_COST_KEYWORDS = [
  'rent','lease','insurance','salar','payroll tax','office','utility','utilit',
  'phone','internet','software','subscription','depreciation','amortization',
  'interest','bank fee','bank charge','professional','legal','accounting',
  'license','permit','membership','dues','marketing','advertis','training',
  'cleaning','janitorial',
];
const VARIABLE_COST_KEYWORDS = [
  'material','supplies','fuel','gas','vehicle','truck','auto','equipment rental',
  'tools','subcontract','commission','job','paint','parts','shipping','postage',
  'travel','meal','lodging','freight',
];

function _classifyOpExCategory(name) {
  if (!name) return 'fixed';
  const n = name.toLowerCase();
  for (const kw of VARIABLE_COST_KEYWORDS) if (n.includes(kw)) return 'variable';
  for (const kw of FIXED_COST_KEYWORDS)    if (n.includes(kw)) return 'fixed';
  // Default to fixed — most of the SFS OpEx tail (admin, office, etc.) is fixed.
  return 'fixed';
}

/**
 * Split last-complete-year OpEx into fixed and variable monthly amounts.
 * Returns:
 *   {
 *     fixedMonthly: $/month,         // sum of fixed-classified OpEx ÷ 12
 *     variablePctRevenue: 0..1,      // variable OpEx as fraction of revenue
 *     fixedCategories: [...],        // diagnostic list
 *     variableCategories: [...],
 *     baseYear, baseRevenue,
 *   }
 */
function classifyCosts(D) {
  const completePL = (typeof _latestAnnualPL === 'function') ? _latestAnnualPL(D) : null;
  if (!completePL || !completePL.opex || !completePL.revenue) return null;
  let fixedTotal = 0, variableTotal = 0;
  const fixedCats = [], variableCats = [];
  Object.entries(completePL.opex).forEach(([cat, amt]) => {
    const v = +amt || 0;
    if (_classifyOpExCategory(cat) === 'variable') {
      variableTotal += v;
      variableCats.push({ category: cat.replace(/_/g, ' '), amount: v });
    } else {
      fixedTotal += v;
      fixedCats.push({ category: cat.replace(/_/g, ' '), amount: v });
    }
  });
  fixedCats.sort((a, b) => b.amount - a.amount);
  variableCats.sort((a, b) => b.amount - a.amount);
  return {
    fixedMonthly: +(fixedTotal / 12).toFixed(2),
    fixedAnnual: +fixedTotal.toFixed(2),
    variableAnnual: +variableTotal.toFixed(2),
    variablePctRevenue: completePL.revenue > 0 ? +(variableTotal / completePL.revenue).toFixed(4) : 0,
    fixedCategories: fixedCats,
    variableCategories: variableCats,
    baseYear: completePL._year,
    baseRevenue: completePL.revenue,
  };
}

/**
 * Build a month-by-month P&L forecast for a given range.
 * `start` and `end` are Date objects (only year+month matter).
 *
 * For each month:
 *   • If it's <= the latest "actual" month (from qbo-pl-monthly), use actual.
 *   • Otherwise project: revenue = priorYearSameMonth × paceRatio.
 *     COGS = revenue × (1 - GM%). FixedOpEx = flat. VariableOpEx = revenue × varPct.
 *     NI = revenue - COGS - fixedOpEx - variableOpEx.
 *
 * Output: { months: [...], totals: {...}, assumptions: {...}, splitAtMonthIndex }
 */
function _forecastPLRange(D, start, end) {
  const monthly = D?.['qbo-pl-monthly'];
  const monthlyByYear = D?.['qbo-sales']?.monthlyByYear;
  const all = D?.['qbo-pl_all'] || {};
  const completePL = (typeof _latestAnnualPL === 'function') ? _latestAnnualPL(D) : null;
  const costs = classifyCosts(D);
  if (!completePL || !monthlyByYear || !costs) return null;

  // ── Pipeline-driven revenue inputs ─────────────────────────────
  // Walk every pending Knowify bid → group win rate → expected revenue
  // landing month. THIS is the chain the user asked us to use:
  //   bid → award → invoice → revenue → AR → cash.
  // See pipelineRevenueSchedule() for the per-bid math.
  const pipeSchedule = (typeof pipelineRevenueSchedule === 'function') ? pipelineRevenueSchedule(D, 18) : null;
  const arrival = (typeof bidArrivalRate === 'function') ? bidArrivalRate(D) : null;
  // Build a map { 'YYYY-MM' → expectedFromCurrentPipeline$ }
  const pipeRevByYM = {};
  if (pipeSchedule?.months) {
    pipeSchedule.months.forEach(m => {
      pipeRevByYM[`${m.year}-${m.month}`] = m.expectedRev || 0;
    });
  }

  // YoY pace ratio (CY-YTD vs PY-same-months)
  let paceRatio = 1.0;
  const ytd = (typeof ytdVsPriorSamePeriod === 'function') ? ytdVsPriorSamePeriod(D) : null;
  if (ytd?.cy?.revenue && ytd?.py?.revenue) paceRatio = ytd.cy.revenue / ytd.py.revenue;

  const gmPct = completePL.grossMarginPct != null ? completePL.grossMarginPct / 100 : 0.35;
  const fixedMonthly = costs.fixedMonthly;
  const variablePctRevenue = costs.variablePctRevenue;
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Determine which months we have ACTUAL data for in qbo-pl-monthly
  const cyYear = monthly?.meta?.year ? String(monthly.meta.year) : String(new Date().getFullYear());
  const cyStatus = (typeof _yearStatus === 'function') ? _yearStatus(D, cyYear) : { complete: true, monthsCovered: 0 };
  const cyActualMonths = cyStatus.monthsCovered || 0;
  const cyMonthsRev = monthly?.revenue?.months || [];
  const cyMonthsCogs = monthly?.cogs?.months || [];
  const cyMonthsOpex = monthly?.opex?.months || [];

  const months = [];
  let totalRev = 0, totalCogs = 0, totalGP = 0,
      totalFixedOpEx = 0, totalVarOpEx = 0, totalOpEx = 0, totalNI = 0;
  let actualCount = 0;
  let firstProjectedIdx = -1;

  // Walk start → end
  const startYr = start.getFullYear(), startMo = start.getMonth();
  const endYr = end.getFullYear(), endMo = end.getMonth();
  const totalMonths = (endYr - startYr) * 12 + (endMo - startMo) + 1;

  for (let i = 0; i < totalMonths; i++) {
    const yr = startYr + Math.floor((startMo + i) / 12);
    const moIdx = (startMo + i) % 12;
    const isCurrentYear = String(yr) === cyYear;
    const hasActual = isCurrentYear && moIdx < cyActualMonths;

    let rev, cogs, gp, fixedOpEx, varOpEx, opex, ni, source;
    if (hasActual) {
      rev = +(cyMonthsRev[moIdx] || 0).toFixed(2);
      cogs = +(cyMonthsCogs[moIdx] || 0).toFixed(2);
      // Approximate fixed/variable split from totals — split actual OpEx by ratio
      const opexActual = +(cyMonthsOpex[moIdx] || 0).toFixed(2);
      // Without category-grain monthly OpEx, we can't perfectly split actual.
      // Approximate using last-year's fixed/variable ratio.
      const totalLastYr = costs.fixedAnnual + costs.variableAnnual;
      const fixedShare = totalLastYr > 0 ? costs.fixedAnnual / totalLastYr : 1;
      fixedOpEx = +(opexActual * fixedShare).toFixed(2);
      varOpEx   = +(opexActual * (1 - fixedShare)).toFixed(2);
      opex = opexActual;
      gp = +(rev - cogs).toFixed(2);
      ni = +(gp - opex).toFixed(2);
      source = 'actual';
      actualCount++;
    } else {
      // PROJECT — three signals combined:
      //   (a) Seasonal baseline   = prior-year same-month × YoY pace ratio
      //   (b) Pipeline-implied    = expected revenue from CURRENT pending bids
      //                             landing in this month (via group win rate)
      //   (c) Forward-arrival     = average new bids/month × win rate × avg CV
      //                             (fills months past where current pending lands)
      //
      // The HYBRID picks the larger of (a) and (b + c) per month, since both
      // are forward indicators of the same underlying volume — but neither alone
      // is complete. The seasonal baseline assumes throughput stays steady; the
      // pipeline view assumes only-what's-bid will land. Reality is: current
      // pending bids will convert AND new bids will arrive.
      const baseYr = String(parseInt(costs.baseYear, 10));
      const priorMonths = monthlyByYear[baseYr];
      const baseRev = priorMonths && priorMonths.length === 12 ? (priorMonths[moIdx] || 0) : 0;
      const seasonalRev = +(baseRev * paceRatio).toFixed(2);

      // Pipeline-implied for this specific month
      const pipeRev = pipeRevByYM[`${yr}-${moIdx + 1}`] || 0;

      // Forward-arrival contribution. Months further out (past where today's
      // pending bids land) get more "new arrival" contribution. Today's pending
      // covers the next ~lag+30 days only; beyond that, new bids arrive.
      const monthsFromNow = (yr - new Date().getFullYear()) * 12 + (moIdx - new Date().getMonth());
      // Within the first month of pipeline-landing window, current pending dominates;
      // past that, new arrivals fill in linearly.
      const arrivalRev = arrival ? Math.min(arrival.expectedRevenuePerMonth, seasonalRev) : 0;
      const pipelineGroundedRev = +(pipeRev + (monthsFromNow >= 1 ? arrivalRev : 0)).toFixed(2);

      // Hybrid: take the larger of seasonal baseline and pipeline-grounded.
      // If pipeline-grounded is materially higher, that's a signal that this
      // month has unusual bid concentration; take it. Otherwise default to
      // seasonal which captures historical throughput.
      rev = Math.max(seasonalRev, pipelineGroundedRev);
      const usingPipeline = pipelineGroundedRev > seasonalRev;

      cogs = +(rev * (1 - gmPct)).toFixed(2);
      gp = +(rev - cogs).toFixed(2);
      fixedOpEx = +fixedMonthly.toFixed(2);
      varOpEx = +(rev * variablePctRevenue).toFixed(2);
      opex = +(fixedOpEx + varOpEx).toFixed(2);
      ni = +(gp - opex).toFixed(2);
      source = usingPipeline
        ? `pipeline ${fmt(pipeRev)} + arrivals → max(${fmt(seasonalRev)}, ${fmt(pipelineGroundedRev)})`
        : `${costs.baseYear} ${monthNames[moIdx]} × ${paceRatio.toFixed(2)} pace (seasonal)`;
      if (firstProjectedIdx < 0) firstProjectedIdx = i;
      // Stash both inputs for the UI to surface
      var revSeasonal = seasonalRev;
      var revPipeline = pipelineGroundedRev;
      var revPipelineFromCurrent = pipeRev;
      var revPipelineFromArrivals = monthsFromNow >= 1 ? arrivalRev : 0;
      var revHybridSource = usingPipeline ? 'pipeline-grounded' : 'seasonal-baseline';
    }
    months.push({
      year: yr, month: moIdx + 1, label: `${monthNames[moIdx]} ${yr}`,
      revenue: rev, cogs, grossProfit: gp,
      opex, fixedOpEx, variableOpEx: varOpEx,
      netIncome: ni, source, isActual: source === 'actual',
      // Forecast-decomposition fields (only present for projected months)
      revSeasonal: typeof revSeasonal === 'number' ? +revSeasonal.toFixed(2) : null,
      revPipeline: typeof revPipeline === 'number' ? +revPipeline.toFixed(2) : null,
      revPipelineFromCurrent: typeof revPipelineFromCurrent === 'number' ? +revPipelineFromCurrent.toFixed(2) : null,
      revPipelineFromArrivals: typeof revPipelineFromArrivals === 'number' ? +revPipelineFromArrivals.toFixed(2) : null,
      revHybridSource: revHybridSource || null,
    });
    // reset locals so next month doesn't carry over (closure in the for-loop)
    revSeasonal = revPipeline = revPipelineFromCurrent = revPipelineFromArrivals = null;
    revHybridSource = null;
    totalRev += rev; totalCogs += cogs; totalGP += gp;
    totalFixedOpEx += fixedOpEx; totalVarOpEx += varOpEx;
    totalOpEx += opex; totalNI += ni;
  }

  return {
    months,
    splitAtMonthIndex: firstProjectedIdx,  // first projected month (or -1 if all actual)
    actualCount,
    projectedCount: months.length - actualCount,
    totals: {
      revenue:      +totalRev.toFixed(2),
      cogs:         +totalCogs.toFixed(2),
      grossProfit:  +totalGP.toFixed(2),
      fixedOpEx:    +totalFixedOpEx.toFixed(2),
      variableOpEx: +totalVarOpEx.toFixed(2),
      opex:         +totalOpEx.toFixed(2),
      netIncome:    +totalNI.toFixed(2),
      gmPct:        totalRev > 0 ? +(totalGP / totalRev * 100).toFixed(1) : null,
      nmPct:        totalRev > 0 ? +(totalNI / totalRev * 100).toFixed(1) : null,
    },
    assumptions: {
      yoyPaceRatio: +paceRatio.toFixed(3),
      gmPct: +(gmPct * 100).toFixed(1),
      fixedMonthly: costs.fixedMonthly,
      variablePctRevenue: +(costs.variablePctRevenue * 100).toFixed(1),
      baseYear: costs.baseYear,
      fixedCategoryCount: costs.fixedCategories.length,
      variableCategoryCount: costs.variableCategories.length,
    },
    costClassification: costs,
  };
}

/**
 * In-year forecast: Jan→Dec of the current calendar year.
 * Months that have already happened use actual data; remaining months are projected.
 */
function inYearForecast(D) {
  const today = new Date();
  const yr = today.getFullYear();
  const start = new Date(yr, 0, 1);
  const end = new Date(yr, 11, 1);
  return _forecastPLRange(D, start, end);
}

/**
 * Next-12-months forecast: rolling 12 months from current month forward.
 * (Always projected — actual data only fills the very first month if we're
 * past mid-month and have it, otherwise this is fully forward-looking.)
 */
function next12MonthsForecast(D) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 11);
  return _forecastPLRange(D, start, end);
}

/**
 * Weekly AR collections forecast — distribute open invoices across the next
 * N weeks based on each invoice's estimated pay date. Returns one row per
 * week with $ inflow and confidence breakdown.
 *
 * Output: { weeks: [{ start, end, label, ar$, count, conf: {high, med, low, unknown} }],
 *           totalInflow, weeksAhead, asOf }
 */
function arForecastByWeek(D, weeksAhead = 26) {
  const oi = D?.['qbo-open-invoices'];
  const invoices = oi?.invoices || [];
  if (!invoices.length) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Anchor weeks to Monday-start
  const dow = today.getDay();
  const monOffset = (dow + 6) % 7; // 0=Mon, 1=Tue, ..., 6=Sun
  const weekStart0 = new Date(today.getTime() - monOffset * 86400000);

  const weeks = [];
  for (let i = 0; i < weeksAhead; i++) {
    const start = new Date(weekStart0.getTime() + i * 7 * 86400000);
    const end = new Date(start.getTime() + 6 * 86400000);
    weeks.push({
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      label: `Wk of ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      ar: 0, count: 0,
      conf: { high: 0, med: 0, low: 0, unknown: 0 },
    });
  }
  const overdue = { ar: 0, count: 0, conf: { high: 0, med: 0, low: 0, unknown: 0 }, items: [] };
  let totalInflow = 0;

  for (const inv of invoices) {
    const est = (typeof estimatePaymentDate === 'function') ? estimatePaymentDate(inv, D) : null;
    const amount = inv.openBalance || 0;
    if (!est) {
      // Unknown — pile into overdue bucket conceptually (no estimable week)
      overdue.ar += amount;
      overdue.count++;
      overdue.conf.unknown += amount;
      overdue.items.push({ inv, est: null });
      continue;
    }
    const payDate = new Date(est.expectedPayDate);
    payDate.setHours(0, 0, 0, 0);
    const confKey = est.confidence === 'client-history' ? 'high'
                  : est.confidence === 'low-sample'     ? 'med'
                  : est.confidence === 'portfolio-fallback' ? 'low'
                  : 'unknown';
    if (payDate < weekStart0) {
      // Past expected pay date — bucket into overdue (which we add as week-zero overlay)
      overdue.ar += amount;
      overdue.count++;
      overdue.conf[confKey] += amount;
      overdue.items.push({ inv, est });
    } else {
      const weekIdx = Math.floor((payDate - weekStart0) / (7 * 86400000));
      if (weekIdx < weeksAhead) {
        const w = weeks[weekIdx];
        w.ar += amount;
        w.count++;
        w.conf[confKey] += amount;
      }
      // else falls past horizon — don't add (or could add to a "120+" overflow)
    }
    totalInflow += amount;
  }

  weeks.forEach(w => {
    w.ar = +w.ar.toFixed(2);
    Object.keys(w.conf).forEach(k => { w.conf[k] = +w.conf[k].toFixed(2); });
  });
  overdue.ar = +overdue.ar.toFixed(2);
  Object.keys(overdue.conf).forEach(k => { overdue.conf[k] = +overdue.conf[k].toFixed(2); });

  return {
    asOf: oi?.meta?.parsedAt || new Date().toISOString(),
    weeksAhead,
    weeks,
    overdue,
    totalInflow: +totalInflow.toFixed(2),
  };
}



// ════════════════════════════════════════════════════════════════════════
// SECTION 11 ─ PIPELINE-DRIVEN REVENUE (per-bid forward chain)
// ════════════════════════════════════════════════════════════════════════
//
// Walks each pending Knowify bid: extract GC, classify into outreach
// group, multiply bid CV by that group's $-win rate, time-shift by
// (bid-to-award lag + project duration), bucket into the resulting
// month. Output is an expected-revenue stream by month from CURRENT
// pending bids alone.
//
// Used by _forecastPLRange to chain pipeline → revenue → P&L.

const PROJECT_DURATION_DAYS = 30;
const LOOKBACK_BID_MONTHS = 12;

function pipelineRevenueSchedule(D, monthsAhead) {
  monthsAhead = monthsAhead || 18;
  const knowify = D && D['knowify-jobs'];
  if (!knowify || !knowify.jobs) return null;
  const R = applyKnowifyRules(knowify.jobs);
  const groups = (typeof groupWinRates === 'function') ? groupWinRates(D) : null;
  if (!groups) return null;
  const lagDays = (typeof bidToRevenueLagDays === 'function') ? bidToRevenueLagDays(D) : 60;
  const fallbackRate = (R.competitive && R.competitive.dollarWinRate) || 0;

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const today = new Date();
  const startYr = today.getFullYear(), startMo = today.getMonth();
  const months = [];
  for (let i = 0; i < monthsAhead; i++) {
    const yr = startYr + Math.floor((startMo + i) / 12);
    const moIdx = (startMo + i) % 12;
    months.push({
      year: yr, month: moIdx + 1,
      label: monthNames[moIdx] + ' ' + yr,
      expectedRev: 0,
      byGroup: { A: 0, B: 0, 'C-STOP': 0, 'C-PUB': 0, 'C-MIX': 0, CHAIN: 0, UNCLASSIFIED: 0, 'DATA-ARTIFACT': 0 },
      count: 0, pendingFaceValue: 0,
    });
  }

  let totalPending = 0, totalExpected = 0;
  R.competitive.jobs.forEach(function(j) {
    if (j.outcome !== 'pending') return;
    const cv = +j.contractTotal || 0;
    if (cv <= 0) return;
    totalPending += cv;
    const gc = j._extractedGC || (typeof extractGCFromJob === 'function' ? extractGCFromJob(j) : j.client);
    const c = (typeof classifyGCByOutreach === 'function') ? classifyGCByOutreach(gc, R.byGC) : { group: 'UNCLASSIFIED' };
    const groupKey = c.group;
    const groupStat = groups[groupKey];
    let winRate = (groupStat && groupStat.dollarWinRate != null && groupStat.sampleSize >= 5)
      ? groupStat.dollarWinRate / 100
      : fallbackRate / 100;
    if (groupKey === 'DATA-ARTIFACT') winRate *= 0.5;
    const expected = cv * winRate;
    const landDate = new Date(today.getTime() + (lagDays + PROJECT_DURATION_DAYS) * 86400000);
    const bucketIdx = (landDate.getFullYear() - startYr) * 12 + (landDate.getMonth() - startMo);
    if (bucketIdx >= 0 && bucketIdx < monthsAhead) {
      const b = months[bucketIdx];
      b.expectedRev += expected;
      b.byGroup[groupKey] = (b.byGroup[groupKey] || 0) + expected;
      b.count++;
      b.pendingFaceValue += cv;
    }
    totalExpected += expected;
  });

  months.forEach(function(m) {
    m.expectedRev = +m.expectedRev.toFixed(2);
    m.pendingFaceValue = +m.pendingFaceValue.toFixed(2);
    Object.keys(m.byGroup).forEach(function(k) { m.byGroup[k] = +m.byGroup[k].toFixed(2); });
  });

  return {
    months: months,
    totalPending: +totalPending.toFixed(2),
    totalExpected: +totalExpected.toFixed(2),
    weightedWinRate: totalPending > 0 ? +(totalExpected / totalPending * 100).toFixed(1) : null,
    assumptions: {
      lagDays: lagDays,
      projectDurationDays: PROJECT_DURATION_DAYS,
      monthsAhead: monthsAhead,
      fallbackRate: fallbackRate,
    },
  };
}

/**
 * Forward-bid-arrival rate. Walks competitive Knowify jobs from the last
 * LOOKBACK_BID_MONTHS, computes average bids/month and average bid CV.
 * Used by _forecastPLRange to fill projection months past where current
 * pending bids are scheduled to land — i.e., new bids that haven't
 * arrived yet but historically would.
 *
 * Per-group rates would be ideal but we don't know which group FUTURE
 * bids will come from; the historical blended $-win rate is a fair-mix
 * proxy. _forecastPLRange caps arrival revenue at the seasonal baseline
 * so this can't over-project.
 */
/**
 * Forward-bid-arrival rate. Walks competitive Knowify jobs from the last
 * LOOKBACK_BID_MONTHS, computes average bids/month and average bid CV.
 * Used by _forecastPLRange to fill projection months past where current
 * pending bids are scheduled to land — i.e., new bids that haven't
 * arrived yet but historically would.
 *
 * Per-group rates would be ideal but we don't know which group FUTURE
 * bids will come from; the historical blended $-win rate is a fair-mix
 * proxy. _forecastPLRange caps arrival revenue at the seasonal baseline
 * so this can't over-project.
 */
function bidArrivalRate(D) {
  const knowify = D && D['knowify-jobs'];
  if (!knowify || !knowify.jobs) return null;
  const R = applyKnowifyRules(knowify.jobs);

  // Window: last LOOKBACK_BID_MONTHS of created competitive bids.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - LOOKBACK_BID_MONTHS);
  const recent = R.competitive.jobs.filter(function(j) {
    if (!j.createdDate) return false;
    const d = new Date(j.createdDate);
    return !isNaN(d) && d >= cutoff;
  });
  if (!recent.length) return null;

  const bidsPerMonth = recent.length / LOOKBACK_BID_MONTHS;
  const totalCV = recent.reduce(function(s, j) { return s + (+j.contractTotal || 0); }, 0);
  const avgBidCV = recent.length ? totalCV / recent.length : 0;

  const blendedWinRate = (R.competitive && R.competitive.dollarWinRate != null)
    ? R.competitive.dollarWinRate
    : null;
  if (blendedWinRate == null) return null;

  const expectedRevenuePerMonth = +(bidsPerMonth * (blendedWinRate / 100) * avgBidCV).toFixed(2);

  return {
    lookbackMonths: LOOKBACK_BID_MONTHS,
    bidsInLookback: recent.length,
    bidsPerMonth: +bidsPerMonth.toFixed(2),
    avgBidCV: +avgBidCV.toFixed(2),
    blendedWinRate,
    expectedRevenuePerMonth,
    note: 'Forward-arrival projection: bids/month × blended $-win rate × avg CV. Capped at seasonal baseline by _forecastPLRange to prevent over-projection.',
  };
}
