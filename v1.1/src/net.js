// Firebase RTDB multiplayer: presence, open room (max 3), host-driven run flow, leaderboard.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDFfGva2KVHVOVFdDHOwlN_Z2jlJlg_C6M",
  authDomain: "gzowo-bowling.firebaseapp.com",
  databaseURL: "https://gzowo-bowling-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "gzowo-bowling",
  storageBucket: "gzowo-bowling.firebasestorage.app",
  messagingSenderId: "322038374810",
  appId: "1:322038374810:web:8b8dc8fb0403923d70da23"
};

const CDN = 'https://www.gstatic.com/firebasejs/10.12.2/';
const ROOM = 'rooms/cruise-control';
const MAX_PLAYERS = 3;
const ACTIVE_MS = 75000;      // peer active if heartbeat within 75s (hidden tabs throttle timers to 1/min)
const HEARTBEAT_MS = 3000;
const COUNTDOWN_MS = 20000;
const INIT_TIMEOUT_MS = 4000;

export class Net {
  constructor(levelCount) {
    this.levelCount = levelCount;
    this.online = false;
    this.joined = false;
    this.pid = null;
    this.playersRaw = {};
    this.run = null;
    this.leaderboard = [];
    this.offset = 0;          // serverTimeOffset
    this.onRun = null;
    this.onPlayers = null;
    this.onLeaderboard = null;
    this.fb = null;
    this._hb = null;
    this._tick = null;
    this._meRef = null;
  }

  now() { return Date.now() + this.offset; }

  // Load SDK + probe connectivity; on any failure within 4s → stay offline.
  async init() {
    const load = (async () => {
      const [appM, dbM] = await Promise.all([
        import(CDN + 'firebase-app.js'),
        import(CDN + 'firebase-database.js')
      ]);
      const app = appM.initializeApp(FIREBASE_CONFIG);
      const db = dbM.getDatabase(app);
      this.fb = {
        db,
        ref: dbM.ref, set: dbM.set, update: dbM.update, remove: dbM.remove,
        get: dbM.get, onValue: dbM.onValue, onDisconnect: dbM.onDisconnect,
        serverTimestamp: dbM.serverTimestamp, runTransaction: dbM.runTransaction
      };
      await this.fb.get(this.fb.ref(db, ROOM + '/run')); // reachability probe
    })();
    await Promise.race([
      load,
      new Promise((_, rej) => setTimeout(() => rej(new Error('net init timeout')), INIT_TIMEOUT_MS))
    ]);
    const f = this.fb;
    f.onValue(f.ref(f.db, '.info/serverTimeOffset'), s => { this.offset = s.val() || 0; }, () => {});
    f.onValue(f.ref(f.db, ROOM + '/players'), s => {
      this.playersRaw = s.val() || {};
      if (this.onPlayers) this.onPlayers(this.activePlayers());
    }, () => {});
    f.onValue(f.ref(f.db, ROOM + '/run'), s => {
      this.run = s.val();
      if (this.onRun) this.onRun(this.run);
    }, () => {});
    f.onValue(f.ref(f.db, ROOM + '/leaderboard'), s => {
      const raw = s.val() || {};
      this.leaderboard = Object.values(raw)
        .filter(e => e && typeof e.levels === 'number')
        .sort((a, b) => b.levels - a.levels)
        .slice(0, 8);
      if (this.onLeaderboard) this.onLeaderboard(this.leaderboard);
    }, () => {});
    this.online = true;
  }

  // Active players sorted by pid (host = first).
  activePlayers() {
    const t = this.now();
    return Object.entries(this.playersRaw)
      .filter(([, p]) => p && typeof p.t === 'number' && t - p.t < ACTIVE_MS)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  roomFullFor(pid) {
    const act = this.activePlayers();
    return act.length >= MAX_PLAYERS &&
      !act.some(p => p.id === pid || p.id.startsWith(pid + '-'));
  }

  isHost() {
    if (!this.joined) return false;
    const act = this.activePlayers();
    return act.length > 0 && act[0].id === this.pid;
  }

  // pid: stable id (leaderboard identity). Presence uses an ephemeral per-tab id
  // so two tabs of the same browser count as two players.
  async join(pid, name, color) {
    if (!this.online) return false;
    this.lbKey = pid;
    if (!this._tabId) this._tabId = Math.random().toString(36).slice(2, 6);
    this.pid = pid + '-' + this._tabId;
    const f = this.fb;
    this._meRef = f.ref(f.db, `${ROOM}/players/${this.pid}`);
    f.onDisconnect(this._meRef).remove();
    await f.set(this._meRef, {
      name, color, level: 0, phase: 'level', lying: 0, dead: 0,
      p: [0, 0, 0], q: [0, 0, 0, 1], th: 0, t: f.serverTimestamp()
    });
    this.joined = true;
    this._hb = setInterval(() => {
      if (this.joined) f.update(this._meRef, { t: f.serverTimestamp() }).catch(() => {});
    }, HEARTBEAT_MS);
    this._tick = setInterval(() => this._hostTick(), 1000);
    // fresh run if none, stale-complete, or nobody else active
    const othersActive = this.activePlayers().some(p => p.id !== this.pid);
    if (!this.run || typeof this.run.level !== 'number' ||
        this.run.phase === 'complete' || !othersActive) {
      this.resetRun();
    }
    return true;
  }

  leave() {
    if (!this.joined) return;
    this.joined = false;
    clearInterval(this._hb); this._hb = null;
    clearInterval(this._tick); this._tick = null;
    const f = this.fb;
    try {
      f.onDisconnect(this._meRef).cancel();
      f.remove(this._meRef).catch(() => {});
    } catch (e) { /* offline */ }
  }

  // Partial update of own player node (position, phase, flags). Throttled by caller.
  sendState(st) {
    if (!this.joined) return;
    this.fb.update(this._meRef, st).catch(() => {});
  }

  resetRun() {
    this._writeRun({ level: 0, phase: 'level', startedAt: this.now() });
  }

  _writeRun(r) {
    const f = this.fb;
    this.run = r; // optimistic local copy
    f.set(f.ref(f.db, ROOM + '/run'), r).catch(() => {});
  }

  // Host duties: start countdown when everyone is in the playground, advance level after it.
  _hostTick() {
    if (!this.joined || !this.isHost()) return;
    const run = this.run;
    const act = this.activePlayers();
    if (!run || typeof run.level !== 'number' || !run.phase) {
      this.resetRun();
      return;
    }
    if (run.phase === 'level') {
      if (act.length > 0 && act.every(p => p.phase === 'playground')) {
        this._writeRun({
          level: run.level, phase: 'countdown',
          countdownEnd: this.now() + COUNTDOWN_MS, startedAt: run.startedAt || this.now()
        });
      }
    } else if (run.phase === 'countdown') {
      if (this.now() >= (run.countdownEnd || 0)) {
        const next = run.level + 1;
        if (next >= this.levelCount) {
          this._writeRun({ level: 0, phase: 'complete', completedAt: this.now() });
        } else {
          this._writeRun({ level: next, phase: 'level', startedAt: this.now() });
        }
      }
    }
  }

  // All-time best "levels cleared in one run" — write-if-greater.
  reportClear(name, levels) {
    if (!this.joined) return;
    const f = this.fb;
    const r = f.ref(f.db, `${ROOM}/leaderboard/${this.lbKey || this.pid}`);
    f.runTransaction(r, cur => {
      if (!cur || levels > (cur.levels || 0)) return { name, levels };
      return cur;
    }).catch(() => {});
  }
}
