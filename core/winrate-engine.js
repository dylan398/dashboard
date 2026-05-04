// ════════════════════════════════════════════════════════════════════════
// Win-Rate Engine — per-GC win rate + tier classification
// ════════════════════════════════════════════════════════════════════════
//
// Powers reports/winrates.html. Consumes the canonical Knowify outcome
// classification from dash.js's applyKnowifyRules() — which applies the
// four SFS rules (Rejected→loss, Active→win, Closed with invoiced=0→loss,
// stale Bidding→loss, otherwise→pending) and excludes the relationship
// channel — so the win/loss/pending split here matches every other page.
//
// On top of that canonical classification, this engine layers:
//   • LIVE alias resolution via window.GCAliases.resolveGCName (user-curated
//     merges from /gc-aliases/ in Firebase) — applyKnowifyRules only does
//     the static legacy alias map, so we re-canonicalize.
//   • EXCLUSION filter via window.GCExclusions.isExcluded — drops names that
//     aren't real GCs (the company itself, vendors, location strings,
//     project descriptors like "Phase 1" / "Change Order" / "Package A").
//   • Hard MIN-BIDS cutoff — GCs below the threshold are removed from
//     analysis, not just labeled "below sample".
//   • Per-year breakdown — wins/losses/pending split out by job.createdDate
//     year, so the all-GCs table can show year-over-year columns.
//
// Functions exposed via window.WinRateEngine:
//   • normalizeFromRules(D)           — runs applyKnowifyRules, layers live
//                                        alias resolution + exclusion filter,
//                                        returns flat job list.
//   • byGCAllTime(jobs, opts)         — { gc, bids, wins, losses, pending,
//                                          wr, dollarWR, wonCV, lostCV,
//                                          pendingCV, byYear:{yr:{...}} }[]
//   • applyMinBids(rows, minBids)     — filter to rows with bids ≥ minBids.
//   • classifyTiers(rows, opts)       — { T1, T2, T3, T0, counts, summary }
//   • monthlySeries(jobs, opts)       — { months, byGC } for trend charts.
//   • tierShift(curr, prev, opts)     — list of GCs that moved tiers.
//   • filterByWindow(jobs, start, end)
//   • yearList(rows, capRecent)       — sorted list of years present, capped
//                                        at the most recent N (for table).
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  function _toDate(d) {
    if (!d) return null;
    const x = (d instanceof Date) ? d : new Date(d);
    return isNaN(x) ? null : x;
  }

  function _ymKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  function _ymLabel(d) {
    const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return MO[d.getMonth()] + ' ' + d.getFullYear();
  }

  function _resolveAlias(rawName) {
    if (typeof window !== 'undefined' && window.GCAliases && typeof window.GCAliases.resolveGCName === 'function') {
      return window.GCAliases.resolveGCName(rawName);
    }
    return rawName;
  }

  function _isExcluded(name) {
    if (typeof window !== 'undefined' && window.GCExclusions && typeof window.GCExclusions.isExcluded === 'function') {
      return window.GCExclusions.isExcluded(name);
    }
    return false;
  }

  // Run applyKnowifyRules to get the canonical outcome + GC, then layer live
  // alias resolution and exclusion filtering on top.
  // PlanHub stays as PlanHub from the rules engine — caller decides whether
  // to exclude (CONTEXT.md §2.5: PlanHub's 0% WR is a Knowify reporting
  // artifact). byGCAllTime excludes it via the artifact flag by default.
  function normalizeFromRules(D) {
    if (!D || !D['knowify-jobs'] || !D['knowify-jobs'].jobs) return [];
    if (typeof applyKnowifyRules !== 'function') {
      console.error('WinRateEngine.normalizeFromRules: applyKnowifyRules missing — load core/dash.js first.');
      return [];
    }
    const R = applyKnowifyRules(D['knowify-jobs'].jobs);
    const out = [];
    R.competitive.jobs.forEach(function (j) {
      const baseGC = j._extractedGC; // canonical via static map + extractGCFromJob
      if (!baseGC) return;
      const finalGC = _resolveAlias(baseGC); // layer live aliases
      if (_isExcluded(finalGC)) return;       // drop excluded names
      const cd = _toDate(j.createdDate);
      out.push({
        jobName: j.jobName || j.name || '',
        rawGC:   baseGC,
        gc:      finalGC,
        outcome: j.outcome,
        status:  j.originalStatus || j.status || null,
        cv:      +j.contractTotal || 0,
        createdDate: cd ? cd.toISOString().slice(0, 10) : null,
        ym:      cd ? _ymKey(cd) : null,
        year:    cd ? cd.getFullYear() : null,
        ageDays: j.ageDays,
        reclassReason: j.reclassReason || null,
        salesLead: j.salesLead || null,
        isMultiGC: !!j.isMultiGC,
      });
    });
    return out;
  }

  // Aggregate by GC with per-year sub-buckets + multi-GC tracking + recency.
  //
  // MULTI-GC: applyKnowifyRules tags j.isMultiGC when the same project (job
  // name with the GC stripped) appears under multiple GCs. Those are bids
  // where multiple GCs were collecting on the same project. Only one of them
  // ultimately wins; the others may show as "loss" without SFS having actually
  // been rejected — they just bid through the wrong GC. Per-GC counts of
  // multi-GC bids contextualize the WR for that GC.
  //
  // ADJUSTED WR: an "ambiguous-loss-discounted" rate that excludes multi-GC
  // losses entirely (treats them as inconclusive rather than as losses against
  // SFS). Decided count drops accordingly. This is an UPPER bound on the
  // GC's true WR — if SFS would have lost ALL the multi-GC bids anyway, the
  // raw WR is correct; if SFS would have won SOME if it had bid through the
  // GC that ultimately got the project, the adjusted is closer.
  //
  // RECENCY: lastBidDate per GC, plus daysSinceLastBid (computed at agg time).
  // Useful to spot dormant relationships.
  function byGCAllTime(jobs, opts) {
    opts = opts || {};
    const excludeArtifact = opts.excludeArtifact !== false;
    const todayMs = Date.now();
    const map = {};
    jobs.forEach(function (j) {
      if (!j.gc) return;
      const k = j.gc;
      if (!map[k]) {
        map[k] = {
          gc: k,
          bids: 0, wins: 0, losses: 0, pending: 0,
          wonCV: 0, lostCV: 0, pendingCV: 0,
          // Multi-GC tracking
          multiGCBids: 0, multiGCWins: 0, multiGCLosses: 0, multiGCPending: 0,
          multiGCLostCV: 0, multiGCPendingCV: 0,
          // Per-year breakdown
          byYear: {},
          // Recency
          lastBidDate: null,
          // PlanHub flag
          isArtifact: /^planhub$/i.test(k),
        };
      }
      const r = map[k];
      r.bids++;
      const isMulti = !!j.isMultiGC;
      if (isMulti) r.multiGCBids++;
      const yr = j.year || 'unknown';
      if (!r.byYear[yr]) r.byYear[yr] = { wins: 0, losses: 0, pending: 0, wonCV: 0, lostCV: 0, multiGCBids: 0 };
      const yc = r.byYear[yr];
      if (isMulti) yc.multiGCBids++;
      if (j.outcome === 'win')       { r.wins++;    r.wonCV    += j.cv; yc.wins++;   yc.wonCV  += j.cv; if (isMulti) r.multiGCWins++; }
      else if (j.outcome === 'loss') { r.losses++;  r.lostCV   += j.cv; yc.losses++; yc.lostCV += j.cv; if (isMulti) { r.multiGCLosses++; r.multiGCLostCV += j.cv; } }
      else                           { r.pending++; r.pendingCV+= j.cv; yc.pending++; if (isMulti) { r.multiGCPending++; r.multiGCPendingCV += j.cv; } }
      // Recency
      if (j.createdDate && (r.lastBidDate == null || j.createdDate > r.lastBidDate)) {
        r.lastBidDate = j.createdDate;
      }
    });
    const rows = Object.values(map).map(function (r) {
      const decided = r.wins + r.losses;
      const decidedCV = r.wonCV + r.lostCV;
      r.wr        = decided    > 0 ? +(r.wins  / decided    * 100).toFixed(1) : null;
      r.dollarWR  = decidedCV  > 0 ? +(r.wonCV / decidedCV  * 100).toFixed(1) : null;
      r.decided   = decided;
      r.wonCV     = +r.wonCV.toFixed(2);
      r.lostCV    = +r.lostCV.toFixed(2);
      r.pendingCV = +r.pendingCV.toFixed(2);

      // Adjusted WR — excludes multi-GC losses from the denominator.
      const adjLosses = r.losses - r.multiGCLosses;
      const adjDecided = r.wins + adjLosses;
      r.adjustedDecided = adjDecided;
      r.adjustedWR = adjDecided > 0 ? +(r.wins / adjDecided * 100).toFixed(1) : null;
      const adjLostCV = r.lostCV - r.multiGCLostCV;
      const adjDecCV = r.wonCV + adjLostCV;
      r.adjustedDollarWR = adjDecCV > 0 ? +(r.wonCV / adjDecCV * 100).toFixed(1) : null;
      r.multiGCLostCV    = +r.multiGCLostCV.toFixed(2);
      r.multiGCPendingCV = +r.multiGCPendingCV.toFixed(2);

      // Average won/lost bid size — context for "do they award us small or large jobs".
      r.avgWonCV  = r.wins   > 0 ? +(r.wonCV  / r.wins).toFixed(2)   : null;
      r.avgLostCV = r.losses > 0 ? +(r.lostCV / r.losses).toFixed(2) : null;

      // Recency
      if (r.lastBidDate) {
        const t = new Date(r.lastBidDate).getTime();
        r.daysSinceLastBid = Math.floor((todayMs - t) / 86400000);
      } else {
        r.daysSinceLastBid = null;
      }

      Object.keys(r.byYear).forEach(function (yr) {
        const y = r.byYear[yr];
        y.decided = y.wins + y.losses;
        y.wr = y.decided > 0 ? +(y.wins / y.decided * 100).toFixed(1) : null;
        y.wonCV  = +y.wonCV.toFixed(2);
        y.lostCV = +y.lostCV.toFixed(2);
      });
      return r;
    }).filter(function (r) { return excludeArtifact ? !r.isArtifact : true; });
    rows.sort(function (a, b) { return b.bids - a.bids; });
    return rows;
  }

  // Per-GC pending breakdown for the Current Bids forecast panel.
  // For each GC with at least one pending bid, returns:
  //   gc, pending, pendingCV, multiGCPending, multiGCPendingCV,
  //   wr, dollarWR (historical, unchanged from byGCAllTime row),
  //   expectedWins  = pending  * (wr / 100)
  //   expectedWinCV = pendingCV * (dollarWR / 100)
  //   sample = decided (informs confidence — small samples make the rate noisy)
  // Sorted by expectedWinCV desc.
  function pendingByGC(byGCRows, opts) {
    opts = opts || {};
    const minSample = opts.minSampleForRate != null ? opts.minSampleForRate : 5;
    const out = [];
    (byGCRows || []).forEach(function (r) {
      if (!r.pending) return;
      const usableRate = (r.decided != null ? r.decided : (r.wins + r.losses)) >= minSample && r.wr != null;
      const wr = usableRate ? r.wr : null;
      const dwr = usableRate && r.dollarWR != null ? r.dollarWR : null;
      out.push({
        gc:               r.gc,
        pending:          r.pending,
        pendingCV:        r.pendingCV,
        multiGCPending:   r.multiGCPending || 0,
        multiGCPendingCV: r.multiGCPendingCV || 0,
        wr:               wr,
        dollarWR:         dwr,
        decided:          r.decided != null ? r.decided : (r.wins + r.losses),
        sampleAdequate:   usableRate,
        expectedWins:     usableRate ? +((r.pending * wr / 100)).toFixed(2) : null,
        expectedWinCV:    usableRate && dwr != null ? +((r.pendingCV * dwr / 100)).toFixed(2) : null,
      });
    });
    out.sort(function (a, b) {
      const av = a.expectedWinCV != null ? a.expectedWinCV : -1;
      const bv = b.expectedWinCV != null ? b.expectedWinCV : -1;
      return bv - av;
    });
    return out;
  }

  // Hard min-bids filter — drops GCs entirely.
  function applyMinBids(rows, minBids) {
    minBids = minBids != null ? minBids : 5;
    return (rows || []).filter(function (r) { return (r.bids || 0) >= minBids; });
  }

  // Years present in the data, sorted ascending.
  // capRecent: keep only the most recent N years.
  function yearList(rows, capRecent) {
    const set = new Set();
    (rows || []).forEach(function (r) {
      Object.keys(r.byYear || {}).forEach(function (y) { if (y !== 'unknown') set.add(parseInt(y, 10)); });
    });
    let years = Array.from(set).filter(function (y) { return !isNaN(y); }).sort(function (a, b) { return a - b; });
    if (capRecent && years.length > capRecent) years = years.slice(years.length - capRecent);
    return years;
  }

  // Tier classification.
  function classifyTiers(rows, opts) {
    opts = opts || {};
    const minBids = opts.minBids != null ? opts.minBids : 5;
    const useDollar = !!opts.useDollar;
    const T1 = [], T2 = [], T3 = [], T0 = [], belowSample = [];
    (rows || []).forEach(function (r) {
      const decided = r.decided != null ? r.decided : (r.wins + r.losses);
      if (decided < minBids) { belowSample.push(r); return; }
      const rate = useDollar ? r.dollarWR : r.wr;
      if (rate == null)        { belowSample.push(r); return; }
      if (rate >= 70)          T1.push(r);
      else if (rate >= 30)     T2.push(r);
      else if (rate > 0)       T3.push(r);
      else                     T0.push(r);
    });
    [T1, T2, T3, T0, belowSample].forEach(function (a) {
      a.sort(function (x, y) { return (y.bids || 0) - (x.bids || 0); });
    });
    const sumBids   = function (a) { return a.reduce(function (s, r) { return s + (r.bids || 0); }, 0); };
    const sumWonCV  = function (a) { return a.reduce(function (s, r) { return s + (r.wonCV || 0); }, 0); };
    const sumPendCV = function (a) { return a.reduce(function (s, r) { return s + (r.pendingCV || 0); }, 0); };
    return {
      T1: T1, T2: T2, T3: T3, T0: T0, belowSample: belowSample,
      counts: { T1: T1.length, T2: T2.length, T3: T3.length, T0: T0.length, belowSample: belowSample.length },
      summary: {
        T1: { gcs: T1.length, bids: sumBids(T1), wonCV: sumWonCV(T1), pendingCV: sumPendCV(T1) },
        T2: { gcs: T2.length, bids: sumBids(T2), wonCV: sumWonCV(T2), pendingCV: sumPendCV(T2) },
        T3: { gcs: T3.length, bids: sumBids(T3), wonCV: sumWonCV(T3), pendingCV: sumPendCV(T3) },
        T0: { gcs: T0.length, bids: sumBids(T0), wonCV: sumWonCV(T0), pendingCV: sumPendCV(T0) },
        minBids: minBids, useDollar: useDollar,
      },
    };
  }

  // Trend chart series. Cohort by bid-creation month.
  function monthlySeries(jobs, opts) {
    opts = opts || {};
    const asOf = _toDate(opts.asOf) || new Date();
    asOf.setHours(0, 0, 0, 0);
    const lookback = opts.lookbackMonths || 12;

    const months = [];
    for (let i = lookback - 1; i >= 0; i--) {
      const start = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
      const end = new Date(asOf.getFullYear(), asOf.getMonth() - i + 1, 0);
      months.push({
        ym: _ymKey(start),
        label: _ymLabel(start),
        start: start.toISOString().slice(0, 10),
        end:   end.toISOString().slice(0, 10),
      });
    }
    const ymSet = new Set(months.map(function (m) { return m.ym; }));

    const byGC = {};
    jobs.forEach(function (j) {
      if (!j.gc || !j.ym) return;
      if (!ymSet.has(j.ym)) return;
      if (!byGC[j.gc]) {
        byGC[j.gc] = {
          gc: j.gc,
          totalBids: 0, totalWins: 0, totalLosses: 0, totalPending: 0,
          monthly: {},
        };
      }
      const g = byGC[j.gc];
      g.totalBids++;
      if (!g.monthly[j.ym]) g.monthly[j.ym] = { wins: 0, losses: 0, pending: 0 };
      const m = g.monthly[j.ym];
      if (j.outcome === 'win')       { g.totalWins++;   m.wins++; }
      else if (j.outcome === 'loss') { g.totalLosses++; m.losses++; }
      else                           { g.totalPending++; m.pending++; }
    });

    Object.values(byGC).forEach(function (g) {
      g.series = months.map(function (m) {
        const cell = g.monthly[m.ym] || { wins: 0, losses: 0, pending: 0 };
        const decided = cell.wins + cell.losses;
        const wr = decided > 0 ? +(cell.wins / decided * 100).toFixed(1) : null;
        return { ym: m.ym, wins: cell.wins, losses: cell.losses, pending: cell.pending, wr: wr, decided: decided };
      });
      const decTotal = g.totalWins + g.totalLosses;
      g.windowWR = decTotal > 0 ? +(g.totalWins / decTotal * 100).toFixed(1) : null;
    });

    return { asOf: asOf.toISOString().slice(0, 10), lookbackMonths: lookback, months: months, byGC: byGC };
  }

  function tierShift(jobsCurr, jobsPrev, opts) {
    opts = opts || {};
    const minBids = opts.minBids != null ? opts.minBids : 5;
    const tierOf = function (r) {
      const dec = r.decided != null ? r.decided : (r.wins + r.losses);
      if (dec < minBids || r.wr == null) return null;
      if (r.wr >= 70) return 'T1';
      if (r.wr >= 30) return 'T2';
      if (r.wr > 0)   return 'T3';
      return 'T0';
    };
    const aggCurr = byGCAllTime(jobsCurr, { excludeArtifact: true });
    const aggPrev = byGCAllTime(jobsPrev, { excludeArtifact: true });
    const map = {};
    aggPrev.forEach(function (r) { map[r.gc] = { prev: r }; });
    aggCurr.forEach(function (r) {
      if (!map[r.gc]) map[r.gc] = {};
      map[r.gc].curr = r;
    });
    const shifts = [];
    Object.entries(map).forEach(function (entry) {
      const k = entry[0]; const v = entry[1];
      const tCurr = v.curr ? tierOf(v.curr) : null;
      const tPrev = v.prev ? tierOf(v.prev) : null;
      if (!tCurr && !tPrev) return;
      if (tCurr === tPrev) return;
      const order = { T1: 4, T2: 3, T3: 2, T0: 1, null: 0 };
      const dir = (order[tCurr] || 0) - (order[tPrev] || 0);
      shifts.push({
        gc: k,
        prevTier: tPrev, currTier: tCurr,
        prevBids: v.prev ? v.prev.bids : 0,
        currBids: v.curr ? v.curr.bids : 0,
        prevWR:   v.prev ? v.prev.wr   : null,
        currWR:   v.curr ? v.curr.wr   : null,
        direction: dir > 0 ? 'up' : dir < 0 ? 'down' : 'lateral',
        delta: dir,
      });
    });
    shifts.sort(function (a, b) {
      if (b.delta !== a.delta) return Math.abs(b.delta) - Math.abs(a.delta);
      return (b.currBids || 0) - (a.currBids || 0);
    });
    return shifts;
  }

  function filterByWindow(jobs, startDate, endDate) {
    const s = _toDate(startDate); const e = _toDate(endDate);
    if (!s || !e) return jobs;
    const sStr = s.toISOString().slice(0, 10);
    const eStr = e.toISOString().slice(0, 10);
    return jobs.filter(function (j) {
      if (!j.createdDate) return false;
      return j.createdDate >= sStr && j.createdDate <= eStr;
    });
  }

  if (typeof window !== 'undefined') {
    window.WinRateEngine = {
      normalizeFromRules: normalizeFromRules,
      byGCAllTime: byGCAllTime,
      pendingByGC: pendingByGC,
      applyMinBids: applyMinBids,
      yearList: yearList,
      classifyTiers: classifyTiers,
      monthlySeries: monthlySeries,
      tierShift: tierShift,
      filterByWindow: filterByWindow,
      // Backwards-compat alias for the v=19 page revision (which called normalizeJobs).
      // The new page (v=20+) uses normalizeFromRules directly.
      normalizeJobs: function (jobsObj) {
        const D = { 'knowify-jobs': { jobs: jobsObj } };
        return normalizeFromRules(D);
      },
    };
  }
})();
