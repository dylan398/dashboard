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

const DB = {
  async write(key, data) {
    await getDB().ref('dashboard/' + key).set({ ...data, _updatedAt: new Date().toISOString() });
  },
  async read(key) {
    const snap = await getDB().ref('dashboard/' + key).once('value');
    return snap.val();
  },
  async readAll() {
    const snap = await getDB().ref('dashboard').once('value');
    return snap.val() || {};
  },
  onValue(key, cb) {
    getDB().ref('dashboard/' + key).on('value', snap => cb(snap.val()));
  },
  onAll(cb) {
    getDB().ref('dashboard').on('value', snap => cb(snap.val() || {}));
  }
};
