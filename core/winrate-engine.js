// ════════════════════════════════════════════════════════════════════════
// Win-Rate Engine — per-GC win rate over time + tier classification
// ════════════════════════════════════════════════════════════════════════
//
// Powers reports/winrates.html. Independent from dash.js / applyKnowifyRules
// because it needs to apply the LIVE Firebase aliases (via GCAliases.resolveGCName)
// before grouping. dash.js's applyKnowifyRules only knows the static aliases
// in gc-segmentation.js — using it here would fragment GCs with newly-curated
// aliases.
//
// Functions exposed via window.WinRateEngine:
//   • normalizeJobs(jobsObj, opts)     — Knowify {Active, Closed, Bidding, Rejected}
//                                        → flat list of {jobName, gc, outcome, cv, createdDate, decisionMonth}
//   • byGCAllTime(jobs, opts)          — { gc, bids, wins, losses, pending, wr, dollarWR, wonCV, lostCV, pendingCV }
//   • classifyTiers(byGC, opts)        — { T1: [...], T2: [...], T3: [...], T0: [...], belowSample: [...], counts, summary }
//   • monthlySeries(jobs, opts)        — { months: [{ym, label}], byGC: { gcName: { monthly: {ym: {wins,losses,wr}}, total } } }
//   • tierShift(jobsCurr, jobsPrev, opts) — GCs whose tier moved between two windows
//
// CONTEXT.md rules respected:
//   §2.4 partial-year strict rule: monthly buckets are honest about coverage; only
//        decided bids count toward a month's WR (pending excluded).
//   §8.0 Actionability Rule: this engine produces *descriptions* only; the page
//        doesn't say "pursue this GC" or "stop bidding that one".
//
// Outcome mapping (matches applyKnowifyRules conventions):
//   status === 'Active' || 'Closed'  → 'win'
//   status === 'Rejected'            → 'loss'
//   status === 'Bidding'             → 'pending'
//
// Bucket-by date: we use createdDate (when the bid was placed) — NOT decision
// date, because Knowify exports don't reliably expose decision date. So a
// month's win rate = "of bids created in this month, what fraction has been
// won so far". This is a cohort view, which is more interpretable than
// decision-date view (where decisions cluster lumpily).
//
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

  function _outcomeFor(status) {
    if (status === 'Active' || status === 'Closed') return 'win';
    if (status === 'Rejected') return 'loss';
    return 'pending'; // Bidding (or anything unknown) → pending
  }

  // Knowify "Project - Location - Company" naming. Last segment = GC.
  // Falls back to job.client when the name doesn't follow the pattern.
  function _extractGC(j) {
    if (!j) return null;
    const name = (j.jobName || j.name || '').toString().trim();
    if (name) {
      const parts = name.split(' - ').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) return parts[parts.length - 1];
    }
    return j.client || null;
  }

  // Apply alias resolution via the user-curated live store (with legacy
  // fallback). Safe even when GCAliases isn't loaded yet.
  function _resolve(rawName) {
    if (typeof window !== 'undefined' && window.GCAliases && typeof window.GCAliases.resolveGCName === 'function') {
      return window.GCAliases.resolveGCName(rawName);
    }
    if (typeof window !== 'undefined' && typeof window.canonicalGCName === 'function') {
      return window.canonicalGCName(rawName);
    }
    return rawName;
  }

  // Normalize the Knowify jobs object into a flat list this engine consumes.
  function normalizeJobs(jobsObj, opts) {
    opts = opts || {};
    if (!jobsObj) return [];
    const sheets = ['Active', 'Closed', 'Bidding', 'Rejected'];
    const out = [];
    sheets.forEach(function (s) {
      const arr = jobsObj[s] || [];
      arr.forEach(function (j) {
        const rawGC = _extractGC(j);
        if (!rawGC) return;
        const gc = _resolve(rawGC);
        const cd = _toDate(j.createdDate);
        out.push({
          jobName: j.jobName || j.name || '',
          rawGC: rawGC,
          gc: gc,
          outcome: _outcomeFor(j.status || s),
          status:  j.status || s,
          cv:      +j.contractTotal || 0,
          createdDate: cd ? cd.toISOString().slice(0, 10) : null,
          ym:      cd ? _ymKey(cd) : null,
          state:   j.state || null,
          salesLead: j.salesLead || null,
        });
      });
    });
    return out;
  }

  // All-time win-rate aggregation by GC. Pending bids excluded from rate.
  // Note: PlanHub gets flagged but NOT excluded — caller decides whether to
  // exclude (per CONTEXT.md, PlanHub's 0% is a Knowify reporting artifact).
  function byGCAllTime(jobs, opts) {
    opts = opts || {};
    const excludeArtifact = opts.excludeArtifact !== false; // default true
    const map = {};
    jobs.forEach(function (j) {
      if (!j.gc) return;
      const k = j.gc;
      if (!map[k]) {
        map[k] = {
          gc: k, bids: 0, wins: 0, losses: 0, pending: 0,
          wonCV: 0, lostCV: 0, pendingCV: 0,
          isArtifact: /^planhub$/i.test(k),
        };
      }
      map[k].bids++;
      if (j.outcome === 'win')      { map[k].wins++;    map[k].wonCV    += j.cv; }
      else if (j.outcome === 'loss'){ map[k].losses++;  map[k].lostCV   += j.cv; }
      else                          { map[k].pending++; map[k].pendingCV+= j.cv; }
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
      return r;
    }).filter(function (r) { return excludeArtifact ? !r.isArtifact : true; });
    rows.sort(function (a, b) { return b.bids - a.bids; });
    return rows;
  }

  // Classify into Win-Rate Tiers per user's spec:
  //   T1: ≥70% WR, ≥minBids decided
  //   T2: 30-69%
  //   T3: 1-29%
  //   T0: 0% (separated out from T3)
  //   belowSample: <minBids decided
  // Default minBids = 5.
  function classifyTiers(byGC, opts) {
    opts = opts || {};
    const minBids = opts.minBids != null ? opts.minBids : 5;
    const useDollar = !!opts.useDollar;
    const T1 = [], T2 = [], T3 = [], T0 = [], belowSample = [];
    (byGC || []).forEach(function (r) {
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
    const sumBids = function (a) { return a.reduce(function (s, r) { return s + (r.bids || 0); }, 0); };
    const sumWonCV = function (a) { return a.reduce(function (s, r) { return s + (r.wonCV || 0); }, 0); };
    const sumPendCV = function (a) { return a.reduce(function (s, r) { return s + (r.pendingCV || 0); }, 0); };
    return {
      T1: T1, T2: T2, T3: T3, T0: T0, belowSample: belowSample,
      counts: {
        T1: T1.length, T2: T2.length, T3: T3.length, T0: T0.length, belowSample: belowSample.length,
      },
      summary: {
        T1: { gcs: T1.length, bids: sumBids(T1), wonCV: sumWonCV(T1), pendingCV: sumPendCV(T1) },
        T2: { gcs: T2.length, bids: sumBids(T2), wonCV: sumWonCV(T2), pendingCV: sumPendCV(T2) },
        T3: { gcs: T3.length, bids: sumBids(T3), wonCV: sumWonCV(T3), pendingCV: sumPendCV(T3) },
        T0: { gcs: T0.length, bids: sumBids(T0), wonCV: sumWonCV(T0), pendingCV: sumPendCV(T0) },
        minBids: minBids,
        useDollar: useDollar,
      },
    };
  }

  // Build a monthly time-series for win-rate-over-time analysis.
  // Window is anchored at `asOf` (default: today), going back `lookbackMonths`
  // months (default: 12).
  // Returns:
  //   {
  //     months: [{ym: '2025-05', label: 'May 2025', start, end}, ...],
  //     byGC:   { gcName: {
  //                 gc, totalBids, totalWins, totalLosses, totalPending,
  //                 monthly: { ym: { wins, losses, pending, wr } },
  //                 series:  [ {ym, wr, decided}, ... ]   // aligned with `months` for charting
  //              } }
  //   }
  function monthlySeries(jobs, opts) {
    opts = opts || {};
    const asOf = _toDate(opts.asOf) || new Date();
    asOf.setHours(0, 0, 0, 0);
    const lookback = opts.lookbackMonths || 12;
    const minBids = opts.minBidsForSeries != null ? opts.minBidsForSeries : 0;

    // Build month windows, oldest first.
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
      // Compute per-month WR + aligned series.
      g.series = months.map(function (m) {
        const cell = g.monthly[m.ym] || { wins: 0, losses: 0, pending: 0 };
        const decided = cell.wins + cell.losses;
        const wr = decided > 0 ? +(cell.wins / decided * 100).toFixed(1) : null;
        return { ym: m.ym, wins: cell.wins, losses: cell.losses, pending: cell.pending, wr: wr, decided: decided };
      });
      const decTotal = g.totalWins + g.totalLosses;
      g.windowWR = decTotal > 0 ? +(g.totalWins / decTotal * 100).toFixed(1) : null;
    });

    // Optionally drop GCs with too few bids in window for cleaner charting.
    if (minBids > 0) {
      Object.keys(byGC).forEach(function (k) {
        if (byGC[k].totalBids < minBids) delete byGC[k];
      });
    }

    return { asOf: asOf.toISOString().slice(0, 10), lookbackMonths: lookback, months: months, byGC: byGC };
  }

  // Compare two windows and return GCs whose tier changed.
  // jobsCurr / jobsPrev are normalized (from normalizeJobs) — caller can pre-filter
  // to a date window. Each shift entry: {gc, prevTier, currTier, prevBids, currBids, prevWR, currWR, delta}
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

  // Filter normalized jobs to a date window (inclusive on both ends).
  // Bids without a valid createdDate are excluded.
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
      normalizeJobs: normalizeJobs,
      byGCAllTime: byGCAllTime,
      classifyTiers: classifyTiers,
      monthlySeries: monthlySeries,
      tierShift: tierShift,
      filterByWindow: filterByWindow,
    };
  }
})();
