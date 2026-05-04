// ════════════════════════════════════════════════════════════════════════
// GC Alias Resolution + Persistence
// ════════════════════════════════════════════════════════════════════════
//
// Knowify lets users type GC names freely, so the same company shows up
// under slightly different spellings ("JPI" vs "JPI Companies", "Acme
// LLC" vs "Acme"). Without resolution, win-rate analysis fragments their
// performance across multiple rows and gives noisy, low-sample numbers.
//
// This module:
//   • Loads + caches alias decisions from Firebase (path: dashboard/gc-aliases).
//   • Detects likely overlaps using normalized name + Levenshtein +
//     token-set Jaccard similarity. Returns ranked candidate pairs.
//   • Resolves a raw GC name to its canonical primary name, applying both
//     the static gc-segmentation.js ALIASES (legacy) and the live
//     Firebase aliases (user-curated). Live takes precedence.
//   • Persists user accept/reject decisions so the same pair is never
//     surfaced twice.
//
// Alias entry shape:
//   { primary, alias, status, ts, key, note? }
//   status: 'accepted' (same GC) | 'rejected' (NOT same) | 'manual' (user-created, treated as accepted)
//
// Surfaced via window.GCAliases — pages access through that.
// Used by reports/winrates.html and (optionally) future pages.
//
// CONTEXT.md §8.0 reminder: this is a *descriptive cleanup* utility, not
// an action generator. Don't surface "merge these GCs" as an alarm card.
//
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let _aliases = {};            // keyed by Firebase-safe key, in-memory cache
  let _initialized = false;
  const _changeListeners = [];

  // ── Normalization (matches gc-segmentation.js _norm for compatibility) ──
  function norm(s) {
    return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  // Memoization cache for stripSuffixes — same names recur in many similarity
  // comparisons during findOverlaps; caching saves ~6× repeated work per pair.
  const _stripCache = new Map();

  // Strip common business suffixes for fuzzier matching.
  // "Smith Construction LLC" → "smith construction"
  function stripSuffixes(s) {
    if (!s) return '';
    if (_stripCache.has(s)) return _stripCache.get(s);
    let out = s.toString().toLowerCase().trim();
    const SUFFIXES = [
      ', inc.', ', inc', ' inc.', ' inc',
      ', llc.', ', llc', ' llc.', ' llc',
      ', l.l.c.', ' l.l.c.',
      ', ltd.', ', ltd', ' ltd.', ' ltd',
      ', co.', ', co', ' co.', ' co',
      ', corp.', ', corp', ' corp.', ' corp',
      ', corporation', ' corporation',
      ', companies', ' companies', ', company', ' company',
      ', group', ' group',
      ', construction', ' construction',
      ', contractors', ' contractors', ', contractor', ' contractor',
      ', builders', ' builders',
      ', services', ' services',
      ', development', ' development',
      ', general contractors', ' general contractors',
      ', general contractor', ' general contractor',
    ];
    let changed = true;
    while (changed) {
      changed = false;
      for (const suf of SUFFIXES) {
        if (out.endsWith(suf)) { out = out.slice(0, -suf.length).trim(); changed = true; }
      }
    }
    out = out.replace(/\s+/g, ' ').trim();
    _stripCache.set(s, out);
    return out;
  }

  // Token-set Jaccard: |A ∩ B| / |A ∪ B| over space-separated words.
  function tokenJaccard(a, b) {
    const ta = new Set(stripSuffixes(a).split(/\s+/).filter(t => t.length > 1));
    const tb = new Set(stripSuffixes(b).split(/\s+/).filter(t => t.length > 1));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    const union = ta.size + tb.size - inter;
    return union ? inter / union : 0;
  }

  // Levenshtein distance, normalized to similarity (0..1).
  function levenshteinSim(a, b) {
    a = stripSuffixes(a); b = stripSuffixes(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const m = a.length, n = b.length;
    if (Math.abs(m - n) / Math.max(m, n) > 0.5) return 0; // length too different
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    const dist = dp[m][n];
    return 1 - dist / Math.max(m, n);
  }

  // Combined similarity score 0..1.
  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (norm(a) === norm(b)) return 1;
    if (stripSuffixes(a) === stripSuffixes(b)) return 0.97;
    const lev = levenshteinSim(a, b);
    const tok = tokenJaccard(a, b);
    return 0.45 * lev + 0.55 * tok;
  }

  // ── Firebase wiring ─────────────────────────────────────────────────
  function _path() { return 'dashboard/gc-aliases'; }

  function _emit() {
    _changeListeners.forEach(cb => { try { cb(_aliases); } catch (e) { console.error(e); } });
  }

  async function loadAliases() {
    if (typeof DB === 'undefined') return {};
    try {
      const data = await DB.read(_path());
      _aliases = data || {};
      _initialized = true;
      _emit();
      return _aliases;
    } catch (e) {
      console.warn('GCAliases.loadAliases failed:', e);
      _aliases = {};
      _initialized = true;
      return {};
    }
  }

  function _watchAliases() {
    if (typeof getDB !== 'function') return;
    try {
      getDB().ref(_path()).on('value', snap => {
        _aliases = snap.val() || {};
        _initialized = true;
        _emit();
      });
    } catch (e) { console.warn('GCAliases._watchAliases failed:', e); }
  }

  function _makeKey(a, b) {
    // Order-insensitive key so {A, B} and {B, A} hash the same way.
    const n1 = norm(a), n2 = norm(b);
    return [n1, n2].sort().join('__').slice(0, 700);
  }

  // Add or update an alias decision.
  async function addAlias({ primary, alias, status, note }) {
    if (typeof DB === 'undefined') throw new Error('DB unavailable');
    if (!primary || !alias) throw new Error('primary and alias required');
    const key = _makeKey(primary, alias);
    const entry = {
      primary: String(primary).trim(),
      alias:   String(alias).trim(),
      status:  status || 'accepted',
      note:    String(note || ''),
      ts:      new Date().toISOString(),
      key,
    };
    await DB.update(_path() + '/' + key, entry);
    _aliases[key] = entry;
    _emit();
    return key;
  }

  async function deleteAlias(key) {
    if (typeof DB === 'undefined') throw new Error('DB unavailable');
    if (!key) return;
    await DB.set(_path() + '/' + key, null);
    delete _aliases[key];
    _emit();
  }

  function listAliases() {
    return Object.values(_aliases).sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  }

  function getStatusFor(a, b) {
    const k = _makeKey(a, b);
    return _aliases[k] ? _aliases[k].status : null;
  }

  function onChange(cb) {
    _changeListeners.push(cb);
    if (_initialized) cb(_aliases);
    return () => {
      const i = _changeListeners.indexOf(cb);
      if (i >= 0) _changeListeners.splice(i, 1);
    };
  }

  // ── Resolution ─────────────────────────────────────────────────────
  // Walk accepted aliases to find the canonical primary. Two layers:
  //   1. Live Firebase aliases — user-curated (takes precedence).
  //   2. Static map in gc-segmentation.js (canonicalGCName) — legacy.
  function resolveGCName(rawName) {
    if (!rawName) return rawName;
    let name = String(rawName).trim();
    // Walk live aliases (chain bound to 5 hops to avoid loops).
    for (let hop = 0; hop < 5; hop++) {
      const candidates = Object.values(_aliases).filter(a =>
        a.status !== 'rejected' &&
        norm(a.alias) === norm(name) &&
        norm(a.primary) !== norm(name)
      );
      if (!candidates.length) break;
      candidates.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
      name = candidates[0].primary;
    }
    if (typeof window !== 'undefined' && typeof window.canonicalGCName === 'function') {
      return window.canonicalGCName(name);
    }
    return name;
  }

  // ── Overlap detection ──────────────────────────────────────────────
  // Returns ranked candidate pairs: [{a, b, score, reason, aBids, bBids}, ...]
  //
  // PERFORMANCE: With ~2.5K unique GC names the naive O(n²) is 3M pairs and
  // takes ~38s — the page-freeze cause. Optimizations:
  //   1. Pre-compute stripped + tokens + first-char per name (O(n) one-shot,
  //      avoids 4-6 stripSuffixes calls per pair).
  //   2. Block by first character of stripped name. Names starting with
  //      different letters are vanishingly rare to be the same company,
  //      and blocking shrinks 3M pairs → ~150K pairs (~25× speedup).
  //   3. Length pre-filter: skip pairs where stripped lengths differ by > 50%.
  //   4. Token quick-reject: zero token overlap AND length gap > 5 → skip.
  // Net: ~38s → < 1s on the same dataset.
  function findOverlaps(byGC, opts) {
    opts = opts || {};
    const minScore = opts.minScore != null ? opts.minScore : 0.78;
    const maxResults = opts.maxResults || 50;
    if (!byGC || !byGC.length) return [];

    // 1. Pre-compute per-name structure once.
    const items = byGC
      .slice()
      .sort(function (a, b) { return (b.bids || 0) - (a.bids || 0); })
      .filter(function (r) { return r && r.gc; })
      .map(function (r) {
        const stripped = stripSuffixes(r.gc);
        const normName = norm(r.gc);
        const tokens = new Set(stripped.split(/\s+/).filter(function (t) { return t.length > 1; }));
        return {
          gc: r.gc,
          bids: r.bids || 0,
          stripped: stripped,
          normName: normName,
          tokens: tokens,
          firstChar: stripped.charAt(0) || '_',
          len: stripped.length,
        };
      });

    // 2. Block by first character of stripped name.
    const blocks = {};
    items.forEach(function (it) {
      const k = it.firstChar;
      if (!blocks[k]) blocks[k] = [];
      blocks[k].push(it);
    });

    // 3. Pairwise comparison within each block.
    const candidates = [];
    Object.keys(blocks).forEach(function (k) {
      const bucket = blocks[k];
      for (let i = 0; i < bucket.length; i++) {
        const A = bucket[i];
        for (let j = i + 1; j < bucket.length; j++) {
          const B = bucket[j];
          // Already-resolved or trivially identical
          if (A.normName === B.normName) continue;
          if (A.stripped === B.stripped) {
            // Identical after suffix strip — strong same-GC signal
            if (getStatusFor(A.gc, B.gc)) continue;
            candidates.push({ a: A.gc, b: B.gc, score: 0.97, reason: 'suffix-only diff', aBids: A.bids, bBids: B.bids });
            continue;
          }
          // Length pre-filter
          const maxLen = Math.max(A.len, B.len);
          if (maxLen > 0 && Math.abs(A.len - B.len) / maxLen > 0.5) continue;
          // Token quick-reject
          let tokenOverlap = 0;
          for (const t of A.tokens) {
            if (B.tokens.has(t)) { tokenOverlap++; if (tokenOverlap >= 2) break; }
          }
          if (tokenOverlap === 0 && Math.abs(A.len - B.len) > 5) continue;
          if (getStatusFor(A.gc, B.gc)) continue;
          // Full similarity (uses pre-stripped values for speed where it can)
          const score = similarity(A.gc, B.gc);
          if (score < minScore) continue;
          const reason = score >= 0.97 ? 'suffix-only diff'
                       : score >= 0.9  ? 'near-identical'
                       : score >= 0.83 ? 'token overlap'
                       : 'similar';
          candidates.push({ a: A.gc, b: B.gc, score: +score.toFixed(3), reason: reason, aBids: A.bids, bBids: B.bids });
        }
      }
    });

    candidates.sort(function (x, y) { return y.score - x.score; });
    return candidates.slice(0, maxResults);
  }

  // Initialize and expose.
  if (typeof window !== 'undefined') {
    window.GCAliases = {
      loadAliases, addAlias, deleteAlias, listAliases, getStatusFor,
      onChange, resolveGCName, findOverlaps, similarity, norm, stripSuffixes,
    };
    if (typeof getDB === 'function') {
      try { _watchAliases(); } catch (e) { /* offline tolerant */ }
    } else {
      const _t = setInterval(function () {
        if (typeof getDB === 'function') { clearInterval(_t); _watchAliases(); }
      }, 200);
      setTimeout(function () { clearInterval(_t); }, 10000);
    }
  }
})();
