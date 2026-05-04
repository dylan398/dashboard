// ════════════════════════════════════════════════════════════════════════
// GC Exclusion Store
// ════════════════════════════════════════════════════════════════════════
//
// Some "GC names" extracted from Knowify aren't actually general contractors:
//   • Semper Fi Striping itself (the company we are)
//   • Vendor names that crept in (2H Striping)
//   • Location strings extracted as the last "-" segment ("Dallas, TX")
//   • Project descriptors ("Phase 1", "Change Order", "Package A")
//
// These pollute the win-rate analysis by adding rows that aren't real GCs.
// This module persists the user's "drop these" decisions in Firebase so
// they apply consistently across sessions.
//
// Storage: dashboard/gc-exclusions/<safeKey> = {
//   name, normName, note, ts, key
// }
//
// Surfaced via window.GCExclusions:
//   • loadExclusions() / onChange(cb) — Firebase live wiring.
//   • addExclusion({ name, note }) — persists.
//   • removeExclusion(key) — drops.
//   • listExclusions() — returns Array sorted by recency.
//   • isExcluded(name) — boolean test (used by winrate-engine).
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let _excl = {};
  let _normSet = new Set(); // fast lookup
  let _initialized = false;
  const _changeListeners = [];

  function norm(s) {
    return (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function _path() { return 'dashboard/gc-exclusions'; }

  function _rebuildSet() {
    _normSet = new Set();
    Object.values(_excl).forEach(function (e) {
      if (e && e.normName) _normSet.add(e.normName);
    });
  }

  function _emit() {
    _rebuildSet();
    _changeListeners.forEach(function (cb) { try { cb(_excl); } catch (e) { console.error(e); } });
  }

  async function loadExclusions() {
    if (typeof DB === 'undefined') return {};
    try {
      const data = await DB.read(_path());
      _excl = data || {};
      _initialized = true;
      _emit();
      return _excl;
    } catch (e) {
      console.warn('GCExclusions.loadExclusions failed:', e);
      _excl = {};
      _initialized = true;
      return {};
    }
  }

  function _watch() {
    if (typeof getDB !== 'function') return;
    try {
      getDB().ref(_path()).on('value', function (snap) {
        _excl = snap.val() || {};
        _initialized = true;
        _emit();
      });
    } catch (e) { console.warn('GCExclusions._watch failed:', e); }
  }

  async function addExclusion(input) {
    if (typeof DB === 'undefined') throw new Error('DB unavailable');
    input = input || {};
    if (!input.name) throw new Error('name required');
    const name = String(input.name).trim();
    const normName = norm(name);
    if (!normName) throw new Error('name normalized to empty');
    const key = normName.slice(0, 700);
    const entry = {
      name: name,
      normName: normName,
      note: String(input.note || ''),
      ts: new Date().toISOString(),
      key: key,
    };
    await DB.update(_path() + '/' + key, entry);
    _excl[key] = entry;
    _emit();
    return key;
  }

  async function removeExclusion(key) {
    if (typeof DB === 'undefined') throw new Error('DB unavailable');
    if (!key) return;
    await DB.set(_path() + '/' + key, null);
    delete _excl[key];
    _emit();
  }

  function listExclusions() {
    return Object.values(_excl).sort(function (a, b) { return (b.ts || '').localeCompare(a.ts || ''); });
  }

  function isExcluded(name) {
    if (!name) return false;
    return _normSet.has(norm(name));
  }

  function onChange(cb) {
    _changeListeners.push(cb);
    if (_initialized) cb(_excl);
    return function () {
      const i = _changeListeners.indexOf(cb);
      if (i >= 0) _changeListeners.splice(i, 1);
    };
  }

  if (typeof window !== 'undefined') {
    window.GCExclusions = {
      loadExclusions: loadExclusions,
      addExclusion:   addExclusion,
      removeExclusion: removeExclusion,
      listExclusions: listExclusions,
      isExcluded:     isExcluded,
      onChange:       onChange,
      norm:           norm,
    };
    if (typeof getDB === 'function') {
      try { _watch(); } catch (e) { /* offline tolerant */ }
    } else {
      const _t = setInterval(function () {
        if (typeof getDB === 'function') { clearInterval(_t); _watch(); }
      }, 200);
      setTimeout(function () { clearInterval(_t); }, 10000);
    }
  }
})();
