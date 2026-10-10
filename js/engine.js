/* Epock engine: turns sleep, school, calendar events, routines, logs and picks
   into 288 five-minute slices per day, 12 slices to an hour coin. Pure, no DOM. */
(function (root) {
  'use strict';
  var SL = 5, NS = 288, DAY = 1440;
  var C = { gold: 0, sleep: 1, school: 2, class: 3, care: 4, ask: 5, commute: 6 };
  var CKEY = ['gold', 'sleep', 'school', 'class', 'care', 'ask', 'commute'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function dkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function k2d(k) { var p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(k, n) { var d = k2d(k); d.setDate(d.getDate() + n); return dkey(d); }
  function mkey(k) { return k.slice(0, 7); }
  function addMonths(m, n) { var p = m.split('-').map(Number); var d = new Date(p[0], p[1] - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function monthStart(m) { return k2d(m + '-01').getTime(); }
  function wday(k) { return k2d(k).getDay(); }
  function hm(s) { if (typeof s !== 'string') return null; var m = s.match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function hhmm(min) { min = ((Math.round(min) % DAY) + DAY) % DAY; return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function norm(min) { return ((Math.round(min) % DAY) + DAY) % DAY; }
  function fmt12(min, suffix) {
    var m = norm(min), h = Math.floor(m / 60), mm = m % 60, h12 = h % 12 || 12;
    return h12 + ':' + pad(mm) + (suffix === false ? '' : (h < 12 ? ' AM' : ' PM'));
  }
  function ampm(min) { return norm(min) < 720 ? 'AM' : 'PM'; }
  function fmtRange(a, b) {
    if (ampm(a) === ampm(b) && b - a < 720) return fmt12(a, false) + '–' + fmt12(b);
    return fmt12(a) + '–' + fmt12(b);
  }
  function fmtDur(min) {
    min = Math.max(0, Math.round(min)); var h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? h + 'h ' + m + 'm' : h + 'h') : m + 'm';
  }
  // Coins as a whole number plus an exact fraction in twelfths (one twelfth = five minutes).
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function coins(min) {
    var t = Math.max(0, Math.round(min / SL)), w = Math.floor(t / 12), r = t % 12, g = r ? gcd(r, 12) : 1;
    var n = r ? r / g : 0, d = r ? 12 / g : 0;
    return { w: w, n: n, d: d, text: (w || !n ? String(w) : '') + (n ? (w ? ' ' : '') + n + '/' + d : '') };
  }

  // Category names used in settings: school, class, sleep, care, free (hidden, stays gold), auto, holiday, ask.
  var GENERIC = [
    [/\b(sleep|nap|bedtime)\b|잠|수면/i, 'sleep'],
    [/\b(breakfast|lunch|dinner|brunch|meals?|eat|eating|snack|shower|bath|brush)\b|아침|점심|저녁|식사|샤워/i, 'care'],
    [/\b(school|homeroom|advisory|assembly)\b|학교|조회/i, 'school'],
    [/\b(class|classes|lessons?|tutor|tutoring|academy|hagwon|lecture|course|practice|training|rehearsal|club)\b|학원|과외|수업|레슨/i, 'class']
  ];
  function classify(title, cal, id, st) {
    var ov = st.overrides && st.overrides[id]; if (ov) return ov;
    var t = String(title || '').toLowerCase();
    var rules = st.rules || [];
    for (var i = 0; i < rules.length; i++) {
      var m = String(rules[i].m || '').trim().toLowerCase();
      if (m && t.indexOf(m) !== -1) return rules[i].c;
    }
    var cc = st.cals && st.cals[cal]; var def = (cc && cc.cat) || 'auto';
    if (def !== 'auto') return def;
    for (var j = 0; j < GENERIC.length; j++) if (GENERIC[j][0].test(t)) return GENERIC[j][1];
    return 'ask';
  }

  function night(st, w) {
    var n = (st.sleep && st.sleep[w]) || {};
    var b = hm(n.bed); if (b == null) b = 23 * 60; if (b < 720) b += DAY;
    var wk = hm(n.wake); if (wk == null) wk = 7 * 60;
    return { bed: b, wake: wk };
  }
  function dayOn(r, w) { return !r.days || r.days.indexOf(w) !== -1; }

  /* ctx: { st, events:[{id,t,cal,s,e,ad,cat}], plans:[{id,a,b,t,em}], logs:[{id,k,s,e}], now } */
  function computeDay(key, ctx) {
    var st = ctx.st || {}, sc = st.school || {};
    var d0 = k2d(key).getTime();
    var cat = new Uint8Array(NS), ref = new Int16Array(NS).fill(-1), pref = new Int16Array(NS).fill(-1);
    var items = [];
    function addItem(it) { items.push(it); return items.length - 1; }
    function toMin(t) { return (t - d0) / 60000; }
    function sl(m) { return Math.max(0, Math.min(NS, Math.round(m / SL))); }
    function paint(a, b, c, ri, onlyGold) {
      var i0 = sl(a), i1 = sl(b);
      if (i1 <= i0) { if (b > a && i0 < NS && a >= 0) i1 = i0 + 1; else return; }
      for (var i = i0; i < i1; i++) {
        if (onlyGold && (cat[i] !== C.gold || ref[i] !== -1)) continue;
        cat[i] = c; ref[i] = ri;
      }
    }
    var W = wday(key), nPrev = night(st, (W + 6) % 7), nCur = night(st, W);
    var events = (ctx.events || []).filter(function (e) { return !e.ad; });

    // 1. Sleep (this morning, from last night; and tonight).
    var ms0 = Math.max(0, nPrev.bed - DAY);
    if (nPrev.wake > ms0) paint(ms0, nPrev.wake, C.sleep, addItem({ k: 'sleep', t: 'Sleep', c: 'sleep', a: nPrev.bed - DAY, b: nPrev.wake }));
    if (nCur.bed < DAY) paint(nCur.bed, DAY, C.sleep, addItem({ k: 'sleep', t: 'Sleep', c: 'sleep', a: nCur.bed, b: DAY + nCur.wake }));

    function rtTime(r) {
      var dur = Math.max(5, +r.dur || 0), a;
      if (r.at === 'wake') { a = nPrev.wake + (+r.off || 0); return [a, a + dur]; }
      if (r.at === 'bed') { var b = nCur.bed - (+r.off || 0); return [b - dur, b]; }
      a = hm(r.time); if (a == null) return [null, null]; return [a, a + dur];
    }
    var rts = (st.routine || []).filter(function (r) { return r && r.on !== false && dayOn(r, W); });

    // 2. School: class periods, then lunch inside the longest midday break.
    var blocks = [];
    events.forEach(function (e) {
      if (e.cat === 'school') blocks.push({ a: toMin(e.s), b: toMin(e.e), it: { k: 'event', t: e.t || 'Class period', c: 'school', id: e.id, cal: e.cal, title: e.t || '' } });
    });
    rts.forEach(function (r) {
      if (r.cat !== 'school') return; var ab = rtTime(r); if (ab[0] == null) return;
      blocks.push({ a: ab[0], b: ab[1], it: { k: 'routine', t: r.name || 'School', c: 'school', rid: r.id } });
    });
    var schoolDay = blocks.length > 0;
    blocks.sort(function (x, y) { return x.a - y.a || x.b - y.b; });
    blocks.forEach(function (bl) { var it = bl.it; it.a = bl.a; it.b = bl.b; paint(bl.a, bl.b, C.school, addItem(it)); });
    var uni = [];
    blocks.forEach(function (bl) { var l = uni[uni.length - 1]; if (l && bl.a <= l.b) l.b = Math.max(l.b, bl.b); else uni.push({ a: bl.a, b: bl.b }); });
    var gapMin = sc.gap == null ? 10 : +sc.gap;
    var lunch = null;
    if (schoolDay && sc.lunch !== false && uni.length > 1) {
      var lf = hm(sc.lunchFrom) == null ? 660 : hm(sc.lunchFrom), lt = hm(sc.lunchTo) == null ? 810 : hm(sc.lunchTo);
      var lm = sc.lunchMin == null ? 25 : +sc.lunchMin, best = null;
      for (var u = 0; u + 1 < uni.length; u++) {
        var ga = uni[u].b, gb = uni[u + 1].a, g = gb - ga;
        if (g < gapMin || gb <= lf || ga >= lt) continue;
        if (!best || g > best.g) best = { a: ga, b: gb, g: g };
      }
      if (best && lm > 0) {
        var le = Math.min(best.b, best.a + lm);
        lunch = { a: best.a, b: le };
        paint(best.a, le, C.care, addItem({ k: 'lunch', t: 'Lunch', c: 'care', a: best.a, b: le }));
      }
    }

    // 2b. Commutes. A trip to school always ends before the first thing there that morning
    // (office hours, swimming, or the first class), keeping its length.
    var shiftWords = String(st.commuteShift == null ? 'office hour, swim' : st.commuteShift).toLowerCase().split(',')
      .map(function (w) { return w.trim(); }).filter(Boolean);
    var anchors = [];
    events.forEach(function (e) {
      var a = toMin(e.s); if (a < 240 || a >= 720) return;
      var t = String(e.t || '').toLowerCase();
      var hit = shiftWords.filter(function (w) { return t.indexOf(w) !== -1; })[0];
      if (hit || e.cat === 'school') anchors.push({ a: a, t: e.cat === 'school' && !hit ? 'first class' : (e.t || hit) });
    });
    blocks.forEach(function (bl) { if (bl.it.k === 'routine' && bl.a >= 240 && bl.a < 720) anchors.push({ a: bl.a, t: bl.it.t }); });
    anchors.sort(function (x, y) { return x.a - y.a; });
    (st.commute || []).forEach(function (c) {
      if (!c || c.on === false || +c.day !== W) return;
      if ((c.kind === 'to' || c.kind === 'from') && !schoolDay) return;
      var a = hm(c.a), b = hm(c.b); if (a == null || b == null || b <= a) return;
      var moved = null;
      if (c.kind === 'to' && anchors.length && anchors[0].a < b) { var len = b - a; moved = { a: a, b: b, why: anchors[0].t }; b = anchors[0].a; a = b - len; }
      paint(Math.max(0, a), Math.min(DAY, b), C.commute, addItem({ k: 'commute', t: c.name || 'Commute', c: 'commute', cid: c.id, a: a, b: b, moved: moved }));
    });

    // 3. Routine (bathroom, shower, meals...) fills only untouched gold.
    rts.forEach(function (r) {
      if (r.cat === 'school') return;
      if (r.when === 'school' && !schoolDay) return;
      if (r.when === 'noschool' && schoolDay) return;
      var ab = rtTime(r); if (ab[0] == null || ab[0] >= DAY) return;
      var c = C[r.cat] != null ? C[r.cat] : C.care;
      paint(Math.max(0, ab[0]), Math.min(ab[1], DAY), c, addItem({ k: 'routine', t: r.name || 'Routine', c: CKEY[c], rid: r.id, a: ab[0], b: ab[1] }), true);
    });

    // 4. Other calendar events. Shorter events paint last, so they win overlaps.
    events.filter(function (e) { return e.cat !== 'school' && e.cat !== 'free' && e.cat !== 'holiday'; })
      .sort(function (x, y) { return (y.e - y.s) - (x.e - x.s); })
      .forEach(function (e) {
        var c = C[e.cat] != null && e.cat !== 'gold' ? C[e.cat] : C.ask;
        var a = toMin(e.s), b = toMin(e.e);
        paint(a, b, c, addItem({ k: 'event', t: e.t || 'Busy', c: CKEY[c], id: e.id, cal: e.cal, title: e.t || '', a: a, b: b }));
      });

    // 5. Gold slivers shorter than the passing-time limit, between two busy blocks, join the block before.
    var gs = Math.max(1, Math.round(gapMin / SL));
    for (var i = 0; i < NS;) {
      if (cat[i] !== C.gold) { i++; continue; }
      var j = i; while (j < NS && cat[j] === C.gold) j++;
      if (j - i < gs && i > 0 && j < NS) {
        var L = cat[i - 1], R = cat[j];
        if (L !== C.sleep && R !== C.sleep && L !== C.ask && R !== C.ask) {
          var ri = addItem({ k: 'passing', t: 'Passing time', c: CKEY[L], a: i * SL, b: j * SL });
          for (var x = i; x < j; x++) { cat[x] = L; ref[x] = ri; }
        }
      }
      i = j;
    }

    // 6. Logged bathroom/shower/eating time always shows as brown.
    var now = ctx.now;
    (ctx.logs || []).forEach(function (lg) {
      var end = lg.e || now; if (!end) return;
      var a = toMin(lg.s), b = toMin(end); if (b <= 0 || a >= DAY || b <= a) return;
      paint(Math.max(0, a), Math.min(DAY, b), C.care, addItem({ k: 'log', t: lg.t || 'Self-care', c: 'care', lid: lg.id, kind: lg.k, a: a, b: b, live: !lg.e }));
    });

    // 7. Picks sit on gold. Anything that isn't gold any more is a conflict.
    var plans = (ctx.plans || []).slice().sort(function (x, y) { return x.a - y.a; }).map(function (p) {
      var q = {}; for (var k in p) q[k] = p[k]; q.conflict = false; q.fit = 0; return q;
    });
    plans.forEach(function (p, pi) {
      for (var x = sl(p.a); x < sl(p.b); x++) {
        if (cat[x] === C.gold && pref[x] === -1) { pref[x] = pi; p.fit += SL; } else p.conflict = true;
      }
    });

    // 8. Windows of gold, totals, and what's left from now.
    var windows = [];
    for (var w0 = 0; w0 < NS;) {
      if (cat[w0] !== C.gold) { w0++; continue; }
      var w1 = w0, planned = 0, ps = [];
      while (w1 < NS && cat[w1] === C.gold) { if (pref[w1] >= 0) { planned += SL; if (ps.indexOf(pref[w1]) === -1) ps.push(pref[w1]); } w1++; }
      windows.push({ a: w0 * SL, b: w1 * SL, len: (w1 - w0) * SL, planned: planned, plans: ps });
      w0 = w1;
    }
    var tot = { gold: 0, sleep: 0, school: 0, class: 0, care: 0, ask: 0, commute: 0, planned: 0 };
    for (var s = 0; s < NS; s++) { tot[CKEY[cat[s]]] += SL; if (cat[s] === C.gold && pref[s] >= 0) tot.planned += SL; }
    var nowMin = now != null ? toMin(now) : null;
    var left = { gold: tot.gold, open: tot.gold - tot.planned };
    if (nowMin != null) {
      if (nowMin >= DAY) left = { gold: 0, open: 0 };
      else if (nowMin > 0) {
        left = { gold: 0, open: 0 };
        for (var y = 0; y < NS; y++) {
          if (cat[y] !== C.gold) continue;
          var part = Math.max(0, Math.min(SL, (y + 1) * SL - Math.max(y * SL, nowMin)));
          left.gold += part; if (pref[y] < 0) left.open += part;
        }
      }
    }
    return { key: key, d0: d0, cat: cat, ref: ref, pref: pref, items: items, plans: plans, windows: windows,
      tot: tot, left: left, nowMin: nowMin, schoolDay: schoolDay, lunch: lunch, bed: nCur.bed, wake: nPrev.wake };
  }

  function slotColor(day, x) { var c = day.cat[x]; return c === C.gold ? (day.pref[x] >= 0 ? 'plan' : 'gold') : CKEY[c]; }
  // Segments of one hour coin (12 slices) or any slice range.
  function segs(day, x0, x1) {
    var out = [];
    for (var x = x0; x < x1; x++) {
      var color = slotColor(day, x), id = color + ':' + (day.cat[x] === C.gold ? day.pref[x] : day.ref[x]);
      var l = out[out.length - 1];
      if (l && l.id === id) { l.n++; l.b += SL; }
      else out.push({ id: id, color: color, n: 1, a: x * SL, b: (x + 1) * SL, ref: day.ref[x], pref: day.pref[x], cat: CKEY[day.cat[x]] });
    }
    return out;
  }
  function hourSegs(day, h) { return segs(day, h * 12, h * 12 + 12); }
  function conic(sg, step) {
    var deg = 0, parts = sg.map(function (s) { var a = deg; deg += s.n * step; return 'var(--c-' + s.color + ') ' + a.toFixed(2) + 'deg ' + deg.toFixed(2) + 'deg'; });
    return 'conic-gradient(' + parts.join(',') + ')';
  }
  // Where the planned (striped) gold sits on a coin, as a mask: opaque only over planned wedges
  // (or, inverted, only over everything else). Empty when the coin has no planned gold.
  function planMask(sg, step, invert) {
    var deg = 0, any = false;
    var parts = sg.map(function (s) {
      var a = deg, on = (s.color === 'plan') !== !!invert; deg += s.n * step; if (s.color === 'plan') any = true;
      return (on ? '#000 ' : 'transparent ') + a.toFixed(2) + 'deg ' + deg.toFixed(2) + 'deg';
    });
    return any ? 'conic-gradient(' + parts.join(',') + ')' : '';
  }
  // Color runs for a 24-hour coin (1.25 degrees per slice).
  function dayRuns(day) {
    var out = [];
    for (var x = 0; x < NS; x++) {
      var c = slotColor(day, x), l = out[out.length - 1];
      if (l && l.color === c) l.n++; else out.push({ color: c, n: 1 });
    }
    return out;
  }
  function dayConic(day) { return conic(dayRuns(day), 360 / NS); }

  // "Your usual": own-time calendar events grouped by title, with the time they usually happen on that weekday.
  function usuals(evs, targetKey) {
    var W = wday(targetKey), groups = {};
    evs.forEach(function (e) {
      if (e.cat !== 'free' || e.ad || !e.t) return;
      var k = e.t.trim().toLowerCase(); var d = new Date(e.s);
      var a = d.getHours() * 60 + d.getMinutes(), b = a + Math.round((e.e - e.s) / 60000);
      var g = groups[k] || (groups[k] = { t: e.t.trim(), occ: [] });
      g.occ.push({ w: d.getDay(), a: a, b: b });
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], same = g.occ.filter(function (o) { return o.w === W; }), pool = same.length ? same : g.occ, cnt = {};
      pool.forEach(function (o) { var kk = o.a + '-' + o.b; cnt[kk] = (cnt[kk] || 0) + 1; });
      var bestK = Object.keys(cnt).sort(function (p, q) { return cnt[q] - cnt[p]; })[0].split('-').map(Number);
      out.push({ t: g.t, a: bestK[0], b: Math.min(DAY, bestK[1]), same: same.length > 0, n: g.occ.length });
    });
    out.sort(function (p, q) { return (q.same - p.same) || (p.a - q.a); });
    return out;
  }

  var EMOJI = [
    [/math|algebra|calc|geometry|수학/i, '🧮'], [/code|coding|app|dev|program|clearlabel/i, '💻'],
    [/vocab|word|writing|essay|english|ssat|sat\b|read/i, '📝'], [/latin/i, '🏛️'], [/science|chem|bio|physics/i, '🔬'],
    [/swim/i, '🏊'], [/guitar|piano|music|violin/i, '🎸'], [/run|gym|exercise|workout|sport/i, '🏃'],
    [/game/i, '🎮'], [/friend|call|chat/i, '💬'], [/rest|nap|relax/i, '😌'], [/home ?work|hw/i, '📚'], [/study|review|test|exam/i, '📖']
  ];
  function guessEmoji(t) { for (var i = 0; i < EMOJI.length; i++) if (EMOJI[i][0].test(t || '')) return EMOJI[i][1]; return '🪙'; }

  var api = { SL: SL, NS: NS, DAY: DAY, C: C, CKEY: CKEY, pad: pad, dkey: dkey, k2d: k2d, addDays: addDays, mkey: mkey,
    addMonths: addMonths, monthStart: monthStart, wday: wday, hm: hm, hhmm: hhmm, fmt12: fmt12, fmtRange: fmtRange,
    fmtDur: fmtDur, coins: coins, classify: classify, computeDay: computeDay, hourSegs: hourSegs, segs: segs,
    conic: conic, dayConic: dayConic, dayRuns: dayRuns, planMask: planMask, usuals: usuals, guessEmoji: guessEmoji, night: night };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EpockEngine = api;
})(typeof self !== 'undefined' ? self : this);
