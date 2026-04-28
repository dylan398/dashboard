const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCMMBFQEHTHnI4fxU_0C11kCkTaLDBJEJs",
  authDomain: "sfs-scheduler.firebaseapp.com",
  databaseURL: "https://sfs-scheduler-default-rtdb.firebaseio.com",
  projectId: "sfs-scheduler",
  storageBucket: "sfs-scheduler.firebasestorage.app",
  messagingSenderId: "183656336505",
  appId: "1:183656336505:web:48ec0547091636ab5158a8"
};

let _db = null;
function getDB() {
  if (!_db) {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    _db = firebase.database();
  }
  return _db;
}

// Sanitize: Firebase rejects undefined values
function sanitize(obj) {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const sv = sanitize(v);
    if (sv !== undefined) out[k] = sv;
  }
  return out;
}

// Safe Firebase key: replace characters not allowed in keys
function safeKey(str) {
  return String(str).replace(/[.$[\]#/]/g, '_').replace(/\s+/g, '_').slice(0, 768);
}

const DB = {
  // Full replace at a path (used internally)
  async set(path, data) {
    await getDB().ref(path).set(sanitize(data));
  },

  // Shallow merge at a path (preserves sibling keys)
  async update(path, data) {
    await getDB().ref(path).update(sanitize(data));
  },

  // Read a path
  async read(path) {
    const snap = await getDB().ref(path).once('value');
    return snap.val();
  },

  // ── STRATEGY: PERIOD ──────────────────────────────────────────
  // Stores data keyed by period. Overwrites same period, preserves others.
  // Path: dashboard/[datasetId]/periods/[periodKey]
  // Also keeps a pointer at dashboard/[datasetId]/latest -> periodKey
  async writePeriod(datasetId, periodKey, data) {
    const key = safeKey(periodKey);
    const base = `dashboard/${datasetId}`;
    const updates = {};
    updates[`${base}/periods/${key}`] = sanitize({ ...data, _periodKey: key, _savedAt: new Date().toISOString() });
    updates[`${base}/latest`] = key;
    await getDB().ref().update(updates);
  },

  async readLatestPeriod(datasetId) {
    const base = `dashboard/${datasetId}`;
    const latestKey = await this.read(`${base}/latest`);
    if (!latestKey) return null;
    return this.read(`${base}/periods/${latestKey}`);
  },

  async readAllPeriods(datasetId) {
    const data = await this.read(`dashboard/${datasetId}/periods`);
    if (!data) return {};
    return data;
  },

  // ── STRATEGY: SNAPSHOT ───────────────────────────────────────
  // Every snapshot stored forever, keyed by its as-of date.
  // Path: dashboard/[datasetId]/snapshots/[dateKey]
  async writeSnapshot(datasetId, dateKey, data) {
    const key = safeKey(dateKey);
    await this.set(`dashboard/${datasetId}/snapshots/${key}`,
      sanitize({ ...data, _dateKey: key, _savedAt: new Date().toISOString() }));
    // Also update latest pointer
    const existing = await this.read(`dashboard/${datasetId}/latestDate`);
    if (!existing || key > existing) {
      await getDB().ref(`dashboard/${datasetId}/latestDate`).set(key);
    }
  },

  async readLatestSnapshot(datasetId) {
    const latestDate = await this.read(`dashboard/${datasetId}/latestDate`);
    if (!latestDate) return null;
    return this.read(`dashboard/${datasetId}/snapshots/${latestDate}`);
  },

  async readAllSnapshots(datasetId) {
    const data = await this.read(`dashboard/${datasetId}/snapshots`);
    if (!data) return {};
    return data;
  },

  // ── STRATEGY: MERGE ──────────────────────────────────────────
  // For time-series data: merges new records into existing.
  // Uses Firebase update() so only touched keys change.
  //
  // For Sales: merges monthlyByYear, topCustomers, topServices
  // For Transactions: merges accountSummary
  // For Knowify: merges job records, updates summary
  async mergeSalesData(newData) {
    const base = 'dashboard/qbo-sales';
    const existing = await this.read(base) || {};

    // Merge monthlyByYear: newer data wins per month
    const merged = JSON.parse(JSON.stringify(existing.monthlyByYear || {}));
    Object.entries(newData.monthlyByYear || {}).forEach(([yr, months]) => {
      if (!merged[yr]) merged[yr] = new Array(12).fill(0);
      months.forEach((v, i) => {
        if (v && v > 0) merged[yr][i] = v; // newer upload overwrites
      });
    });

    // Rebuild annual totals from merged monthly
    const annualTotals = {};
    Object.entries(merged).forEach(([yr, months]) => {
      annualTotals[yr] = +months.reduce((s, v) => s + (v || 0), 0).toFixed(2);
    });

    // Merge customers: sum across all uploads, keep highest per customer
    const custMap = {};
    (existing.topCustomers || []).forEach(c => { custMap[c.name] = c; });
    (newData.topCustomers || []).forEach(c => {
      if (!custMap[c.name] || c.total > custMap[c.name].total) custMap[c.name] = c;
    });
    const topCustomers = Object.values(custMap).sort((a, b) => b.total - a.total).slice(0, 25);

    // Merge services: same logic
    const svcMap = {};
    (existing.topServices || []).forEach(s => { svcMap[s.name] = s; });
    (newData.topServices || []).forEach(s => {
      if (!svcMap[s.name] || s.amount > svcMap[s.name].amount) svcMap[s.name] = s;
    });
    const topServices = Object.values(svcMap).sort((a, b) => b.amount - a.amount).slice(0, 20);

    const totalRevenue = +Object.values(annualTotals).reduce((s, v) => s + v, 0).toFixed(2);

    const merged_data = sanitize({
      monthlyByYear: merged,
      annualTotals,
      topCustomers,
      topServices,
      totalRevenue,
      meta: { ...newData.meta, mergedAt: new Date().toISOString() }
    });
    await this.set(base, merged_data);
    // Also archive the upload
    const key = safeKey(newData.meta?.period || new Date().toISOString().slice(0,10));
    await this.set(`dashboard/qbo-sales-history/${key}`, sanitize({ _savedAt: new Date().toISOString(), period: newData.meta?.period }));
  },

  async mergeTransactionData(newData) {
    const base = 'dashboard/qbo-transactions';
    const existing = await this.read(base) || {};
    const existingAccts = (existing.accountSummary || []).reduce((m, a) => { m[a.name] = a; return m; }, {});
    (newData.accountSummary || []).forEach(a => {
      // Newer upload wins (more complete data assumed)
      existingAccts[a.name] = a;
    });
    const merged = sanitize({
      accountSummary: Object.values(existingAccts).sort((a,b) => Math.abs(b.total)-Math.abs(a.total)),
      accountDetail: { ...(existing.accountDetail||{}), ...(newData.accountDetail||{}) },
      meta: { ...newData.meta, mergedAt: new Date().toISOString() }
    });
    await this.set(base, merged);
  },

  async mergeKnowifyData(newData) {
    const base = 'dashboard/knowify-jobs';
    // Always write the summary fresh (it reflects current state)
    // Archive dated snapshot too
    await this.set(base, sanitize(newData));
    const key = safeKey(newData.meta?.parsedAt?.slice(0, 10) || new Date().toISOString().slice(0,10));
    await this.set(`dashboard/knowify-history/${key}`, sanitize({
      summary: newData.summary,
      topClients: newData.topClients,
      _savedAt: new Date().toISOString()
    }));
  },

  // ── META ───────────────────────────────────────────────────────
  async writeMeta(datasets) {
    await this.set('dashboard/meta', sanitize({
      lastUpdated: new Date().toISOString(),
      datasets,
      updatedBy: 'admin'
    }));
  },

  // ── READS FOR DASHBOARD ────────────────────────────────────────
  async readAll() {
    const snap = await getDB().ref('dashboard').once('value');
    return snap.val() || {};
  },

  onAll(cb) {
    getDB().ref('dashboard').on('value', snap => cb(snap.val() || {}));
  },

  // Legacy compat
  async write(key, data) {
    await this.set('dashboard/' + key, sanitize(data));
  },
  async readLegacy(key) {
    return this.read('dashboard/' + key);
  },

  onValue(key, cb) {
    getDB().ref('dashboard/' + key).on('value', snap => cb(snap.val()));
  }
};
