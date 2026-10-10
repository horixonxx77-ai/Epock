/* Epock app: views, private storage, live Google Calendar sync and write-back of picks. */
(function () {
  'use strict';
  var E = window.EpockEngine, ICS = window.EpockICS;
  var SERVER = 'Google Calendar';
  var SETTINGS = 'epock/settings';
  var MARK = 'epock:';
  var LOC = 'en-US';
  var TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
  // Inside claude.ai there is no platform object; the Chrome app build supplies one (storage here, Google via the bridge).
  var PLAT = window.EpockPlatform || null, STANDALONE = !!(PLAT && PLAT.standalone);

  function $(s, el) { return (el || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function todayKey() { return E.dkey(new Date()); }
  function h12(h) { return (h % 12) || 12; }
  function hourName(h) { return h12(h) + (h < 12 ? ' AM' : ' PM'); }
  function dateLabel(k, o) { return E.k2d(k).toLocaleDateString(LOC, o || { weekday: 'short', month: 'short', day: 'numeric' }); }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : undefined; } catch (e) { return undefined; } }
  function lsSet(k, v) { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsKeys(prefix) { var out = []; try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf(prefix) === 0) out.push(k); } } catch (e) { /* none */ } return out; }
  function ago(ms) {
    var d = Date.now() - ms; if (d < 90000) return 'just now'; if (d < 3600000) return Math.round(d / 60000) + ' min ago';
    if (d < 86400000) return Math.round(d / 3600000) + ' h ago';
    return new Date(ms).toLocaleString(LOC, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function clock(ms) { var s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + E.pad(m % 60) : m) + ':' + E.pad(s % 60); }

  var CAT = { school: 'School', class: 'Classes', sleep: 'Sleep', care: 'Self-care', commute: 'Commute', gold: 'Gold', plan: 'Planned', ask: 'Needs a color', free: 'My time', holiday: 'Holiday', auto: 'Sort by title' };
  var PICK_CATS = [['school', 'School', 'school'], ['class', 'Classes', 'class'], ['sleep', 'Sleep', 'sleep'], ['care', 'Self-care', 'care'], ['commute', 'Commute', 'commute'], ['free', 'My time (gold)', 'gold']];
  var CAL_CATS = [['auto', 'Sort by title'], ['school', 'School'], ['class', 'Classes'], ['sleep', 'Sleep'], ['care', 'Self-care'], ['commute', 'Commute'], ['free', 'My time (gold)'], ['holiday', 'Holidays']];
  var LOGK = { bath: { name: 'Bathroom', em: '🚽' }, shower: { name: 'Shower', em: '🚿' }, eat: { name: 'Eating', em: '🍽️' } };
  var NIGHTS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var SHELVES = [['Night', '12–6 AM'], ['Morning', '6 AM–12 PM'], ['Afternoon', '12–6 PM'], ['Evening', '6 PM–12 AM']];
  var ICON = {
    coin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3.2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    setup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>'
  };

  var ALLDAYS = [0, 1, 2, 3, 4, 5, 6];
  var DEFAULTS = {
    v: 1,
    sleep: ALLDAYS.map(function () { return { bed: '23:00', wake: '07:00' }; }),
    school: { gap: 10, lunch: true, lunchMin: 25, lunchFrom: '11:00', lunchTo: '13:30' },
    routine: [
      { id: 'r-ready', name: 'Get ready', cat: 'care', at: 'wake', off: 0, dur: 20, when: 'any' },
      { id: 'r-breakfast', name: 'Breakfast', cat: 'care', at: 'wake', off: 20, dur: 20, when: 'any' },
      { id: 'r-lunch', name: 'Lunch', cat: 'care', at: 'fixed', time: '12:00', dur: 30, when: 'noschool' },
      { id: 'r-dinner', name: 'Dinner', cat: 'care', at: 'fixed', time: '18:30', dur: 30, when: 'any' },
      { id: 'r-shower', name: 'Shower', cat: 'care', at: 'bed', off: 0, dur: 20, when: 'any' }
    ],
    // Weekly trips (day: 0 = Sunday). "to" = to school, "from" = home from school; both only on school days.
    commute: [],
    commuteShift: 'office hour, swim',
    rules: [], cals: {}, overrides: {},
    wb: { on: false, cal: 'primary' },
    acts: [
      { id: 'a-hw', name: 'Homework', em: '📚' }, { id: 'a-study', name: 'Study', em: '📖' }, { id: 'a-code', name: 'Coding', em: '💻' },
      { id: 'a-music', name: 'Music', em: '🎸' }, { id: 'a-move', name: 'Exercise', em: '🏃' }, { id: 'a-read', name: 'Reading', em: '📕' },
      { id: 'a-games', name: 'Games', em: '🎮' }, { id: 'a-friends', name: 'Friends', em: '💬' }, { id: 'a-rest', name: 'Rest', em: '😌' }
    ]
  };
  function mergeSettings(doc) {
    var d = clone(DEFAULTS);
    if (doc && typeof doc === 'object') {
      Object.keys(doc).forEach(function (k) {
        var v = doc[k];
        if (v && typeof v === 'object' && !Array.isArray(v) && d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) d[k] = Object.assign(d[k], clone(v));
        else if (v !== undefined) d[k] = clone(v);
      });
    }
    if (!Array.isArray(d.sleep) || d.sleep.length !== 7) d.sleep = ALLDAYS.map(function (i) { return (d.sleep && d.sleep[i]) || { bed: '23:00', wake: '07:00' }; });
    ['routine', 'rules', 'acts', 'commute'].forEach(function (k) { if (!Array.isArray(d[k])) d[k] = clone(DEFAULTS[k]); });
    if (typeof d.commuteShift !== 'string') d.commuteShift = DEFAULTS.commuteShift;
    ['cals', 'overrides', 'wb', 'school'].forEach(function (k) { if (!d[k] || typeof d[k] !== 'object') d[k] = clone(DEFAULTS[k]) || {}; });
    return d;
  }

  /* ---------- Storage: private db for the owner, this browser otherwise ---------- */
  var DV = 0;
  function bump() { DV++; queueRender(); }
  var Store = {
    mode: 'boot', db: null, docs: Object.create(null), subs: Object.create(null), q: Object.create(null),
    colSub: null, readonly: false, notOwner: false, bootDirty: [], bootQueue: [],
    loaded: Object.create(null), waiters: Object.create(null), fetching: Object.create(null),
    get: function (p) { return this.docs[p]; },
    loadMirror: function () {
      var self = this;
      lsKeys('epock:m:').forEach(function (k) { var v = lsGet(k); if (v !== undefined) self.docs[k.slice(8)] = v; });
    },
    mirror: function (p) {
      if (this.mode !== 'db') return;
      var t = todayKey(), m = p.split('/')[1] || '';
      var near = p === SETTINGS || (/^(plans|logs|cache)\//.test(p) && (m === E.mkey(t) || m === E.mkey(E.addDays(t, 1)) || m === E.mkey(E.addDays(t, -7))));
      if (near) lsSet('epock:m:' + p, this.docs[p]);
    },
    useDb: function (db) { this.mode = 'db'; this.db = db; },
    useLocal: function () {
      var self = this; this.mode = 'local'; this.db = null; this.docs = Object.create(null);
      lsKeys('epock:l:').forEach(function (k) { var v = lsGet(k); if (v !== undefined) self.docs[k.slice(8)] = v; });
    },
    afterBoot: function () {
      var self = this, list = this.bootDirty.slice(), q = this.bootQueue.slice(); this.bootDirty = []; this.bootQueue = [];
      list.forEach(function (x) { self.set(x.p, x.v, 0); });
      q.forEach(function (f) { f(); });
    },
    markLoaded: function (p) {
      this.loaded[p] = true;
      var w = this.waiters[p] || []; this.waiters[p] = [];
      w.forEach(function (f) { f(); });
    },
    // Change a document starting from its stored copy, never from a copy that hasn't arrived yet.
    // fn gets a mutable copy (or undefined) and returns the new body, or null to leave it alone.
    mutate: function (p, fn, delay) {
      var self = this;
      if (this.mode === 'boot') { this.bootQueue.push(function () { self.mutate(p, fn, delay); }); return; }
      if (this.mode === 'db' && !this.loaded[p]) {
        (this.waiters[p] = this.waiters[p] || []).push(function () { self.mutate(p, fn, delay); });
        if (!this.fetching[p]) {
          this.fetching[p] = true;
          Promise.resolve(this.db.doc(p).get()).then(function (snap) {
            self.fetching[p] = false;
            if (!self.loaded[p]) { self.docs[p] = snap && snap.exists ? clone(snap.data()) : undefined; self.markLoaded(p); }
          }, function () {
            self.fetching[p] = false; self.waiters[p] = [];
            toast('Couldn’t reach your saved data just now. Try that again in a moment.');
          });
        }
        return;
      }
      var next = fn(clone(this.docs[p]));
      if (next === null) return;
      this.set(p, next, delay);
    },
    watch: function (p) {
      if (this.mode !== 'db' || this.subs[p]) return;
      var self = this;
      this.subs[p] = this.db.doc(p).onSnapshot(function (snap) { self.onSnap(p, snap); }, function (err) { self.onSubErr(p, err); });
    },
    release: function (p) { var u = this.subs[p]; if (u) { try { u(); } catch (e) { /* gone */ } delete this.subs[p]; this.loaded[p] = false; } },
    busy: function (p) { var q = this.q[p]; return !!(q && (q.timer || q.dirty || q.inflight)); },
    onSnap: function (p, snap) {
      var q = this.q[p];
      if (q && (q.timer || q.dirty)) return;
      if (q && q.inflight && !(snap.metadata && snap.metadata.hasPendingWrites)) return;
      this.docs[p] = snap.exists ? clone(snap.data()) : undefined;
      this.mirror(p); this.markLoaded(p); bump();
    },
    onSubErr: function (p, err) {
      var self = this; delete this.subs[p];
      if (err && err.code === 'revoked') { this.readonly = true; bump(); return; }
      if (err && err.code === 'unavailable') setTimeout(function () { if (p === 'ics') { self.colSub = null; self.watchIcs(); } else self.watch(p); }, 1500 + Math.random() * 1500);
    },
    watchIcs: function () {
      if (this.mode !== 'db' || this.colSub) return;
      var self = this;
      this.colSub = this.db.collection('ics').onSnapshot(function (snap) {
        Object.keys(self.docs).forEach(function (p) { if (p.indexOf('ics/') === 0 && !self.busy(p)) delete self.docs[p]; });
        snap.docs.forEach(function (d) { var p = 'ics/' + d.id; if (!self.busy(p) && d.exists) { self.docs[p] = clone(d.data()); self.loaded[p] = true; } });
        bump();
      }, function (err) { self.onSubErr('ics', err); });
    },
    set: function (p, v, delay) {
      this.docs[p] = v; bump();
      if (this.readonly) return;
      if (this.mode === 'boot') { this.bootDirty.push({ p: p, v: v }); return; }
      if (this.mode === 'local') {
        if (!lsSet('epock:l:' + p, v) && v !== undefined) toast(STANDALONE ? 'Epock’s storage on this computer is full. Remove an imported .ics file in Setup to make room.' : 'Couldn’t save that in this browser.');
        return;
      }
      this.mirror(p);
      var self = this, q = this.q[p] || (this.q[p] = { timer: 0, dirty: false, inflight: false, retried: false });
      q.dirty = true; clearTimeout(q.timer);
      q.timer = setTimeout(function () { q.timer = 0; self.flush(p); }, delay == null ? 450 : delay);
    },
    del: function (p) { this.set(p, undefined, 0); },
    flush: function (p) {
      var self = this, q = this.q[p];
      if (!q || q.inflight || !q.dirty || !this.db) return;
      q.dirty = false; q.inflight = true;
      var v = this.docs[p], ref = this.db.doc(p);
      var op = v === undefined ? ref.delete() : ref.set(clone(v));
      Promise.resolve(op).then(function () { q.retried = false; }, function (e) { self.onWriteErr(p, q, e); })
        .then(function () { q.inflight = false; if (q.dirty && !q.timer) self.flush(p); });
    },
    onWriteErr: function (p, q, e) {
      var code = e && e.code, self = this;
      if ((code === 'unavailable' || code === 'resource_exhausted') && !q.retried) {
        q.retried = true; q.dirty = true; q.timer = setTimeout(function () { q.timer = 0; self.flush(p); }, 1200 + Math.random() * 1500); return;
      }
      if (code === 'quota_exceeded') toast('Epock’s storage is full. Remove an imported .ics file in Setup to make room.');
      else if (code === 'invalid_argument') toast('That change was too large to save.');
      else if (code === 'revoked' || code === 'not_granted' || code === 'capability_disabled') { this.readonly = true; toast('Saving is turned off in this view, so changes won’t be kept.'); }
      else toast('Couldn’t save just now. Your last change may not be kept.');
    }
  };

  var sMemo = null, sMemoDoc;
  function S() { var doc = Store.get(SETTINGS); if (sMemo && sMemoDoc === doc) return sMemo; sMemoDoc = doc; sMemo = mergeSettings(doc); return sMemo; }
  // fn edits a full settings object; returning false means nothing changed.
  function editSettings(fn) { Store.mutate(SETTINGS, function (doc) { var st = mergeSettings(doc); return fn(st) === false ? null : st; }); }

  /* ---------- Events from Google (live or saved), .ics imports ---------- */
  function wkey(cal, m) { return cal + '\u0001' + m; }
  var evMemo = {}, icsMemo = {};
  function icsRaw(imp) {
    var hit = icsMemo[imp]; if (hit && hit.v === DV) return hit.list;
    var list = [];
    Object.keys(Store.docs).forEach(function (p) {
      if (p.indexOf('ics/' + imp + '-') !== 0) return; var d = Store.docs[p];
      ((d && d.ev) || []).forEach(function (a) { list.push({ u: a[0], t: a[1], s: a[2], e: a[3], ad: a[4], rr: a[5] || '', ex: a[6] || [], rid: a[7] || 0 }); });
    });
    icsMemo[imp] = { v: DV, list: list }; return list;
  }
  function monthEvents(m) {
    var hit = evMemo[m]; if (hit && hit.v === DV) return hit.list;
    var st = S(), list = [], cache = (Store.get('cache/' + m) || {}).cals || {};
    Object.keys(st.cals).forEach(function (cal) {
      var cfg = st.cals[cal]; if (!cfg || cfg.inc === false) return;
      if (cal.indexOf('ics:') === 0) {
        var from = E.monthStart(m) - 864e5, to = E.monthStart(E.addMonths(m, 1)) + 864e5;
        ICS.expand(icsRaw(cal.slice(4)), from, to).forEach(function (o) { list.push({ id: cal + ':' + o.id, t: o.t, cal: cal, s: o.s, e: o.e, ad: o.ad ? 1 : 0 }); });
        return;
      }
      var live = G.live[wkey(cal, m)], src = live ? live.ev : ((cache[cal] && cache[cal].ev) || []);
      src.forEach(function (t) { if (t[4] & 2) return; list.push({ id: t[0], t: t[1] || '', cal: cal, s: t[2], e: t[3], ad: t[4] & 1 }); });
    });
    list.forEach(function (e) { e.cat = E.classify(e.t, e.cal, e.id, st); });
    evMemo[m] = { v: DV, list: list }; return list;
  }
  function eventsBetween(t0, t1, months) {
    var seen = {}, out = [];
    months.forEach(function (m) {
      monthEvents(m).forEach(function (e) {
        if (e.s < t1 && e.e > t0) { var k = e.cal + '\u0001' + e.id; if (!seen[k]) { seen[k] = 1; out.push(e); } }
      });
    });
    return out;
  }
  function dayEvents(key) {
    return eventsBetween(E.k2d(key).getTime(), E.k2d(E.addDays(key, 1)).getTime(), uniq([E.mkey(E.addDays(key, -1)), E.mkey(key)]));
  }
  function rangeEvents(k0, k1) {
    var months = []; for (var m = E.mkey(k0); m <= E.mkey(k1); m = E.addMonths(m, 1)) months.push(m);
    return eventsBetween(E.k2d(k0).getTime(), E.k2d(k1).getTime(), months);
  }
  function hasAnySchedule() { return Object.keys(Store.docs).some(function (p) { var d = Store.docs[p]; return p.indexOf('cache/') === 0 && d && d.cals && Object.keys(d.cals).length; }); }
  function cacheAt() { var at = 0; Object.keys(Store.docs).forEach(function (p) { var d = Store.docs[p]; if (p.indexOf('cache/') === 0 && d && d.cals) Object.keys(d.cals).forEach(function (c) { at = Math.max(at, d.cals[c].at || 0); }); }); return at; }

  /* ---------- Picks and logs ---------- */
  function plansFor(key) { var d = Store.get('plans/' + E.mkey(key)); return d && d.items ? Object.keys(d.items).map(function (k) { return d.items[k]; }).filter(function (p) { return p && p.d === key; }) : []; }
  function findPlan(key, pid) { var d = Store.get('plans/' + E.mkey(key)); return d && d.items ? d.items[pid] : null; }
  function logsFor(key) {
    var t0 = E.k2d(key).getTime(), t1 = E.k2d(E.addDays(key, 1)).getTime(), out = [], now = Date.now();
    uniq([E.mkey(E.addDays(key, -1)), E.mkey(key)]).forEach(function (m) {
      var d = Store.get('logs/' + m); if (!d || !d.items) return;
      Object.keys(d.items).forEach(function (id) { var l = d.items[id]; if (!l) return; var e = l.e || now; if (l.s < t1 && e > t0) out.push({ id: l.id, k: l.k, s: l.s, e: l.e, t: (LOGK[l.k] || {}).name || 'Self-care' }); });
    });
    return out;
  }
  function activeLog() {
    var m = E.mkey(todayKey()), found = null;
    [m, E.addMonths(m, -1)].forEach(function (mm) { var d = Store.get('logs/' + mm); if (!found && d && d.items) Object.keys(d.items).forEach(function (id) { var l = d.items[id]; if (l && !l.e) found = l; }); });
    return found;
  }
  function model(key, opt) {
    opt = opt || {};
    var plans = plansFor(key).filter(function (p) { return p.id !== opt.without; });
    return E.computeDay(key, { st: S(), events: dayEvents(key), plans: plans, logs: logsFor(key), now: Date.now() });
  }
  function fitCheck(key, a, b, without) {
    var day = model(key, { without: without });
    for (var x = Math.round(a / 5); x < Math.round(b / 5); x++) if (day.cat[x] !== E.C.gold || day.pref[x] !== -1) return { ok: false, day: day, x: x };
    return { ok: true, day: day };
  }
  function savePlan(key, a, b, t, em, pid) {
    var st = S();
    Store.mutate('plans/' + E.mkey(key), function (doc) {
      doc = doc || {}; doc.items = doc.items || {}; doc.dels = doc.dels || [];
      var prev = pid ? doc.items[pid] : null, p = prev || { id: uid('p'), d: key, at: Date.now() };
      var changed = !prev || prev.a !== a || prev.b !== b || prev.t !== t;
      p.a = a; p.b = b; p.t = t; p.em = em || '🪙';
      if (changed) {
        if (p.gid && !p.link) doc.dels.push({ gid: p.gid, cal: p.gcal || st.wb.cal });
        delete p.gid; delete p.gcal; delete p.link; delete p.err;
        p.st = st.wb.on ? 'new' : 'local';
      }
      doc.items[p.id] = p; return doc;
    });
  }
  function removePlan(key, pid) {
    var cal = S().wb.cal;
    Store.mutate('plans/' + E.mkey(key), function (doc) {
      if (!doc || !doc.items || !doc.items[pid]) return null;
      var p = doc.items[pid]; doc.dels = doc.dels || [];
      if (p.gid && !p.link) doc.dels.push({ gid: p.gid, cal: p.gcal || cal });
      delete doc.items[pid]; return doc;
    });
  }
  function pendingSync() {
    var today = todayKey(), n = 0;
    Object.keys(Store.docs).forEach(function (p) {
      var d = Store.docs[p]; if (p.indexOf('plans/') !== 0 || !d) return;
      n += (d.dels || []).length;
      Object.keys(d.items || {}).forEach(function (k) { var x = d.items[k]; if (x && x.d >= today && (x.st === 'new' || x.st === 'err')) n++; });
    });
    return n;
  }
  function markLocalNew() {
    var today = todayKey();
    Object.keys(Store.docs).forEach(function (p) {
      if (p.indexOf('plans/') !== 0) return;
      Store.mutate(p, function (doc) {
        if (!doc || !doc.items) return null; var changed = false;
        Object.keys(doc.items).forEach(function (k) { var x = doc.items[k]; if (x && x.d >= today && (x.st === 'local' || !x.st)) { x.st = 'new'; changed = true; } });
        return changed ? doc : null;
      });
    });
  }
  function logPath(ms) { return 'logs/' + E.mkey(E.dkey(new Date(ms))); }
  function startLog(k) {
    var cur = activeLog(); if (cur) stopLog(cur, true);
    var now = Date.now(), id = uid('l');
    Store.mutate(logPath(now), function (doc) { doc = doc || {}; doc.items = doc.items || {}; doc.items[id] = { id: id, k: k, s: now, e: null }; return doc; });
  }
  function stopLog(l, quiet) {
    l = l || activeLog(); if (!l) return;
    var e = Math.min(Math.max(Date.now(), l.s + 60000), l.s + 3 * 3600000);
    Store.mutate(logPath(l.s), function (doc) { if (!doc || !doc.items || !doc.items[l.id]) return null; doc.items[l.id].e = e; return doc; });
    if (!quiet) toast((LOGK[l.k] || {}).name + ' · ' + E.fmtDur((e - l.s) / 60000) + ' logged');
  }
  function addPastLog(k, s, min) {
    var id = uid('l');
    Store.mutate(logPath(s), function (doc) { doc = doc || {}; doc.items = doc.items || {}; doc.items[id] = { id: id, k: k, s: s, e: s + min * 60000 }; return doc; });
  }
  function delLog(lid, key) {
    uniq([E.mkey(key), E.mkey(E.addDays(key, -1))]).forEach(function (m) {
      if (!(Store.get('logs/' + m) || {}).items) return;
      Store.mutate('logs/' + m, function (doc) { if (!doc || !doc.items || !doc.items[lid]) return null; delete doc.items[lid]; return doc; });
    });
  }

  /* ---------- Google Calendar: live read through the viewer's connector, write-back on request ---------- */
  var G = { mcp: null, perms: null, status: 'boot', msg: '', calList: null, live: Object.create(null), watches: Object.create(null),
    wmeta: Object.create(null), errs: Object.create(null), lastAt: 0, syncing: false, connecting: false };
  var AUTHZ = { needs_reauth: 1, server_not_connected: 1, blocked_by_policy: 1, approval_required: 1, not_in_manifest: 1, selection_required: 1, consent_required: 1 };
  var STATUS_OF = { needs_reauth: 'reauth', server_not_connected: 'notconnected', server_not_found: 'notconnected', selection_required: 'select',
    not_in_manifest: 'denied', consent_required: 'connect', blocked_by_policy: 'blocked', approval_required: 'approval',
    not_granted: 'unavailable', capability_disabled: 'unavailable', capability_removed: 'unavailable', server_unavailable: 'stale', rate_limited: 'stale' };
  var STOP = { needs_reauth: 1, server_not_connected: 1, selection_required: 1, not_in_manifest: 1, blocked_by_policy: 1, approval_required: 1,
    not_granted: 1, capability_disabled: 1, capability_removed: 1, consent_required: 1, user_changed: 1, server_not_found: 1 };

  function extractEvents(p) { if (!p) return []; if (Array.isArray(p.events)) return p.events; if (Array.isArray(p.items)) return p.items; return Array.isArray(p) ? p : []; }
  function toTuple(ev) {
    if (!ev || ev.status === 'cancelled' || !ev.start) return null;
    if (Array.isArray(ev.attendees) && ev.attendees.some(function (a) { return a && a.self && a.responseStatus === 'declined'; })) return null;
    var s = ev.start, e = ev.end || ev.start, ad = !!s.date && !s.dateTime;
    var t0 = ad ? E.k2d(s.date).getTime() : Date.parse(s.dateTime), t1 = ad ? E.k2d(e.date || s.date).getTime() : Date.parse(e.dateTime || s.dateTime);
    if (!isFinite(t0) || !isFinite(t1)) return null;
    var mine = typeof ev.description === 'string' && ev.description.indexOf(MARK) !== -1;
    return [String(ev.id || ''), String(ev.summary || '').slice(0, 120), t0, Math.max(t0, t1), (ad ? 1 : 0) | (mine ? 2 : 0)];
  }
  function gFail(e) {
    var code = (e && e.code) || 'upstream_error';
    G.status = STATUS_OF[code] || 'error';
    if (STANDALONE) { G.msg = bridgeMessage(e); if (code === 'server_not_connected') G.status = 'setup'; return; }
    G.msg = code === 'tool_error' ? 'Google Calendar said: ' + String((e && e.message) || '').slice(0, 160) : 'Google Calendar didn’t answer.';
  }
  function bridgeMessage(e) {
    var code = e && e.code, m = String((e && e.message) || '');
    if (/Calendar"? is not defined/i.test(m)) return 'Your Google bridge is missing the Google Calendar service. In Apps Script, click + next to Services and add Google Calendar API. Then choose Deploy → Manage deployments → Edit, set Version to New version, and click Deploy.';
    if (code === 'bridge_unreachable') return m + ' In Apps Script, open Deploy → Manage deployments and check that “Who has access” is set to “Anyone”.';
    if (code === 'tool_error') return 'Google Calendar said: ' + m.slice(0, 160);
    if (code === 'server_unavailable') return m || 'Google Calendar didn’t answer.';
    return 'Google Calendar didn’t answer.';
  }
  function gBoot(mcp, perms) {
    G.mcp = mcp; G.perms = perms;
    if (!mcp) { G.status = 'unavailable'; bump(); return; }
    if (STANDALONE && !PLAT.configured()) { G.status = 'setup'; bump(); return; }
    var p = perms ? Promise.resolve(perms.state('mcp:' + SERVER)).catch(function () { return 'prompt'; }) : Promise.resolve('prompt');
    p.then(function (st) { if (st === 'denied') { G.status = 'denied'; bump(); } else gConnect(); });
  }
  function defaultCalCfg(c) {
    if (/#holiday@/.test(c.id)) return { inc: true, cat: 'holiday', name: c.name };
    if (/^c_classroom|^classroom\d|#contacts@|#weeknum@|#birthday/.test(c.id)) return { inc: false, cat: 'auto', name: c.name };
    return { inc: true, cat: 'auto', name: c.name };
  }
  function mergeCalendars() {
    if (!G.calList) return;
    var list = G.calList.slice();
    editSettings(function (st) {
      var changed = false;
      list.forEach(function (c) {
        if (!st.cals[c.id]) { st.cals[c.id] = defaultCalCfg(c); changed = true; }
        else if (st.cals[c.id].name !== c.name) { st.cals[c.id].name = c.name; changed = true; }
      });
      return changed;
    });
  }
  function gConnect(announce) {
    if (!G.mcp || G.connecting) return;
    if (STANDALONE && !PLAT.configured()) { G.status = 'setup'; bump(); return; }
    G.connecting = true; G.status = 'connecting'; bump();
    Promise.resolve(G.mcp.callTool(SERVER, 'list_calendars', { pageSize: 250 })).then(function (r) {
      var p = r && r.payload, list = (p && (p.calendars || p.items)) || (Array.isArray(p) ? p : []);
      G.calList = list.filter(function (c) { return c && c.id; }).map(function (c) { return { id: c.id, name: c.summaryOverride || c.summary || c.id }; });
      G.status = 'live'; G.msg = ''; G.errs = Object.create(null);
      mergeCalendars();
      Object.keys(G.watches).forEach(function (k) { try { G.watches[k](); } catch (e) { /* gone */ } delete G.watches[k]; });
      ensureWatches();
      if (announce) toast('Connected to Google Calendar. Your calendars are syncing.');
    }, gFail).then(function () { G.connecting = false; bump(); });
  }
  function neededMonths() {
    var t = todayKey(), s = [E.mkey(E.addDays(t, -7)), E.mkey(t), E.mkey(E.addDays(t, 1)), E.mkey(E.addDays(t, 8))];
    if (UI.tab === 'cal') calDays().forEach(function (k) { s.push(E.mkey(k)); });
    if (UI.tab === 'day' && UI.dayKey) [-7, -1, 0, 8].forEach(function (n) { s.push(E.mkey(E.addDays(UI.dayKey, n))); });
    return uniq(s).sort();
  }
  function ensureWatches() {
    if (!G.mcp || !G.calList || G.status === 'unavailable') return;
    var st = S(), want = {}, months = neededMonths();
    G.calList.forEach(function (c) { var cfg = st.cals[c.id]; if (!cfg || cfg.inc === false) return; months.forEach(function (m) { want[wkey(c.id, m)] = 1; }); });
    Object.keys(G.watches).forEach(function (k) { if (!want[k]) { try { G.watches[k](); } catch (e) { /* gone */ } delete G.watches[k]; delete G.wmeta[k]; delete G.errs[k]; } });
    Object.keys(want).forEach(function (k) { if (!G.watches[k]) watchOne(k); });
  }
  function watchOne(k) {
    var parts = k.split('\u0001'), cal = parts[0], m = parts[1];
    var input = { calendarId: cal, startTime: m + '-01T00:00:00', endTime: E.addMonths(m, 1) + '-01T00:00:00', orderBy: 'startTime', pageSize: 250 };
    if (TZ) input.timeZone = TZ;
    G.wmeta[k] = { cal: cal, m: m, input: input };
    G.watches[k] = G.mcp.watchTool(SERVER, 'list_events', input, function (ev) { onWatch(k, ev); }, { cache: { staleTime: 60000, gcTime: 86400000 }, refetchInterval: 300000 });
  }
  function onWatch(k, ev) {
    var meta = G.wmeta[k]; if (!meta) return;
    if (ev.type === 'data') {
      var res = ev.result || {}, p = res.payload, list = extractEvents(p), next = p && p.nextPageToken, pages = 0;
      var more = function () {
        if (!next || pages >= 5) return Promise.resolve();
        pages++;
        return Promise.resolve(G.mcp.callTool(SERVER, 'list_events', Object.assign({}, meta.input, { pageToken: next }), { cache: { staleTime: 60000 } }))
          .then(function (r) { var pp = r && r.payload; list = list.concat(extractEvents(pp)); next = pp && pp.nextPageToken; return more(); }, function () { /* keep what we have */ });
      };
      more().then(function () {
        if (!G.watches[k]) return;
        var tuples = list.map(toTuple).filter(Boolean), at = (res.cache && res.cache.storedAt) || Date.now();
        G.live[k] = { ev: tuples, at: at }; G.lastAt = Math.max(G.lastAt, at); delete G.errs[k];
        if (!G.connecting && G.status !== 'live') { G.status = 'live'; G.msg = ''; }
        saveCache(meta.m, meta.cal, tuples, at);
        bump();
      });
      return;
    }
    var e = ev.error || {}, code = e.code || 'upstream_error';
    G.errs[k] = code;
    if (AUTHZ[code]) delete G.live[k];
    var keys = Object.keys(G.watches);
    if (keys.length && keys.every(function (x) { return G.errs[x] === code; })) gFail(e);
    bump();
  }
  // A watch never asks for approval; this makes each blocked read once, from the viewer's tap.
  function gApprove() {
    if (!G.mcp) return;
    var keys = Object.keys(G.errs).filter(function (k) { return G.errs[k] === 'approval_required' && G.wmeta[k]; });
    if (!keys.length) { gConnect(); return; }
    var chain = Promise.resolve();
    keys.forEach(function (k) {
      chain = chain.then(function () {
        var meta = G.wmeta[k];
        return Promise.resolve(G.mcp.callTool(SERVER, 'list_events', meta.input)).then(function (r) {
          var tuples = extractEvents(r && r.payload).map(toTuple).filter(Boolean), at = Date.now();
          G.live[k] = { ev: tuples, at: at }; G.lastAt = Math.max(G.lastAt, at); delete G.errs[k];
          saveCache(meta.m, meta.cal, tuples, at);
        }, function (e) { G.errs[k] = (e && e.code) || 'upstream_error'; });
      });
    });
    chain.then(function () { if (!Object.keys(G.errs).length) { G.status = 'live'; G.msg = ''; } bump(); });
  }
  // Keep a private copy of what Google returned, so a view without live sync still shows the schedule.
  function saveCache(m, cal, tuples, at) {
    if ((Store.mode !== 'db' && Store.mode !== 'local') || Store.readonly) return;
    var cur = (Store.get('cache/' + m) || {}).cals || {};
    if (cur[cal] && JSON.stringify(cur[cal].ev) === JSON.stringify(tuples)) return;
    Store.mutate('cache/' + m, function (doc) {
      doc = doc || {}; doc.cals = doc.cals || {};
      if (doc.cals[cal] && JSON.stringify(doc.cals[cal].ev) === JSON.stringify(tuples)) return null;
      doc.cals[cal] = { at: at, ev: tuples };
      return JSON.stringify(doc).length > 240000 ? null : doc;
    }, 4000);
  }
  function localISO(key, min) { var k = key, m = Math.round(min); if (m >= 1440) { k = E.addDays(key, 1); m -= 1440; } return k + 'T' + E.hhmm(m) + ':00'; }
  function pickId(p) { if (!p || typeof p !== 'object') return null; return p.id || (p.event && p.event.id) || p.eventId || (p.result && p.result.id) || null; }
  function isGone(e) { return e && e.code === 'tool_error' && /not.?found|404|410|deleted|gone/i.test(String(e.message || '')); }
  function findExisting(cal, p) {
    var input = { calendarId: cal, startTime: localISO(p.d, 0), endTime: localISO(p.d, 1440), pageSize: 250 };
    if (TZ) input.timeZone = TZ;
    return Promise.resolve(G.mcp.callTool(SERVER, 'list_events', input, { cache: { refresh: true } })).then(function (r) {
      var list = extractEvents(r && r.payload);
      var mine = list.filter(function (ev) { return typeof ev.description === 'string' && ev.description.indexOf(MARK + p.id) !== -1; })[0];
      if (mine) return { id: mine.id, mine: true };
      var d0 = E.k2d(p.d).getTime(), s = d0 + p.a * 60000, e = d0 + p.b * 60000, title = String(p.t || '').trim().toLowerCase();
      var same = list.filter(function (ev) { var t = toTuple(ev); return t && !(t[4] & 1) && String(ev.summary || '').trim().toLowerCase() === title && t[2] < e && t[3] > s; })[0];
      return same ? { id: same.id, mine: false } : null;
    });
  }
  function gSyncPicks() {
    if (!G.mcp || G.syncing) return;
    var st = S(), cal = st.wb.cal || 'primary', today = todayKey(), made = 0, linked = 0, removed = 0, failed = 0, stop = null;
    G.syncing = true; bump();
    var paths = Object.keys(Store.docs).filter(function (p) { return p.indexOf('plans/') === 0 && Store.docs[p]; }).sort();
    var chain = Promise.resolve();
    paths.forEach(function (path) {
      chain = chain.then(function () {
        if (stop) return;
        // Work from a snapshot, then fold the results into whatever the document holds by then.
        var snap = clone(Store.get(path)) || {}, done = [], results = {}, c2 = Promise.resolve();
        (snap.dels || []).forEach(function (del) {
          c2 = c2.then(function () {
            if (stop) return;
            return Promise.resolve(G.mcp.callTool(SERVER, 'delete_event', { calendarId: del.cal || cal, eventId: del.gid }))
              .then(function () { done.push(del.gid); removed++; }, function (e) {
                if (isGone(e)) { done.push(del.gid); return; }
                failed++; if (e && STOP[e.code]) stop = e;
              });
          });
        });
        Object.keys(snap.items || {}).forEach(function (id) {
          var p = snap.items[id];
          if (!p || p.d < today || (p.st !== 'new' && p.st !== 'err')) return;
          c2 = c2.then(function () {
            if (stop) return;
            var r = { a: p.a, b: p.b, t: p.t };
            return findExisting(cal, p).then(function (found) {
              if (found) { r.gid = found.id; r.link = !found.mine; if (found.mine) made++; else linked++; return; }
              var input = { calendarId: cal, summary: p.t, startTime: localISO(p.d, p.a), endTime: localISO(p.d, p.b), description: 'Picked in Epock. ' + MARK + p.id };
              if (TZ) input.timeZone = TZ;
              return Promise.resolve(G.mcp.callTool(SERVER, 'create_event', input)).then(function (res) {
                made++; r.link = false;
                var newId = pickId(res && res.payload); if (newId) { r.gid = newId; return; }
                return findExisting(cal, p).then(function (again) { r.gid = again ? again.id : null; }, function () { r.gid = null; });
              });
            }).then(function () { r.gcal = cal; r.st = 'ok'; results[id] = r; }, function (e) {
              r.st = 'err'; r.err = (e && e.code) || 'error'; results[id] = r; failed++; if (e && STOP[e.code]) stop = e;
            });
          });
        });
        return c2.then(function () {
          if (!done.length && !Object.keys(results).length) return;
          Store.mutate(path, function (doc) {
            doc = doc || {}; doc.items = doc.items || {};
            doc.dels = (doc.dels || []).filter(function (x) { return done.indexOf(x.gid) === -1; });
            Object.keys(results).forEach(function (id) {
              var r = results[id], cur = doc.items[id], same = cur && cur.a === r.a && cur.b === r.b && cur.t === r.t;
              if (same && r.st === 'ok') { cur.gid = r.gid; cur.link = r.link; cur.gcal = r.gcal; cur.st = 'ok'; delete cur.err; }
              else if (same) { cur.st = 'err'; cur.err = r.err; }
              else if (r.st === 'ok' && r.gid && !r.link) doc.dels.push({ gid: r.gid, cal: r.gcal }); // changed or removed meanwhile
            });
            return doc;
          }, 0);
        });
      });
    });
    chain.then(function () {
      G.syncing = false;
      return Promise.resolve(G.mcp.invalidate(SERVER, 'list_events')).catch(function () { /* nothing cached */ });
    }).then(function () {
      if (stop) { gFail(stop); toast('Google Calendar stopped the update. ' + (gBannerText() || '')); }
      else if (failed) toast(failed + (failed === 1 ? ' pick' : ' picks') + ' couldn’t be added. Tap “Add to Google” to try again.');
      else toast([made ? 'Added ' + made + ' to ' + calName(cal) : '', linked ? linked + ' already there' : '', removed ? removed + ' removed' : ''].filter(Boolean).join(' · ') || 'Google Calendar is up to date.');
      bump();
    });
  }
  function calName(id) { var st = S(); var c = (G.calList || []).filter(function (x) { return x.id === id; })[0]; return (c && c.name) || (st.cals[id] && st.cals[id].name) || (id === 'primary' ? 'your calendar' : id); }

  /* ---------- UI state ---------- */
  var UI = lsGet('epock:ui') || {};
  UI.tab = ['today', 'tomorrow', 'cal', 'setup'].indexOf(UI.tab) !== -1 ? UI.tab : 'today';
  UI.calMode = UI.calMode === 'month' ? 'month' : 'week';
  UI.open = UI.open || { google: true };
  UI.calAnchor = null; UI.dayKey = null; UI.sheet = null;
  function saveUI() { lsSet('epock:ui', { tab: UI.tab === 'day' ? 'cal' : UI.tab, calMode: UI.calMode, open: UI.open }); }
  var renderQueued = false, deferMain = false, enterNext = true, lastFocus = null;

  /* ---------- Pieces ---------- */
  function note(kind, html, actions) { return '<div class="note ' + (kind || '') + '"><p>' + html + '</p>' + (actions || '') + '</div>'; }
  function coinNum(min) {
    var c = E.coins(min);
    return '<span class="n">' + ((c.w || !c.n) ? c.w : '') + (c.n ? '<span class="fr"><sup>' + c.n + '</sup><sub>' + c.d + '</sub></span>' : '') + '</span>';
  }
  function segName(day, s) {
    if (s.color === 'gold') return 'free gold';
    if (s.color === 'plan') return 'planned ' + ((day.plans[s.pref] || {}).t || '');
    var it = day.items[s.ref]; return (it && it.t) || CAT[s.color];
  }
  function coinHTML(day, h, o) {
    o = o || {};
    var sg = E.hourSegs(day, h), best = null;
    sg.forEach(function (s) { if (s.color === 'plan' && (!best || s.n > best.n)) best = s; });
    var badge = best && best.n >= 3 && day.plans[best.pref] ? esc(day.plans[best.pref].em || '🪙') : '';
    var lab = hourName(h) + ': ' + sg.map(function (s) { return segName(day, s) + ' ' + E.fmtDur(s.n * 5); }).join(', ');
    var tag = o.still ? 'span' : 'button';
    return '<' + tag + (o.still ? ' role="img"' : ' type="button" data-act="hour" data-d="' + day.key + '" data-h="' + h + '"') + ' class="coin' + (o.mini ? ' mini' : '') + (o.state ? ' ' + o.state : '') +
      '" style="--g:' + E.conic(sg, 30) + ';--i:' + (o.i || 0) + '" aria-label="' + esc(lab) + '"><span class="body"></span>' + glitter(E.planMask(sg, 30)) + '<span class="rim"></span>' +
      (o.mini ? '' : '<span class="face"><span class="num">' + h12(h) + '</span></span>') +
      (o.state === 'now' ? '<span class="elapsed" style="--p:' + o.p + 'deg"></span>' + (o.mini ? '' : '<span class="hand" style="--p:' + o.p + 'deg"></span>') : '') +
      (badge ? '<span class="badge" aria-hidden="true">' + badge + '</span>' : '') + '</' + tag + '>';
  }
  function glitter(mask) { return mask ? '<span class="glitter" aria-hidden="true" style="--gm:' + mask + '"></span>' : ''; }
  function sw(color) { return '<i class="sw' + (color === 'plan' ? ' pearl' : '') + '" style="--c:var(--c-' + color + ')"></i>'; }
  function trayHTML(day, mode) {
    var nm = mode === 'today' ? day.nowMin : null;
    var html = '<div class="tray' + (enterNext ? ' enter' : '') + '" role="group" aria-label="Hour coins for ' + esc(dateLabel(day.key, { weekday: 'long', month: 'long', day: 'numeric' })) + '">';
    SHELVES.forEach(function (s, r) {
      html += '<div class="shelf"><div class="shelf-l"><span>' + s[0] + '</span><span class="faint">' + s[1] + '</span></div><div class="coinrow">';
      for (var c = 0; c < 6; c++) {
        var h = r * 6 + c, state = '', p = 0;
        if (mode === 'past') state = 'past';
        else if (nm != null) { if (nm >= (h + 1) * 60) state = 'past'; else if (nm >= h * 60) { state = 'now'; p = Math.round((nm - h * 60) * 6); } }
        html += '<div class="well">' + coinHTML(day, h, { state: state, p: p, i: h }) + '</div>';
      }
      html += '</div></div>';
    });
    return html + '</div>';
  }
  function ledgerHTML(day, label) {
    var t = day.tot, open = t.gold - t.planned;
    var parts = [['sleep', t.sleep, 'Sleep'], ['school', t.school, 'School'], ['commute', t.commute, 'Commute'], ['class', t.class, 'Classes'], ['care', t.care, 'Self-care'], ['plan', t.planned, 'Planned'], ['gold', open, 'Gold'], ['ask', t.ask, 'Needs a color']]
      .filter(function (p) { return p[1] > 0; });
    return '<section class="sec ledger"><div class="sec-h"><h3>' + esc(label) + '’s 24 coins</h3></div>' +
      '<div class="bar" role="img" aria-label="' + esc(parts.map(function (p) { return p[2] + ' ' + E.fmtDur(p[1]); }).join(', ')) + '">' +
      parts.map(function (p) { return '<span' + (p[0] === 'plan' ? ' class="pearl"' : '') + ' style="--c:var(--c-' + p[0] + ');flex:' + p[1] + '"></span>'; }).join('') + '</div>' +
      '<div class="legend">' + parts.map(function (p) { return '<span>' + sw(p[0]) + p[2] + ' <b>' + E.fmtDur(p[1]) + '</b></span>'; }).join('') + '</div></section>';
  }
  function planChip(key, p) {
    var st = S(), sync = '';
    if (st.wb.on) {
      var cls = p.st === 'ok' ? 'ok' : p.st === 'err' ? 'err' : 'new';
      var tip = p.st === 'ok' ? 'On Google Calendar' : p.st === 'err' ? 'Couldn’t add to Google Calendar' : 'Not on Google Calendar yet';
      sync = '<span class="st ' + cls + '" title="' + tip + '"><span class="vh">' + tip + '</span></span>';
    }
    return '<button type="button" class="chip plan' + (p.conflict ? ' conflict' : '') + '" data-act="plan" data-d="' + key + '" data-pid="' + esc(p.id) + '"><span aria-hidden="true">' + esc(p.em || '🪙') +
      '</span><span class="lbl">' + esc(p.t) + '</span><span class="muted">' + E.fmtRange(p.a, p.b) + '</span>' + sync + '</button>';
  }
  function windowsHTML(day, mode) {
    var nm = mode === 'today' ? day.nowMin : null, canPick = mode !== 'past';
    var wins = day.windows.filter(function (w) { return w.len >= 10 && (nm == null || w.b > nm); });
    var conflicts = day.plans.filter(function (p) { return p.conflict; });
    var title = mode === 'today' ? 'Gold left to spend' : mode === 'past' ? 'Gold that day' : 'Gold windows';
    var html = '<section class="sec"><div class="sec-h"><h3>' + title + '</h3><span class="muted">' + (wins.length ? wins.length + (wins.length === 1 ? ' window' : ' windows') : '') + '</span></div>';
    if (!wins.length && !conflicts.length) return html + '<p class="empty">' + (mode === 'today' ? 'No gold left today.' : 'No free gold this day.') + '</p></section>';
    html += '<div class="wins">';
    wins.forEach(function (w) {
      var isNow = nm != null && nm >= w.a && nm < w.b, from = isNow ? Math.ceil(nm / 5) * 5 : w.a;
      var plans = day.plans.filter(function (p) { return !p.conflict && p.a < w.b && p.b > w.a; });
      var full = w.len - w.planned <= 0;
      html += '<div class="win' + (isNow ? ' now' : '') + (full ? ' full' : '') + '"><div class="when"><span class="t">' + E.fmtRange(w.a, w.b) + '</span><span class="len">' + E.fmtDur(w.len) +
        (isNow ? ' · ' + E.fmtDur(w.b - nm) + ' left' : '') + '</span></div>' +
        (canPick && !full ? '<button type="button" class="btn sm gold act" data-act="pick" data-d="' + day.key + '" data-a="' + w.a + '" data-b="' + w.b + '" data-from="' + from + '">+ Pick</button>' : '<span class="act"></span>') +
        '<div class="picks">' + plans.map(function (p) { return planChip(day.key, p); }).join('') + '</div></div>';
    });
    html += '</div>';
    if (conflicts.length) html += note('warn', (conflicts.length === 1 ? 'This pick isn’t on gold time any more. Move it or remove it.' : 'These picks aren’t on gold time any more. Move or remove them.'),
      '<div class="chips">' + conflicts.map(function (p) { return planChip(day.key, p); }).join('') + '</div>');
    return html + '</section>';
  }
  function holidayChips(key) {
    var evs = dayEvents(key).filter(function (e) { return e.ad && e.cat !== 'free'; });
    if (!evs.length) return '';
    return '<div class="chips">' + evs.slice(0, 4).map(function (e) { return '<span class="chip"><span class="muted">' + (e.cat === 'holiday' ? 'Holiday' : 'All day') + '</span><span class="lbl">' + esc(e.t || 'Event') + '</span></span>'; }).join('') + '</div>';
  }
  function sameSlot(day, i, x) { return day.cat[i] === day.cat[x] && (day.cat[x] === E.C.gold ? day.pref[i] === day.pref[x] : day.ref[i] === day.ref[x]); }
  function nowLine(day) {
    var nm = day.nowMin; if (nm == null || nm < 0 || nm >= 1440) return '';
    var x = Math.min(287, Math.floor(nm / 5)), a = x, b = x + 1;
    while (a > 0 && sameSlot(day, a - 1, x)) a--; while (b < 288 && sameSlot(day, b, x)) b++;
    var col = day.cat[x] === E.C.gold ? (day.pref[x] >= 0 ? 'plan' : 'gold') : E.CKEY[day.cat[x]], it = day.items[day.ref[x]], label;
    if (col === 'gold') label = 'free gold';
    else if (col === 'plan') label = (day.plans[day.pref[x]] || {}).t || 'your pick';
    else label = (it && it.t) || CAT[col];
    var until = b === 288 && col === 'sleep' ? E.fmt12(E.night(S(), E.wday(day.key)).wake) : E.fmt12(b * 5), next = '';
    if (col !== 'gold' && col !== 'plan') {
      var w = day.windows.filter(function (w) { return w.a >= b * 5 && w.len >= 10; })[0];
      if (w) next = '<span class="muted">Next gold ' + E.fmtRange(w.a, w.b) + ' (' + E.fmtDur(w.len) + ')</span>';
    }
    return '<div class="nowline"><span class="tag"><span class="sw" style="--c:var(--c-' + col + ')"></span>Now: ' + esc(label) + ' · until ' + until + '</span>' + next + '</div>';
  }
  function heroToday(day) {
    var L = day.left, picked = L.gold - L.open, bed = E.fmt12(day.bed);
    var sub = L.gold > 0 ? '<b>' + E.fmtDur(L.gold) + '</b> of free time before bed at ' + bed + (picked > 0 ? ' · <b>' + E.fmtDur(picked) + '</b> planned' : '') : 'You’ve used today’s gold. Bed is at ' + bed + '.';
    return '<section class="hero" aria-label="Gold left today"><div class="eyebrow">Gold left today · ' + esc(dateLabel(day.key)) + '</div><div class="big">' + coinNum(L.gold) +
      '<span class="unit">gold<br>coins</span></div><p class="sub">' + sub + '</p>' + nowLine(day) + holidayChips(day.key) + '</section>';
  }
  function heroFuture(day, mode, past) {
    var t = day.tot, open = t.gold - t.planned;
    var eyebrow = (mode === 'tomorrow' ? 'Gold tomorrow · ' : 'Gold on ') + dateLabel(day.key);
    var sub = past ? E.fmtDur(t.gold) + ' of free time' + (t.planned ? ', ' + E.fmtDur(t.planned) + ' planned' : '') + '.'
      : '<b>' + E.fmtDur(open) + '</b> open · <b>' + E.fmtDur(t.planned) + '</b> planned · up at ' + E.fmt12(day.wake) + ', bed at ' + E.fmt12(day.bed);
    return '<section class="hero"><div class="eyebrow">' + esc(eyebrow) + '</div><div class="big">' + coinNum(t.gold) + '<span class="unit">gold<br>coins</span></div><p class="sub">' + sub + '</p>' + holidayChips(day.key) + '</section>';
  }
  function nightly(day) {
    var nm = day.nowMin; if (nm == null || nm < Math.min(19 * 60, day.bed - 150)) return '';
    var tk = E.addDays(day.key, 1), tm = model(tk), open = tm.tot.gold - tm.tot.planned;
    if (tm.tot.gold <= 0) return '';
    var msg = tm.tot.planned ? 'Tomorrow still has <b>' + E.fmtDur(open) + '</b> of gold open (' + E.fmtDur(tm.tot.planned) + ' planned).' : 'Tomorrow has <b>' + E.fmtDur(tm.tot.gold) + '</b> of gold. Decide what it’s for before bed.';
    return note('gold', '<strong>Plan tomorrow.</strong> ' + msg, '<button type="button" class="btn sm primary" data-act="tab" data-tab="tomorrow">Plan tomorrow</button>');
  }
  function gBannerText() {
    return { reauth: 'Reconnect Google Calendar in claude.ai under Settings → Connectors.', notconnected: 'Add Google Calendar in claude.ai under Settings → Connectors.',
      select: 'Choose which Google Calendar connection Epock should use when Claude asks.', denied: 'Google Calendar is switched off for Epock.',
      blocked: 'Your organization doesn’t allow Google Calendar here.', approval: 'Google Calendar is waiting for your OK.' }[G.status] || '';
  }
  function asOf() { var at = cacheAt() || G.lastAt; return at ? ', so this is your schedule as of ' + esc(ago(at)) + '.' : '.'; }
  function gBanner() {
    var again = '<button type="button" class="btn sm" data-act="g-connect">Try again</button>';
    if (STANDALONE) {
      switch (G.status) {
        case 'setup': return note('gold', '<strong>Connect Google Calendar</strong> so school periods, classes and practices turn into coins. It takes about 5 minutes, once.', '<button type="button" class="btn sm primary" data-act="go-setup">Set up</button>');
        case 'connecting': return hasAnySchedule() ? '' : note('', 'Connecting to Google Calendar…');
        case 'stale': return note('warn', (navigator.onLine === false ? 'You’re offline' : 'Google Calendar isn’t answering right now') + asOf(), again);
        case 'error': return note('warn', esc(G.msg || 'Google Calendar didn’t answer.'), '<button type="button" class="btn sm" data-act="go-setup">Setup</button>' + again);
        default: return '';
      }
    }
    switch (G.status) {
      case 'connect': return note('gold', '<strong>Connect Google Calendar</strong> so school periods, classes and practices turn into coins.', '<button type="button" class="btn sm primary" data-act="g-connect">Connect</button>');
      case 'connecting': return hasAnySchedule() ? '' : note('', 'Connecting to Google Calendar…');
      case 'denied': return note('warn', 'Google Calendar is switched off for Epock, so changes to your calendar won’t show up here.', '<button type="button" class="btn sm" data-act="g-manage">Turn it on</button>');
      case 'reauth': case 'notconnected': case 'select': return note('warn', gBannerText(), again);
      case 'blocked': return note('warn', gBannerText());
      case 'approval': return note('warn', gBannerText(), '<button type="button" class="btn sm primary" data-act="g-approve">Allow</button>');
      case 'stale': return note('warn', 'Google Calendar isn’t answering right now' + asOf(), again);
      case 'error': return note('warn', esc(G.msg || 'Google Calendar didn’t answer.'), again);
      case 'unavailable': return hasAnySchedule() ? note('', 'Live sync isn’t available in this view, so this is your schedule as of ' + esc(ago(cacheAt())) + '. Open Epock in claude.ai to refresh it.')
        : note('', 'Live Google sync isn’t available in this view. Open Epock in claude.ai to sync, or import an .ics file in Setup.', '<button type="button" class="btn sm" data-act="go-setup">Setup</button>');
      default: return '';
    }
  }
  function unsortedSoon() {
    var t = todayKey(), evs = rangeEvents(t, E.addDays(t, 7)).filter(function (e) { return e.cat === 'ask' && !e.ad; }).sort(function (a, b) { return a.s - b.s; });
    if (!evs.length) return '';
    var titles = uniq(evs.map(function (e) { return e.t || 'Untitled'; })), e0 = evs[0], d0 = E.dkey(new Date(e0.s)), a = (e0.s - E.k2d(d0).getTime()) / 60000;
    var msg = titles.length === 1 ? '“' + esc(titles[0]) + '” needs a color.' : titles.length + ' events need a color, starting with “' + esc(titles[0]) + '”.';
    return note('', '<strong>' + msg + '</strong> Until then its time isn’t counted as gold.',
      '<button type="button" class="btn sm" data-act="recolor" data-id="' + esc(e0.id) + '" data-cal="' + esc(e0.cal) + '" data-title="' + esc(e0.t) + '" data-d="' + d0 + '" data-a="' + a + '" data-b="' + (a + (e0.e - e0.s) / 60000) + '">Choose</button>');
  }
  function banners() {
    var out = [gBanner(), unsortedSoon()];
    if (Store.notOwner) out.push(note('', 'This is someone else’s Epock. Anything you change stays in this browser only.'));
    if (Store.readonly) out.push(note('warn', 'Saving is turned off in this view, so changes won’t be kept.'));
    return out.join('');
  }
  function syncBar() {
    var st = S(); if (!st.wb.on) return '';
    var n = pendingSync(); if (!n) return '';
    var what = n + (n === 1 ? ' change isn’t' : ' changes aren’t') + ' on your ' + esc(calName(st.wb.cal)) + ' calendar yet.';
    if (G.status !== 'live') return note('', what + ' Connect Google Calendar to add them.');
    return note('gold', what, '<button type="button" class="btn sm primary" data-act="g-sync"' + (G.syncing ? ' disabled' : '') + '>' + (G.syncing ? 'Adding…' : 'Add to Google') + '</button>');
  }
  function logRow() {
    var a = activeLog();
    if (a) {
      var k = LOGK[a.k] || { name: 'Self-care', em: '🧼' };
      return '<div class="logbar live" role="status"><span class="pulse"></span><span>' + k.em + ' ' + k.name + '</span><span class="timer" data-timer="' + a.s + '">' + clock(Date.now() - a.s) + '</span><button type="button" class="btn sm" data-act="log-stop">Stop</button></div>';
    }
    return '<div class="logbar"><span class="lead">Log time</span>' + Object.keys(LOGK).map(function (k) { return '<button type="button" class="chip" data-act="log-start" data-k="' + k + '">' + LOGK[k].em + ' ' + LOGK[k].name + '</button>'; }).join('') +
      '<button type="button" class="chip ghost" data-act="log-sheet">Earlier…</button></div>';
  }
  function usualsHTML(key, day) {
    var us = E.usuals(rangeEvents(E.addDays(key, -7), E.addDays(key, 8)), key).slice(0, 8);
    if (!us.length) return '';
    var taken = day.plans.map(function (p) { return String(p.t).toLowerCase(); });
    return '<section class="sec"><div class="sec-h"><h3>Your usual</h3><span class="muted">From your calendar</span></div><div class="chips">' +
      us.map(function (u) {
        var done = taken.indexOf(u.t.toLowerCase()) !== -1;
        return '<button type="button" class="chip" data-act="usual" data-d="' + key + '" data-a="' + u.a + '" data-b="' + u.b + '" data-t="' + esc(u.t) + '"' + (done ? ' disabled' : '') + '><span aria-hidden="true">' + E.guessEmoji(u.t) +
          '</span><span class="lbl">' + esc(u.t) + '</span><span class="muted">' + E.fmtRange(u.a, u.b) + (u.same ? '' : '*') + '</span></button>';
      }).join('') + '</div>' + (us.some(function (u) { return !u.same; }) ? '<p class="muted" style="font-size:12.5px">* usually on another day</p>' : '') + '</section>';
  }

  /* ---------- Views ---------- */
  function viewToday() {
    var key = todayKey(), day = model(key);
    return [banners(), heroToday(day), nightly(day), trayHTML(day, 'today'), logRow(), syncBar(), windowsHTML(day, 'today'), ledgerHTML(day, 'Today')].join('');
  }
  function viewDay(key, mode) {
    var today = todayKey(); if (key === today) return viewToday();
    var past = key < today, day = model(key);
    var back = mode === 'day' ? '<button type="button" class="back" data-act="tab" data-tab="cal">' + ICON.prev.replace('<svg', '<svg width="16" height="16"') + 'Calendar</button>' : '';
    var label = mode === 'tomorrow' ? 'Tomorrow' : dateLabel(key, { weekday: 'long' });
    return [back, banners(), heroFuture(day, mode, past), past ? '' : syncBar(), past ? '' : usualsHTML(key, day), trayHTML(day, past ? 'past' : 'future'),
      windowsHTML(day, past ? 'past' : 'future'), ledgerHTML(day, label)].join('');
  }
  function weekStartOf(k) { return E.addDays(k, -((E.wday(k) + 6) % 7)); }
  function calDays() {
    var a = UI.calAnchor || todayKey(), out = [], i;
    if (UI.calMode === 'week') { var s = weekStartOf(a); for (i = 0; i < 7; i++) out.push(E.addDays(s, i)); return out; }
    var month = a.slice(0, 7), s2 = weekStartOf(month + '-01');
    for (i = 0; i < 42; i++) { var k = E.addDays(s2, i); if (i === 35 && k.slice(0, 7) !== month) break; out.push(k); }
    return out;
  }
  function viewCal() {
    var days = calDays(), today = todayKey(), a = UI.calAnchor || today, label;
    if (UI.calMode === 'week') {
      var f = E.k2d(days[0]), l = E.k2d(days[6]);
      label = f.getMonth() === l.getMonth() ? f.toLocaleDateString(LOC, { month: 'short' }) + ' ' + f.getDate() + '–' + l.getDate() : f.toLocaleDateString(LOC, { month: 'short', day: 'numeric' }) + ' – ' + l.toLocaleDateString(LOC, { month: 'short', day: 'numeric' });
    } else label = E.k2d(a.slice(0, 7) + '-01').toLocaleDateString(LOC, { month: 'long', year: 'numeric' });
    var html = '<div class="calbar"><h2>' + esc(label) + '</h2><div class="seg" role="group" aria-label="Calendar view">' +
      '<button type="button" data-act="cal-mode" data-m="week" aria-pressed="' + (UI.calMode === 'week') + '">Week</button><button type="button" data-act="cal-mode" data-m="month" aria-pressed="' + (UI.calMode === 'month') + '">Month</button></div>' +
      '<button type="button" class="iconbtn" data-act="cal-nav" data-n="-1" aria-label="Previous">' + ICON.prev + '</button><button type="button" class="btn sm" data-act="cal-nav" data-n="0">Today</button>' +
      '<button type="button" class="iconbtn" data-act="cal-nav" data-n="1" aria-label="Next">' + ICON.next + '</button></div>';
    html += banners();
    html += UI.calMode === 'week' ? weekGrid(days, today) : monthGrid(days, today, a.slice(0, 7));
    html += '<div class="legend-coins">' + [['school', 'School'], ['commute', 'Commute'], ['class', 'Classes'], ['sleep', 'Sleep'], ['care', 'Bathroom, shower & meals'], ['gold', 'Gold (free)'], ['plan', 'Planned gold']]
      .map(function (x) { return '<span>' + sw(x[0]) + x[1] + '</span>'; }).join('') + '</div>';
    return html;
  }
  function weekGrid(days, today) {
    var models = days.map(function (k) { return model(k); }), now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
    var html = '<div class="week"><span></span>' + models.map(function (d) {
      var dt = E.k2d(d.key);
      return '<button type="button" class="wk-day' + (d.key === today ? ' today' : '') + '" data-act="open-day" data-d="' + d.key + '" aria-label="Open ' + esc(dateLabel(d.key, { weekday: 'long', month: 'long', day: 'numeric' })) + '"><span>' +
        dt.toLocaleDateString(LOC, { weekday: 'short' }) + '</span><b>' + dt.getDate() + '</b><span class="g">' + E.fmtDur(d.tot.gold) + '</span></button>';
    }).join('');
    for (var h = 0; h < 24; h++) {
      html += '<span class="wk-h">' + h12(h) + (h < 12 ? 'a' : 'p') + '</span>';
      models.forEach(function (d) {
        var state = '', p = 0;
        if (d.key < today) state = 'past';
        else if (d.key === today) { if (nowM >= (h + 1) * 60) state = 'past'; else if (nowM >= h * 60) { state = 'now'; p = Math.round((nowM - h * 60) * 6); } }
        html += '<div class="wk-c">' + coinHTML(d, h, { mini: true, state: state, p: p }) + '</div>';
      });
    }
    return html + '</div>';
  }
  function monthGrid(days, today, month) {
    var html = '<div class="month">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (w) { return '<span class="mhead">' + w + '</span>'; }).join('');
    days.forEach(function (k) {
      var d = model(k), out = k.slice(0, 7) !== month, runs = E.dayRuns(d);
      html += '<button type="button" class="mday' + (out ? ' out' : '') + (k === today ? ' today' : '') + '" data-act="open-day" data-d="' + k + '" aria-label="' + esc(dateLabel(k, { weekday: 'long', month: 'long', day: 'numeric' })) + ': ' + E.fmtDur(d.tot.gold) + ' of gold">' +
        '<span class="dn">' + E.k2d(k).getDate() + '</span><span class="daycoin" style="--g:' + E.conic(runs, 360 / E.NS) + '">' + glitter(E.planMask(runs, 360 / E.NS)) + '</span><span class="g">' + Math.round(d.tot.gold / 60) + 'h</span></button>';
    });
    return html + '</div>';
  }
  function details(id, title, right, body) {
    return '<details class="set" data-sec="' + id + '"' + (UI.open[id] ? ' open' : '') + '><summary><span>' + title + '</span>' + (right || '') + '</summary><div class="body">' + body + '</div></details>';
  }
  function opts(list, cur) { return list.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === cur ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); }
  function calRows() {
    var st = S();
    return (G.calList || Object.keys(st.cals).filter(function (id) { return id.indexOf('ics:') !== 0; }).map(function (id) { return { id: id, name: st.cals[id].name || id }; }));
  }
  function calColorRows() {
    var st = S();
    return calRows().map(function (c) {
      var cfg = st.cals[c.id] || { inc: true, cat: 'auto' };
      return '<div class="r"><label class="check grow"><input type="checkbox" data-set="cal" data-cal="' + esc(c.id) + '" data-f="inc"' + (cfg.inc !== false ? ' checked' : '') + '><span class="name">' + esc(c.name) + '</span></label>' +
        '<select data-set="cal" data-cal="' + esc(c.id) + '" data-f="cat" aria-label="Color for ' + esc(c.name) + '">' + opts(CAL_CATS, cfg.cat || 'auto') + '</select></div>';
    }).join('');
  }
  var BRIDGE_STEPS = [
    'Open <a href="https://script.google.com/create" target="_blank" rel="noopener">script.google.com/create</a>, signed in to the Google account that has your calendars. A new Apps Script project opens.',
    'Click <b>Untitled project</b> and rename it <b>Epock bridge</b>. Select all the code in the editor, delete it, and paste the bridge code. Press Ctrl+S (⌘S on a Mac) to save.',
    'In the left sidebar, click <b>+</b> next to <b>Services</b>, choose <b>Google Calendar API</b>, and click <b>Add</b>.',
    'Click <b>Deploy → New deployment</b>. Click the gear next to “Select type” and choose <b>Web app</b>. Set <b>Execute as</b> to <b>Me</b> and <b>Who has access</b> to <b>Anyone</b>, then click <b>Deploy</b>.',
    'Click <b>Authorize access</b> and pick your account. Google warns that it hasn’t verified the app, because it’s your own script: click <b>Advanced</b>, then <b>Go to Epock bridge (unsafe)</b>, then <b>Allow</b>.',
    'Copy the <b>Web app URL</b> (it ends in /exec) and paste it below.'
  ];
  function bridgeForm(val) {
    return '<div class="fld wide"><label for="bridge-url">Bridge link</label><div class="inline"><input id="bridge-url" type="url" inputmode="url" spellcheck="false" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(val) + '" style="flex:1 1 260px">' +
      '<button type="button" class="btn sm primary" data-act="bridge-save">Connect</button></div></div><p class="err" id="bridge-err" role="alert"></p>' +
      '<p class="hint">Keep this link private, like a password: anyone who has it can see your calendar.</p>';
  }
  function secGoogleChrome() {
    var linked = PLAT.configured();
    var pill = !linked ? ['', 'Not connected'] : ({ live: ['ok', 'Live'], connecting: ['', 'Connecting'], boot: ['', 'Starting'], stale: ['warn', 'Saved copy'] }[G.status] || ['warn', 'Needs attention']);
    var body;
    if (!linked) {
      body = '<p class="hint">Epock reaches Google Calendar through a small “bridge” that runs in your own Google account. You make it once, in about 5 minutes, and Epock syncs on its own after that.</p>' +
        '<ol class="steps">' + BRIDGE_STEPS.map(function (t, i) { return '<li>' + t + (i === 1 ? ' <button type="button" class="btn sm gold" data-act="copy-bridge">Copy bridge code</button>' : '') + '</li>'; }).join('') + '</ol>' + bridgeForm('');
    } else {
      var rows = calColorRows();
      body = '<p class="hint">Epock reads these calendars through your Google bridge while it’s open. Choose a color for each one. “Sort by title” uses your color rules.</p>' +
        (G.status === 'error' && G.msg ? '<p class="err">' + esc(G.msg) + '</p>' : '') +
        '<div class="inline"><button type="button" class="btn sm" data-act="g-connect">Sync now</button><span class="muted" style="font-size:13px">' + (G.lastAt ? 'Last synced ' + ago(G.lastAt) : '') + '</span></div>' +
        (rows ? '<div class="rows">' + rows + '</div>' : '<p class="hint">Your calendars appear here once the bridge answers.</p>') +
        '<details class="more"><summary>Bridge link</summary><div class="body">' + bridgeForm(PLAT.getUrl()) +
        '<p class="hint">Changed the bridge code? In Apps Script choose Deploy → Manage deployments → Edit, set Version to New version, and click Deploy. The link stays the same.</p>' +
        '<div class="inline"><button type="button" class="btn sm" data-act="copy-bridge">Copy bridge code</button><button type="button" class="btn sm danger" data-act="bridge-clear">Disconnect</button></div></div></details>';
    }
    return details('google', 'Google Calendar', '<span class="pill ' + pill[0] + '">' + pill[1] + '</span>', body);
  }
  function secGoogle() {
    if (STANDALONE) return secGoogleChrome();
    var st = S(), rows = calRows().map(function (c) {
      var cfg = st.cals[c.id] || { inc: true, cat: 'auto' };
      return '<div class="r"><label class="check grow"><input type="checkbox" data-set="cal" data-cal="' + esc(c.id) + '" data-f="inc"' + (cfg.inc !== false ? ' checked' : '') + '><span class="name">' + esc(c.name) + '</span></label>' +
        '<select data-set="cal" data-cal="' + esc(c.id) + '" data-f="cat" aria-label="Color for ' + esc(c.name) + '">' + opts(CAL_CATS, cfg.cat || 'auto') + '</select></div>';
    }).join('');
    var pill = { live: ['ok', 'Live'], connecting: ['', 'Connecting'], boot: ['', 'Starting'], connect: ['', 'Not connected'], unavailable: ['', 'Not available here'] }[G.status] || ['warn', 'Needs attention'];
    var btn = G.mcp ? '<button type="button" class="btn sm" data-act="g-connect">' + (G.status === 'live' ? 'Sync now' : 'Connect Google Calendar') + '</button>' : '';
    return details('google', 'Google Calendar', '<span class="pill ' + pill[0] + '">' + pill[1] + '</span>',
      '<p class="hint">Epock reads these calendars through your Claude connection whenever it’s open. Choose a color for each one. “Sort by title” uses your color rules.</p>' +
      '<div class="inline">' + btn + (G.status === 'denied' ? '<button type="button" class="btn sm" data-act="g-manage">Open permissions</button>' : '') +
      '<span class="muted" style="font-size:13px">' + (G.lastAt ? 'Last synced ' + ago(G.lastAt) : '') + '</span></div>' +
      (rows ? '<div class="rows">' + rows + '</div>' : '<p class="hint">Your calendars appear here once Google Calendar is connected.</p>'));
  }
  function secPicks() {
    var st = S(), list = calRows().filter(function (c) { return !/#holiday@|^c_classroom|^classroom\d/.test(c.id); });
    if (!list.some(function (c) { return c.id === st.wb.cal; })) list.unshift({ id: st.wb.cal, name: st.wb.cal === 'primary' ? 'Main calendar' : calName(st.wb.cal) });
    return details('picks', 'Picks on Google Calendar', '<span class="pill ' + (st.wb.on ? 'ok' : '') + '">' + (st.wb.on ? 'On' : 'Off') + '</span>',
      '<label class="check"><input type="checkbox" data-set="wb" data-f="on"' + (st.wb.on ? ' checked' : '') + '> Add what I pick to Google Calendar</label>' +
      '<label class="fld">Calendar<select data-set="wb" data-f="cal">' + opts(list.map(function (c) { return [c.id, c.name]; }), st.wb.cal) + '</select></label>' +
      '<p class="hint">Picks wait for “Add to Google”, so you can shuffle them first. Removing a pick removes the event Epock made. Events you made yourself are never deleted; if one already matches a pick, Epock links to it instead of adding a copy.</p>');
  }
  function secSleep() {
    var st = S(), rows = NIGHTS.map(function (n, i) {
      return '<div class="r"><span class="grow name">' + n + ' night</span><label class="inline lbl">Bed <input type="time" step="300" data-set="sleep" data-i="' + i + '" data-f="bed" value="' + esc(st.sleep[i].bed) + '"></label>' +
        '<label class="inline lbl">Up <input type="time" step="300" data-set="sleep" data-i="' + i + '" data-f="wake" value="' + esc(st.sleep[i].wake) + '"></label></div>';
    }).join('');
    var n0 = st.sleep[0];
    return details('sleep', 'Sleep', '<span class="pill">' + E.fmt12(E.hm(n0.bed) || 0) + '–' + E.fmt12(E.hm(n0.wake) || 0) + '</span>',
      '<p class="hint">Red coins. “Sunday night” ends Monday morning.</p><div class="rows">' + rows + '</div><button type="button" class="btn sm" data-act="sleep-copy">Use Sunday night for every night</button>');
  }
  function secSchool() {
    var sc = S().school;
    return details('school', 'School day', '',
      '<p class="hint">Orange coins come from your school calendar’s class periods. Breaks between them stay gold, so you can plan them.</p>' +
      '<label class="inline">Gaps shorter than <input type="number" min="0" max="30" step="5" data-set="school" data-f="gap" value="' + esc(sc.gap) + '" aria-label="Passing time limit in minutes"> min count as passing time</label>' +
      '<label class="check"><input type="checkbox" data-set="school" data-f="lunch"' + (sc.lunch !== false ? ' checked' : '') + '> Count the start of the long midday break as lunch</label>' +
      '<div class="inline"><label class="inline">Lunch takes <input type="number" min="5" max="90" step="5" data-set="school" data-f="lunchMin" value="' + esc(sc.lunchMin) + '" aria-label="Lunch minutes"> min</label>' +
      '<label class="inline">between <input type="time" step="300" data-set="school" data-f="lunchFrom" value="' + esc(sc.lunchFrom) + '" aria-label="Earliest lunch"> and <input type="time" step="300" data-set="school" data-f="lunchTo" value="' + esc(sc.lunchTo) + '" aria-label="Latest lunch"></label></div>');
  }
  var KINDS = [['to', 'To school'], ['from', 'Home from school'], ['other', 'Other trip']];
  function secCommute() {
    var st = S(), order = st.commute.map(function (c, i) { return i; }).sort(function (x, y) {
      var a = st.commute[x], b = st.commute[y], da = ((+a.day || 0) + 6) % 7, db = ((+b.day || 0) + 6) % 7;
      return da - db || String(a.a || '').localeCompare(String(b.a || ''));
    });
    var rows = order.map(function (i) {
      var c = st.commute[i];
      return '<div class="r cm"><input type="checkbox" data-set="cm" data-i="' + i + '" data-f="on"' + (c.on !== false ? ' checked' : '') + ' aria-label="Use this commute">' +
        '<input class="grow" data-set="cm" data-i="' + i + '" data-f="name" value="' + esc(c.name) + '" maxlength="40" aria-label="Name">' +
        '<select data-set="cm" data-i="' + i + '" data-f="day" aria-label="Day">' + opts(NIGHTS.map(function (n, k) { return [String(k), n.slice(0, 3)]; }), String(c.day)) + '</select>' +
        '<input type="time" step="300" data-set="cm" data-i="' + i + '" data-f="a" value="' + esc(c.a || '') + '" aria-label="Leave">' +
        '<span class="lbl">to</span><input type="time" step="300" data-set="cm" data-i="' + i + '" data-f="b" value="' + esc(c.b || '') + '" aria-label="Arrive">' +
        '<select data-set="cm" data-i="' + i + '" data-f="kind" aria-label="Kind of trip">' + opts(KINDS, c.kind || 'other') + '</select>' +
        '<button type="button" class="x" data-act="cm-del" data-i="' + i + '" aria-label="Remove ' + esc(c.name) + '">✕</button></div>';
    }).join('');
    return details('commute', 'Commuting', '<span class="pill">' + st.commute.filter(function (c) { return c.on !== false; }).length + '</span>',
      '<p class="hint">Blue coins. “To school” and “Home from school” trips only count on school days. A trip to school always ends before the first thing there that morning: if an event titled with one of the words below (or your first class) starts earlier, the trip moves earlier and keeps its length.</p>' +
      '<label class="fld">Move trips to school before events titled<input data-set="cshift" value="' + esc(st.commuteShift) + '" maxlength="120" placeholder="office hour, swim"></label>' +
      (rows ? '<div class="rows">' + rows + '</div>' : '<p class="hint">No commutes yet.</p>') +
      '<button type="button" class="btn sm" data-act="cm-add" style="justify-self:start">Add a commute</button>');
  }
  function secRoutine() {
    var st = S(), rows = st.routine.map(function (r, i) {
      var timing = r.at === 'fixed' ? '<input type="time" step="300" data-set="rt" data-i="' + i + '" data-f="time" value="' + esc(r.time || '12:00') + '" aria-label="Start time">'
        : '<label class="inline lbl">' + (r.at === 'wake' ? 'starts' : 'ends') + ' <input type="number" min="0" max="240" step="5" data-set="rt" data-i="' + i + '" data-f="off" value="' + esc(r.off || 0) + '" aria-label="Minutes"> min ' + (r.at === 'wake' ? 'after waking' : 'before bed') + '</label>';
      return '<div class="r"><input class="grow" data-set="rt" data-i="' + i + '" data-f="name" value="' + esc(r.name) + '" maxlength="40" aria-label="Name">' +
        '<select data-set="rt" data-i="' + i + '" data-f="cat" aria-label="Color">' + opts([['care', 'Self-care'], ['school', 'School'], ['class', 'Classes'], ['sleep', 'Sleep']], r.cat) + '</select>' +
        '<select data-set="rt" data-i="' + i + '" data-f="at" aria-label="When it starts">' + opts([['wake', 'After waking'], ['bed', 'Before bed'], ['fixed', 'At a set time']], r.at) + '</select>' + timing +
        '<label class="inline lbl"><input type="number" min="5" max="240" step="5" data-set="rt" data-i="' + i + '" data-f="dur" value="' + esc(r.dur) + '" aria-label="Length in minutes"> min long</label>' +
        '<select data-set="rt" data-i="' + i + '" data-f="when" aria-label="Which days">' + opts([['any', 'Every day'], ['school', 'School days'], ['noschool', 'Days off']], r.when || 'any') + '</select>' +
        '<button type="button" class="x" data-act="rt-del" data-i="' + i + '" aria-label="Remove ' + esc(r.name) + '">✕</button></div>';
    }).join('');
    return details('routine', 'Bathroom, shower & meals', '',
      '<p class="hint">Brown coins that repeat. Calendar events and class periods win if they overlap. For bathroom trips and snacks you didn’t plan, use “Log time” on Today.</p><div class="rows">' + rows + '</div><button type="button" class="btn sm" data-act="rt-add">Add a routine</button>');
  }
  function secRules() {
    var st = S(), rows = st.rules.map(function (r, i) {
      return '<div class="r"><span class="lbl">Title has</span><input class="grow" data-set="rule" data-i="' + i + '" data-f="m" value="' + esc(r.m) + '" maxlength="60" aria-label="Words to match">' +
        '<select data-set="rule" data-i="' + i + '" data-f="c" aria-label="Color">' + opts(PICK_CATS, r.c) + '</select><button type="button" class="x" data-act="rule-del" data-i="' + i + '" aria-label="Remove rule">✕</button></div>';
    }).join('');
    return details('rules', 'Color rules', '<span class="pill">' + st.rules.length + '</span>',
      '<p class="hint">Rules beat a calendar’s color, and the first match wins. “My time” hides an event so its time stays gold for you to decide on.</p>' + (rows ? '<div class="rows">' + rows + '</div>' : '') +
      '<button type="button" class="btn sm" data-act="rule-add">Add a rule</button>');
  }
  function secActs() {
    var st = S();
    return details('acts', 'Things to pick', '', '<p class="hint">Quick choices when you spend gold. Your own-time calendar blocks show up as “Your usual” too.</p><div class="chips">' +
      st.acts.map(function (a, i) { return '<span class="chip">' + esc(a.em) + ' ' + esc(a.name) + '<button type="button" class="x" style="width:22px;height:22px" data-act="act-del" data-i="' + i + '" aria-label="Remove ' + esc(a.name) + '">✕</button></span>'; }).join('') +
      '</div><div class="inline"><input id="act-em" class="em" maxlength="4" value="⭐" aria-label="Emoji"><input id="act-name" placeholder="New activity" maxlength="40" aria-label="Activity name"><button type="button" class="btn sm" data-act="act-add">Add</button></div>');
  }
  function secICS() {
    var st = S(), ids = Object.keys(st.cals).filter(function (id) { return id.indexOf('ics:') === 0; });
    var rows = ids.map(function (id) {
      var c = st.cals[id];
      return '<div class="r"><label class="check grow"><input type="checkbox" data-set="cal" data-cal="' + esc(id) + '" data-f="inc"' + (c.inc !== false ? ' checked' : '') + '><span class="name">' + esc(c.name || 'Imported calendar') + ' <span class="muted">· ' + (c.n || 0) + ' events</span></span></label>' +
        '<select data-set="cal" data-cal="' + esc(id) + '" data-f="cat" aria-label="Color for ' + esc(c.name) + '">' + opts(CAL_CATS, c.cat || 'auto') + '</select><button type="button" class="x" data-act="ics-del" data-id="' + esc(id) + '" aria-label="Remove ' + esc(c.name) + '">✕</button></div>';
    }).join('');
    return details('ics', 'iCalendar files (.ics)', ids.length ? '<span class="pill">' + ids.length + '</span>' : '',
      '<p class="hint">For iCloud, Outlook or a school portal: export the calendar as an .ics file and import it here. Epock keeps a private copy, so import a fresh file when it changes.</p>' +
      (rows ? '<div class="rows">' + rows + '</div>' : '') + '<label class="btn sm" style="justify-self:start">Import .ics file<input type="file" id="ics-file" class="vh" accept=".ics,text/calendar"></label>');
  }
  function secAbout() {
    if (STANDALONE) return details('about', 'Your data', '',
      '<p class="hint">Epock keeps your settings, picks and logs in Chrome on this computer. Download a backup now and then. You can also use a backup to move Epock to another computer.</p>' +
      '<div class="inline"><button type="button" class="btn sm" data-act="backup">Download a backup</button><label class="btn sm">Restore a backup<input type="file" id="restore-file" class="vh" accept=".json,application/json"></label></div>' +
      '<p class="hint">Backups leave out your bridge link, so keep that somewhere safe too. Google Calendar is read only while Epock is open.</p>' +
      '<button type="button" class="btn sm danger" data-act="reset-ask" style="justify-self:start">Reset Epock</button>');
    return details('about', 'Your data', '', '<p class="hint">' + (Store.mode === 'db' ? 'Your settings, picks and logs are saved privately with this page in your Claude account. Only you can open them.' : 'Epock is saving to this browser only.') +
      ' Google Calendar is read only while Epock is open.</p><button type="button" class="btn sm danger" data-act="reset-ask" style="justify-self:start">Reset Epock</button>');
  }
  function viewSetup() {
    return '<h2 class="page-title">Setup</h2>' + banners() + [secGoogle(), secPicks(), secSleep(), secSchool(), secCommute(), secRoutine(), secRules(), secActs(), secICS(), secAbout()].join('');
  }
  function skeletonHTML() {
    var html = '<section class="hero"><div class="eyebrow">Opening your coin tray</div><div class="big"><span class="n" style="opacity:.25">–</span></div><p class="sub">Loading your schedule…</p></section><div class="tray skeleton">';
    SHELVES.forEach(function (s, r) {
      html += '<div class="shelf"><div class="shelf-l"><span>' + s[0] + '</span><span class="faint">' + s[1] + '</span></div><div class="coinrow">';
      for (var c = 0; c < 6; c++) html += '<div class="well"><span class="coin"><span class="body"></span><span class="rim"></span><span class="face"><span class="num">' + h12(r * 6 + c) + '</span></span></span></div>';
      html += '</div></div>';
    });
    return html + '</div>';
  }
  function viewHTML() {
    if (Store.mode === 'boot' && !Store.get(SETTINGS)) return skeletonHTML();
    switch (UI.tab) {
      case 'tomorrow': return viewDay(E.addDays(todayKey(), 1), 'tomorrow');
      case 'day': return viewDay(UI.dayKey || todayKey(), 'day');
      case 'cal': return viewCal();
      case 'setup': return viewSetup();
      default: return viewToday();
    }
  }

  /* ---------- Sheets ---------- */
  function sheetHTML(s) {
    if (s.type === 'hour') return sheetHour(s);
    if (s.type === 'pick') return sheetPick(s);
    if (s.type === 'recolor') return sheetRecolor(s);
    if (s.type === 'log') return sheetLog(s);
    if (s.type === 'ics') return sheetIcs(s);
    if (s.type === 'restore') return '<h2>Restore this backup?</h2><p class="muted">Saved ' + (s.at ? esc(new Date(s.at).toLocaleString(LOC, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : 'at an unknown time') +
      '. It replaces the settings, picks and logs on this computer.</p><div class="actions"><span class="sp"></span><button type="button" class="btn" data-act="sheet-close">Cancel</button><button type="button" class="btn primary" data-act="restore-do">Restore</button></div>';
    if (s.type === 'code') return '<h2>Bridge code</h2><p class="muted">Copy all of it (Ctrl+C, or ⌘C on a Mac), then paste it into Apps Script.</p><textarea id="code-box" class="code" readonly rows="14" aria-label="Bridge code">' + esc(PLAT ? PLAT.code : '') + '</textarea>' +
      '<div class="actions"><span class="sp"></span><button type="button" class="btn primary" data-act="sheet-close">Done</button></div>';
    if (s.type === 'reset') return '<h2>Reset Epock?</h2><p class="muted">This clears your settings, picks, logs and saved schedule in Epock. Your Google Calendar isn’t touched.</p><div class="actions"><span class="sp"></span><button type="button" class="btn" data-act="sheet-close">Cancel</button><button type="button" class="btn primary" data-act="reset-do">Reset</button></div>';
    return '';
  }
  function winAt(day, min) { return day.windows.filter(function (w) { return w.a <= min && min < w.b; })[0]; }
  function sheetHour(s) {
    var day = model(s.d), sg = E.hourSegs(day, s.h), canPick = s.d >= todayKey();
    var rows = sg.map(function (seg) {
      var it = day.items[seg.ref], label, sub, action = '';
      if (seg.color === 'gold') {
        var w = winAt(day, seg.a); label = 'Gold'; sub = 'Free time';
        if (canPick && w) action = '<button type="button" class="btn sm gold" data-act="pick" data-d="' + day.key + '" data-a="' + w.a + '" data-b="' + w.b + '" data-from="' + seg.a + '">Pick</button>';
      } else if (seg.color === 'plan') {
        var p = day.plans[seg.pref] || {}; label = (p.em || '🪙') + ' ' + (p.t || 'Pick'); sub = 'Planned gold';
        action = '<button type="button" class="btn sm" data-act="plan" data-d="' + day.key + '" data-pid="' + esc(p.id) + '">Edit</button>';
      } else if (it) {
        label = it.t;
        sub = it.k === 'event' ? CAT[it.c] + ' · ' + calName(it.cal) : it.k === 'routine' ? 'Routine · change it in Setup' : it.k === 'lunch' ? 'Lunch at school · set in Setup' :
          it.k === 'commute' ? 'Commute' + (it.moved ? ' · moved from ' + E.fmtRange(it.moved.a, it.moved.b) + ' for ' + it.moved.why : '') + ' · edit in Setup' :
          it.k === 'passing' ? 'Between blocks' : it.k === 'sleep' ? 'Sleep · set in Setup' : it.k === 'log' ? 'Logged' : CAT[it.c] || '';
        if (it.k === 'event') action = '<button type="button" class="btn sm" data-act="recolor" data-d="' + day.key + '" data-id="' + esc(it.id) + '" data-cal="' + esc(it.cal) + '" data-title="' + esc(it.title) + '" data-a="' + it.a + '" data-b="' + it.b + '">Change</button>';
        if (it.k === 'log') action = '<button type="button" class="btn sm" data-act="log-del" data-lid="' + esc(it.lid) + '" data-d="' + day.key + '">Remove</button>';
      } else { label = CAT[seg.color] || ''; sub = ''; }
      return '<li>' + sw(seg.color) + '<div class="sg"><div class="sg-t">' + esc(label) + '</div><div class="sg-s">' + E.fmtRange(seg.a, seg.b) + (sub ? ' · ' + esc(sub) : '') + '</div></div>' + action + '</li>';
    }).join('');
    return '<div class="hourhead">' + coinHTML(day, s.h, { still: true }) + '<div><h2>' + hourName(s.h) + '</h2><p class="muted">' + esc(dateLabel(s.d, { weekday: 'long', month: 'long', day: 'numeric' })) + '</p></div></div>' +
      '<ul class="seglist">' + rows + '</ul><div class="actions"><button type="button" class="btn" data-act="log-sheet" data-d="' + s.d + '" data-h="' + s.h + '">Log self-care here</button><span class="sp"></span><button type="button" class="btn" data-act="sheet-close">Done</button></div>';
  }
  function sheetPick(s) {
    var st = S(), editing = !!s.pid;
    var us = E.usuals(rangeEvents(E.addDays(s.d, -7), E.addDays(s.d, 8)), s.d).slice(0, 6);
    var chips = us.map(function (u) { return '<button type="button" class="chip" data-act="pk-fill" data-t="' + esc(u.t) + '" data-em="' + E.guessEmoji(u.t) + '" data-a="' + u.a + '" data-b="' + u.b + '"><span aria-hidden="true">' + E.guessEmoji(u.t) + '</span><span class="lbl">' + esc(u.t) + '</span></button>'; })
      .concat(st.acts.map(function (a) { return '<button type="button" class="chip" data-act="pk-fill" data-t="' + esc(a.name) + '" data-em="' + esc(a.em) + '"><span aria-hidden="true">' + esc(a.em) + '</span>' + esc(a.name) + '</button>'; })).join('');
    return '<h2>' + (editing ? 'Edit pick' : 'Pick for ' + E.fmtRange(s.wa, s.wb)) + '</h2><p class="muted">' + esc(dateLabel(s.d, { weekday: 'long', month: 'short', day: 'numeric' })) + ' · ' + E.fmtDur(s.wb - s.wa) + ' of gold here</p>' +
      (s.note ? '<p class="muted">' + esc(s.note) + '</p>' : '') + '<div class="chips">' + chips + '</div>' +
      '<div class="form"><label class="fld wide">What<span class="inline"><input id="pk-em" class="em" value="' + esc(s.em || '🪙') + '" maxlength="4" aria-label="Emoji"><input id="pk-t" value="' + esc(s.t || '') + '" placeholder="e.g. SSAT vocab" maxlength="60"></span></label>' +
      '<label class="fld">Start<input id="pk-a" type="time" step="300" value="' + E.hhmm(s.a) + '"></label><label class="fld">End<input id="pk-b" type="time" step="300" value="' + E.hhmm(s.b) + '"></label></div>' +
      '<div class="chips">' + [10, 15, 20, 30, 45, 60, 90].filter(function (m) { return m < s.wb - s.wa; }).map(function (m) { return '<button type="button" class="chip" data-act="pk-dur" data-m="' + m + '">' + E.fmtDur(m) + '</button>'; }).join('') +
      '<button type="button" class="chip" data-act="pk-dur" data-m="all">Until ' + E.fmt12(s.wb) + '</button></div><p class="err" id="pk-err" role="alert"></p>' +
      '<div class="actions">' + (editing ? '<button type="button" class="btn danger" data-act="pk-del">Remove</button>' : '') + '<span class="sp"></span><button type="button" class="btn" data-act="sheet-close">Cancel</button><button type="button" class="btn primary" data-act="pk-save">' + (editing ? 'Save' : 'Add pick') + '</button></div>';
  }
  function sheetRecolor(s) {
    var st = S(), cur = E.classify(s.title, s.cal, s.id, st), scopes = s.title ? [['title', 'Every event called “' + s.title + '”'], ['one', 'Only this one']] : [['cal', 'Everything in ' + calName(s.cal)], ['one', 'Only this one']];
    return '<h2>' + esc(s.title || 'Untitled event') + '</h2><p class="muted">' + esc(calName(s.cal)) + ' · ' + esc(dateLabel(s.d)) + ' · ' + E.fmtRange(s.a, s.b) + '</p>' +
      '<fieldset><legend class="muted" style="margin-bottom:6px">Apply to</legend>' + scopes.map(function (o, i) { return '<label class="radio"><input type="radio" name="rc-scope" value="' + o[0] + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(o[1]) + '</label>'; }).join('') + '</fieldset>' +
      '<div class="catgrid">' + PICK_CATS.map(function (c) { return '<button type="button" class="catbtn' + (c[0] === cur ? ' on' : '') + '" data-act="rc-set" data-c="' + c[0] + '"><span class="sw" style="--c:var(--c-' + c[2] + ')"></span>' + c[1] + '</button>'; }).join('') + '</div>' +
      '<p class="muted" style="font-size:13px">“My time” hides the event in Epock, so its time stays gold for you to decide on.</p>';
  }
  function sheetLog(s) {
    var d = s.d || todayKey(), now = new Date(), start = s.h != null ? s.h * 60 : Math.max(0, Math.floor((now.getHours() * 60 + now.getMinutes() - 10) / 5) * 5);
    return '<h2>Log self-care</h2><p class="muted">' + esc(dateLabel(d, { weekday: 'long', month: 'short', day: 'numeric' })) + ' · shows as brown coins</p><div class="chips" role="radiogroup" aria-label="What">' +
      Object.keys(LOGK).map(function (k, i) { return '<label class="chip radio"><input type="radio" name="lg-k" value="' + k + '"' + (i === 0 ? ' checked' : '') + '>' + LOGK[k].em + ' ' + LOGK[k].name + '</label>'; }).join('') + '</div>' +
      '<div class="form"><label class="fld">Started<input id="lg-a" type="time" step="300" value="' + E.hhmm(start) + '"></label><label class="fld">Minutes<input id="lg-m" type="number" min="1" max="180" value="10"></label></div><p class="err" id="lg-err" role="alert"></p>' +
      '<div class="actions"><span class="sp"></span><button type="button" class="btn" data-act="sheet-close">Cancel</button><button type="button" class="btn primary" data-act="log-add" data-d="' + d + '">Add</button></div>';
  }
  function sheetIcs(s) {
    var first = Infinity, last = 0; s.events.forEach(function (e) { first = Math.min(first, e.s); last = Math.max(last, e.e); });
    var range = isFinite(first) ? ' from ' + new Date(first).toLocaleDateString(LOC, { month: 'short', day: 'numeric', year: 'numeric' }) + ' to ' + new Date(last).toLocaleDateString(LOC, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    return '<h2>Import “' + esc(s.name) + '”</h2><p class="muted">' + s.events.length + ' events' + range + '. Repeating events keep repeating.</p>' +
      '<label class="fld">What color are these?<select id="ics-cat">' + opts(CAL_CATS.filter(function (c) { return c[0] !== 'holiday'; }), 'auto') + '</select></label>' +
      '<div class="actions"><span class="sp"></span><button type="button" class="btn" data-act="sheet-close">Cancel</button><button type="button" class="btn primary" data-act="ics-import">Import</button></div>';
  }
  function openSheet(s) { lastFocus = document.activeElement; UI.sheet = s; renderSheet(); }
  function renderSheet() {
    var el = $('#sheet'), scrim = $('#scrim');
    if (!UI.sheet) { el.hidden = true; scrim.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = sheetHTML(UI.sheet); el.hidden = false; scrim.hidden = false;
    var box = UI.sheet.type === 'code' ? $('#code-box') : null;
    if (box) { box.focus({ preventScroll: true }); box.select(); return; }
    var f = el.querySelector('.btn.primary, input, .btn'); if (f) f.focus({ preventScroll: true });
  }
  function closeSheet() { UI.sheet = null; renderSheet(); if (lastFocus && document.body.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* gone */ } } queueRender(); }

  var toastTimer = 0;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3400); }

  /* ---------- Render ---------- */
  function renderDock() {
    var cur = UI.tab === 'day' ? 'cal' : UI.tab;
    Array.prototype.forEach.call(document.querySelectorAll('#dock button'), function (b) { if (b.dataset.tab === cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  }
  function renderTop() {
    var t = todayKey();
    $('#ctx').textContent = UI.tab === 'today' ? dateLabel(t) : UI.tab === 'tomorrow' ? 'Tomorrow · ' + dateLabel(E.addDays(t, 1)) : UI.tab === 'day' && UI.dayKey ? dateLabel(UI.dayKey) : UI.tab === 'cal' ? 'Calendar' : 'Setup';
    var chip = $('#syncchip'), txt = $('#synctext'), cls = '', label;
    switch (G.status) {
      case 'live': label = G.lastAt && Date.now() - G.lastAt > 15 * 60000 ? 'Synced ' + ago(G.lastAt) : 'Live'; cls = 'live'; break;
      case 'boot': case 'connecting': label = 'Connecting'; cls = 'busy'; break;
      case 'connect': case 'setup': label = 'Not connected'; break;
      case 'unavailable': label = hasAnySchedule() ? 'Saved copy' : 'Offline'; break;
      case 'stale': label = 'Saved copy'; cls = 'warn'; break;
      default: label = 'Needs attention'; cls = 'warn';
    }
    if (G.syncing) { label = 'Adding picks'; cls = 'busy'; }
    chip.className = 'syncchip ' + cls; txt.textContent = label;
  }
  function queueRender() { if (renderQueued) return; renderQueued = true; (window.requestAnimationFrame || setTimeout)(renderNow); }
  function renderNow() {
    renderQueued = false;
    renderTop(); renderDock();
    var view = $('#view'), ae = document.activeElement;
    if (ae && view.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && ae.type !== 'checkbox' && ae.type !== 'file') { deferMain = true; return; }
    deferMain = false;
    view.innerHTML = viewHTML();
    enterNext = false;
    syncSubs();
  }
  function syncSubs() {
    var months = neededMonths();
    if (Store.mode === 'db') {
      Store.watch(SETTINGS); Store.watchIcs();
      var want = {}; months.forEach(function (m) { ['plans/', 'logs/', 'cache/'].forEach(function (p) { want[p + m] = 1; }); });
      Object.keys(Store.subs).forEach(function (p) { if (p !== SETTINGS && !want[p]) Store.release(p); });
      Object.keys(want).forEach(function (p) { Store.watch(p); });
    }
    ensureWatches();
  }
  var HASH_OF = { today: '#today', tomorrow: '#tomorrow', cal: '#calendar', day: '#calendar', setup: '#setup' };
  function tabFromHash() { return { '#today': 'today', '#tomorrow': 'tomorrow', '#calendar': 'cal', '#setup': 'setup' }[location.hash] || null; }
  function goTab(tab, key) {
    UI.tab = tab; if (key) UI.dayKey = key; enterNext = true; saveUI();
    if (STANDALONE && location.hash !== HASH_OF[tab]) { try { history.replaceState(null, '', HASH_OF[tab]); } catch (e) { /* fine */ } }
    try { window.scrollTo({ top: 0 }); } catch (e) { window.scrollTo(0, 0); }
    queueRender();
  }

  /* ---------- Actions ---------- */
  function openPick(key, wa, wb, from) {
    var day = model(key), s = Math.max(wa, from == null ? wa : from);
    while (s < wb && day.pref[s / 5] !== -1) s += 5; if (s >= wb) s = wa;
    var e = s; while (e < wb && day.pref[e / 5] === -1 && day.cat[e / 5] === E.C.gold) e += 5;
    var len = e - s; if (len <= 0) len = Math.min(30, wb - s);
    openSheet({ type: 'pick', d: key, wa: wa, wb: wb, a: s, b: s + (len <= 45 ? len : 30) });
  }
  function editPick(key, pid) {
    var p = findPlan(key, pid); if (!p) return;
    var day = model(key, { without: pid }), w = winAt(day, p.a) || { a: p.a, b: p.b };
    openSheet({ type: 'pick', d: key, pid: pid, wa: w.a, wb: Math.max(w.b, p.b), a: p.a, b: p.b, t: p.t, em: p.em });
  }
  function readPickForm() {
    var s = UI.sheet, a = E.hm($('#pk-a').value), b = E.hm($('#pk-b').value);
    if (b === 0 && a > 0) b = 1440;
    return { a: a, b: b, t: $('#pk-t').value.trim(), em: $('#pk-em').value.trim() || '🪙', s: s };
  }
  function savePick() {
    var f = readPickForm(), s = f.s, err = $('#pk-err');
    if (!f.t) { err.textContent = 'Name what you’ll do with this gold.'; $('#pk-t').focus(); return; }
    if (f.a == null || f.b == null || f.b <= f.a) { err.textContent = 'The end time needs to be after the start time.'; return; }
    f.a = Math.round(f.a / 5) * 5; f.b = Math.round(f.b / 5) * 5;
    var chk = fitCheck(s.d, f.a, f.b, s.pid);
    if (!chk.ok) {
      var x = chk.x, it = chk.day.items[chk.day.ref[x]], w = winAt(chk.day, f.a);
      var what = chk.day.cat[x] === E.C.gold ? 'another pick' : (it && it.t) || CAT[E.CKEY[chk.day.cat[x]]];
      err.textContent = 'That runs into ' + what + ' at ' + E.fmt12(x * 5) + '.' + (w ? ' Gold here runs ' + E.fmtRange(w.a, w.b) + '.' : '');
      return;
    }
    savePlan(s.d, f.a, f.b, f.t, f.em, s.pid);
    closeSheet();
    toast((s.pid ? 'Updated ' : 'Picked ') + f.t + ' · ' + E.fmtRange(f.a, f.b));
  }
  function addUsual(key, a, b, t) {
    var chk = fitCheck(key, a, b);
    if (chk.ok) { savePlan(key, a, b, t, E.guessEmoji(t)); toast('Picked ' + t + ' · ' + E.fmtRange(a, b)); return; }
    var w = chk.day.windows.filter(function (w) { return w.b > a && w.len >= 10; })[0] || chk.day.windows.filter(function (w) { return w.len >= 10; }).slice(-1)[0];
    if (!w) { toast('There’s no gold left that day.'); return; }
    var s0 = Math.max(w.a, Math.min(a, w.b - 10)), e0 = Math.min(w.b, s0 + (b - a));
    openSheet({ type: 'pick', d: key, wa: w.a, wb: w.b, a: s0, b: e0, t: t, em: E.guessEmoji(t), note: E.fmtRange(a, b) + ' isn’t all gold that day, so this starts in the nearest gold window.' });
  }
  function applyRecolor(c) {
    var s = UI.sheet, scope = (document.querySelector('input[name="rc-scope"]:checked') || {}).value || 'one';
    editSettings(function (st) {
      if (scope === 'title' && s.title) {
        var low = s.title.toLowerCase();
        st.rules = st.rules.filter(function (r) { return String(r.m || '').toLowerCase() !== low; });
        st.rules.unshift({ m: s.title, c: c });
      } else if (scope === 'cal') st.cals[s.cal] = Object.assign({ inc: true }, st.cals[s.cal] || {}, { cat: c });
      else st.overrides[s.id] = c;
    });
    closeSheet();
    toast((s.title || 'That event') + ' is now ' + (c === 'free' ? 'your own time (gold)' : CAT[c]) + '.');
  }
  function addLogFromSheet(key) {
    var k = (document.querySelector('input[name="lg-k"]:checked') || {}).value || 'bath', a = E.hm($('#lg-a').value), m = +$('#lg-m').value;
    if (a == null || !(m > 0)) { $('#lg-err').textContent = 'Add a start time and minutes.'; return; }
    addPastLog(k, E.k2d(key).getTime() + a * 60000, Math.min(m, 240));
    closeSheet(); toast(LOGK[k].name + ' · ' + E.fmtDur(m) + ' logged');
  }
  function handleIcsFile(input) {
    var file = input.files && input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast('That file is over 8 MB. Export a shorter date range and try again.'); return; }
    file.text().then(function (text) {
      var parsed; try { parsed = ICS.parse(text); } catch (e) { parsed = { events: [] }; }
      var lo = Date.now() - 60 * 864e5, hi = Date.now() + 550 * 864e5;
      var evs = parsed.events.filter(function (e) { return e.rr || (e.e >= lo && e.s <= hi); });
      if (!evs.length) { toast('No current events found in that file.'); return; }
      openSheet({ type: 'ics', name: (parsed.name || file.name.replace(/\.ics$/i, '')).slice(0, 60), events: evs });
    }, function () { toast('Couldn’t read that file.'); });
  }
  function importIcs() {
    var s = UI.sheet, cat = $('#ics-cat').value, imp = uid('i');
    var compact = s.events.map(function (e) { return [e.u, e.t, e.s, e.e, e.ad, e.rr || '', e.ex && e.ex.length ? e.ex : 0, e.rid || 0]; });
    for (var i = 0, n = 0; i < compact.length; i += 300, n++) { Store.loaded['ics/' + imp + '-' + n] = true; Store.set('ics/' + imp + '-' + n, { imp: imp, n: n, ev: compact.slice(i, i + 300) }, 0); }
    editSettings(function (st) { st.cals['ics:' + imp] = { inc: true, cat: cat, name: s.name, n: compact.length }; });
    closeSheet(); toast('Imported ' + compact.length + ' events from “' + s.name + '”.');
  }
  function deleteIcs(id) {
    var imp = id.slice(4);
    Object.keys(Store.docs).forEach(function (p) { if (p.indexOf('ics/' + imp + '-') === 0) Store.del(p); });
    editSettings(function (st) { delete st.cals[id]; });
  }
  function backupData() {
    var docs = {};
    Object.keys(Store.docs).forEach(function (p) { if (p.indexOf('cache/') !== 0 && Store.docs[p] !== undefined) docs[p] = Store.docs[p]; });
    return { app: 'epock', v: 1, at: Date.now(), docs: docs };
  }
  function downloadBackup() {
    var blob = new Blob([JSON.stringify(backupData())], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'epock-backup-' + todayKey() + '.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    toast('Backup saved to your Downloads folder.');
  }
  var RESTORABLE = /^(epock\/settings|plans\/\d{4}-\d{2}|logs\/\d{4}-\d{2}|ics\/[A-Za-z0-9_-]{1,80})$/;
  function readBackup(input) {
    var file = input.files && input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('That file is too big to be an Epock backup.'); return; }
    file.text().then(function (text) {
      var data; try { data = JSON.parse(text); } catch (e) { data = null; }
      if (!data || data.app !== 'epock' || !data.docs || typeof data.docs !== 'object') { toast('That isn’t an Epock backup file.'); return; }
      var paths = Object.keys(data.docs).filter(function (p) { return RESTORABLE.test(p) && data.docs[p] && typeof data.docs[p] === 'object' && !Array.isArray(data.docs[p]); });
      if (!paths.length) { toast('That backup is empty.'); return; }
      openSheet({ type: 'restore', at: +data.at || 0, data: data, paths: paths });
    }, function () { toast('Couldn’t read that file.'); });
  }
  function applyRestore() {
    var s = UI.sheet, keep = {};
    if (!s || s.type !== 'restore') return;
    s.paths.forEach(function (p) { keep[p] = 1; });
    Object.keys(Store.docs).forEach(function (p) { if (p.indexOf('cache/') !== 0 && !keep[p]) Store.del(p); });
    s.paths.forEach(function (p) { Store.set(p, clone(s.data.docs[p]), 0); });
    closeSheet(); toast('Backup restored.');
    if (G.status === 'live') mergeCalendars();
  }
  function pruneCache() {
    var keep = E.mkey(E.addDays(todayKey(), -62));
    Object.keys(Store.docs).forEach(function (p) { if (p.indexOf('cache/') === 0 && p.slice(6) < keep) Store.del(p); });
  }
  function copyBridgeCode() {
    var showBox = function () { openSheet({ type: 'code' }); };
    try { navigator.clipboard.writeText(PLAT.code).then(function () { toast('Bridge code copied. Paste it into Apps Script.'); }, showBox); } catch (e) { showBox(); }
  }
  function saveBridge() {
    var inp = $('#bridge-url'), err = $('#bridge-err'), chk = PLAT.check(inp ? inp.value : '');
    if (!chk.ok) { if (err) err.textContent = chk.msg; if (inp) inp.focus(); return; }
    if (inp) inp.blur();
    PLAT.setUrl(chk.url);
    G.calList = null; G.live = Object.create(null); G.errs = Object.create(null);
    gConnect(true);
  }
  function clearBridge() {
    PLAT.setUrl('');
    Object.keys(G.watches).forEach(function (k) { try { G.watches[k](); } catch (e) { /* gone */ } delete G.watches[k]; });
    G.calList = null; G.live = Object.create(null); G.errs = Object.create(null); G.status = 'setup'; G.msg = '';
    bump(); toast('Disconnected. Your saved schedule stays in Epock.');
  }
  function resetAll() {
    var paths = Object.keys(Store.docs);
    if (Store.mode === 'db') ['plans', 'logs', 'cache', 'ics'].forEach(function (c) {
      Promise.resolve(Store.db.collection(c).get()).then(function (snap) { snap.docs.forEach(function (d) { var p = c + '/' + d.id; if (paths.indexOf(p) === -1) Store.del(p); }); }, function () { /* best effort */ });
    });
    paths.forEach(function (p) { Store.del(p); });
    lsKeys('epock:m:').forEach(function (k) { lsSet(k, undefined); });
    closeSheet(); toast('Epock was reset.');
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!t) { if (ev.target.id === 'scrim') closeSheet(); return; }
    var d = t.dataset, a = d.act;
    switch (a) {
      case 'tab': if (UI.sheet) closeSheet(); goTab(d.tab); break;
      case 'go-setup': UI.open.google = true; goTab('setup'); break;
      case 'hour': openSheet({ type: 'hour', d: d.d, h: +d.h }); break;
      case 'pick': openPick(d.d, +d.a, +d.b, d.from != null ? +d.from : null); break;
      case 'plan': editPick(d.d, d.pid); break;
      case 'usual': addUsual(d.d, +d.a, +d.b, d.t); break;
      case 'pk-fill': {
        $('#pk-t').value = d.t; $('#pk-em').value = d.em || '🪙';
        if (d.a != null && UI.sheet && +d.a >= UI.sheet.wa && +d.b <= UI.sheet.wb) { $('#pk-a').value = E.hhmm(+d.a); $('#pk-b').value = E.hhmm(+d.b); }
        $('#pk-err').textContent = ''; break;
      }
      case 'pk-dur': {
        var st0 = E.hm($('#pk-a').value); if (st0 == null) st0 = UI.sheet.a;
        var end = d.m === 'all' ? UI.sheet.wb : Math.min(UI.sheet.wb, st0 + (+d.m));
        $('#pk-b').value = E.hhmm(end); $('#pk-err').textContent = ''; break;
      }
      case 'pk-save': savePick(); break;
      case 'pk-del': { var s = UI.sheet; removePlan(s.d, s.pid); closeSheet(); toast('Pick removed.'); break; }
      case 'recolor': openSheet({ type: 'recolor', id: d.id, cal: d.cal, title: d.title || '', d: d.d, a: +d.a, b: +d.b }); break;
      case 'rc-set': applyRecolor(d.c); break;
      case 'log-start': startLog(d.k); break;
      case 'log-stop': stopLog(); break;
      case 'log-sheet': openSheet({ type: 'log', d: d.d || todayKey(), h: d.h != null ? +d.h : null }); break;
      case 'log-add': addLogFromSheet(d.d); break;
      case 'log-del': delLog(d.lid, d.d); closeSheet(); toast('Log removed.'); break;
      case 'g-connect': gConnect(); break;
      case 'copy-bridge': copyBridgeCode(); break;
      case 'bridge-save': saveBridge(); break;
      case 'bridge-clear': clearBridge(); break;
      case 'backup': downloadBackup(); break;
      case 'restore-do': applyRestore(); break;
      case 'g-manage':
        if (G.perms) Promise.resolve(G.perms.manage()).then(function () { gBoot(G.mcp, G.perms); }, function () { toast('Turn Google Calendar back on from this page’s Permissions menu.'); });
        else toast('Turn Google Calendar back on from this page’s Permissions menu.');
        break;
      case 'g-sync': gSyncPicks(); break;
      case 'g-approve': gApprove(); break;
      case 'cal-mode': UI.calMode = d.m; saveUI(); queueRender(); break;
      case 'cal-nav': {
        var n = +d.n, anc = UI.calAnchor || todayKey();
        if (!n) UI.calAnchor = null;
        else if (UI.calMode === 'week') UI.calAnchor = E.addDays(anc, 7 * n);
        else UI.calAnchor = E.addMonths(anc.slice(0, 7), n) + '-01';
        queueRender(); break;
      }
      case 'open-day': {
        var k = d.d, td = todayKey();
        goTab(k === td ? 'today' : k === E.addDays(td, 1) ? 'tomorrow' : 'day', k); break;
      }
      case 'sleep-copy': editSettings(function (st) { var n0 = st.sleep[0]; st.sleep = ALLDAYS.map(function () { return { bed: n0.bed, wake: n0.wake }; }); }); toast('Every night now matches Sunday night.'); break;
      case 'rt-add': editSettings(function (st) { st.routine.push({ id: uid('r'), name: 'Snack', cat: 'care', at: 'fixed', time: '16:00', dur: 15, when: 'any' }); }); break;
      case 'rt-del': editSettings(function (st) { st.routine.splice(+d.i, 1); }); break;
      case 'cm-add': {
        var wd = E.wday(UI.tab === 'tomorrow' ? E.addDays(todayKey(), 1) : todayKey());
        editSettings(function (st) { st.commute.push({ id: uid('c'), name: 'Commute', day: wd, a: '07:00', b: '07:30', kind: 'other' }); });
        UI.open.commute = true; break;
      }
      case 'cm-del': editSettings(function (st) { st.commute.splice(+d.i, 1); }); toast('Commute removed.'); break;
      case 'rule-add': editSettings(function (st) { st.rules.push({ m: '', c: 'class' }); }); break;
      case 'rule-del': editSettings(function (st) { st.rules.splice(+d.i, 1); }); break;
      case 'act-add': {
        var nm = $('#act-name').value.trim(); if (!nm) { $('#act-name').focus(); break; }
        var em = $('#act-em').value.trim() || '⭐';
        editSettings(function (st) { st.acts.push({ id: uid('a'), name: nm.slice(0, 40), em: em }); }); break;
      }
      case 'act-del': editSettings(function (st) { st.acts.splice(+d.i, 1); }); break;
      case 'ics-import': importIcs(); break;
      case 'ics-del': deleteIcs(d.id); toast('Removed that calendar file.'); break;
      case 'reset-ask': openSheet({ type: 'reset' }); break;
      case 'reset-do': resetAll(); break;
      case 'sheet-close': closeSheet(); break;
    }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.id === 'ics-file') { handleIcsFile(el); return; }
    if (el.id === 'restore-file') { readBackup(el); return; }
    var kind = el.dataset && el.dataset.set; if (!kind) return;
    var f = el.dataset.f, i = el.dataset.i != null ? +el.dataset.i : null;
    var val = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, +el.value || 0) : el.value;
    if ((el.type === 'time') && !val) return;
    editSettings(function (st) {
      if (kind === 'sleep' && st.sleep[i]) st.sleep[i][f] = val;
      else if (kind === 'school') st.school[f] = val;
      else if (kind === 'cal') { var id = el.dataset.cal; st.cals[id] = Object.assign({ inc: true, cat: 'auto' }, st.cals[id] || {}); st.cals[id][f] = val; }
      else if (kind === 'wb') st.wb[f] = val;
      else if (kind === 'rt' && st.routine[i]) st.routine[i][f] = val;
      else if (kind === 'cm' && st.commute[i]) st.commute[i][f] = f === 'day' ? +val : f === 'name' ? String(val).slice(0, 40) : val;
      else if (kind === 'cshift') st.commuteShift = String(val).slice(0, 120);
      else if (kind === 'rule' && st.rules[i]) st.rules[i][f] = f === 'm' ? String(val).slice(0, 60) : val;
    });
    if (kind === 'wb' && f === 'on' && val) markLocalNew();
    if (kind === 'cal') ensureWatches();
    if (el.tagName === 'SELECT' || el.type === 'checkbox') { try { el.blur(); } catch (e) { /* fine */ } }
  });
  document.addEventListener('focusout', function () { if (deferMain) setTimeout(function () { if (deferMain) queueRender(); }, 0); });
  document.addEventListener('toggle', function (ev) { var el = ev.target; if (el && el.matches && el.matches('details[data-sec]')) { UI.open[el.dataset.sec] = el.open; saveUI(); } }, true);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && UI.sheet) { closeSheet(); return; }
    if (ev.key === 'Enter' && UI.sheet && UI.sheet.type === 'pick' && ev.target.tagName === 'INPUT') { ev.preventDefault(); savePick(); return; }
    if (ev.key === 'Enter' && ev.target.id === 'bridge-url') { ev.preventDefault(); saveBridge(); }
  });

  /* ---------- Clock and boot ---------- */
  var lastMinute = -1;
  setInterval(function () { var m = Math.floor(Date.now() / 60000); if (m !== lastMinute) { lastMinute = m; if (UI.tab !== 'setup' && !UI.sheet) queueRender(); } }, 15000);
  setInterval(function () { Array.prototype.forEach.call(document.querySelectorAll('[data-timer]'), function (el) { el.textContent = clock(Date.now() - +el.dataset.timer); }); }, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) queueRender(); });

  function use(name) {
    if (!window.claude || typeof window.claude.use !== 'function') return Promise.resolve(null);
    return Promise.resolve().then(function () { return window.claude.use(name); }).catch(function () { return null; });
  }
  function boot() {
    var hashTab = tabFromHash();
    if (hashTab) UI.tab = hashTab; else if (STANDALONE) UI.tab = 'today';
    if (UI.tab === 'day') UI.tab = 'cal';
    if (STANDALONE) {
      Store.useLocal(); pruneCache();
      renderNow(); syncSubs(); bump();
      gBoot(PLAT.mcp, null);
      window.addEventListener('hashchange', function () { var t = tabFromHash(); if (t && t !== UI.tab) { if (UI.sheet) closeSheet(); goTab(t); } });
      window.addEventListener('online', function () { if (G.status === 'stale' || G.status === 'error') gConnect(); });
      return;
    }
    Store.loadMirror();
    renderNow();
    Promise.all([use('db'), use('user'), use('mcp'), use('permissions')]).then(function (r) {
      var db = r[0], user = r[1], mcp = r[2], perms = r[3];
      var owner = user ? Promise.resolve(user.isOwner()).catch(function () { return false; }) : Promise.resolve(false);
      return owner.then(function (isOwner) {
        if (!db) return false;
        if (isOwner) return true;
        return Promise.resolve(db.doc(SETTINGS).get()).then(function (s) { return !!(s && s.exists); }, function () { return false; });
      }).then(function (useDb) {
        if (useDb) Store.useDb(db); else { Store.useLocal(); if (db) Store.notOwner = true; }
        Store.afterBoot();
        syncSubs(); bump();
        gBoot(mcp, perms);
      });
    });
  }
  boot();
})();
