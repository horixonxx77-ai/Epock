/* iCalendar (.ics) reader: VEVENTs with RRULE/EXDATE/RECURRENCE-ID, expanded per range. Pure, no DOM. */
(function (root) {
  'use strict';
  function unfold(text) { return String(text || '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, ''); }
  function unescape(v) { return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim(); }
  function parseLine(line) {
    var i = line.indexOf(':'); if (i < 0) return null;
    var head = line.slice(0, i), value = line.slice(i + 1), parts = head.split(';'), params = {};
    for (var p = 1; p < parts.length; p++) { var kv = parts[p].split('='); params[kv[0].toUpperCase()] = (kv[1] || '').replace(/^"|"$/g, ''); }
    return { name: parts[0].toUpperCase(), params: params, value: value };
  }
  function tzOffset(ms, tz) {
    var f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var o = {}; f.formatToParts(new Date(ms)).forEach(function (x) { o[x.type] = x.value; });
    return Date.UTC(+o.year, +o.month - 1, +o.day, (+o.hour) % 24, +o.minute, +o.second) - ms;
  }
  function zoned(y, mo, d, h, mi, s, tz) {
    var wall = Date.UTC(y, mo - 1, d, h, mi, s), guess = wall;
    for (var k = 0; k < 3; k++) guess = wall - tzOffset(guess, tz);
    return guess;
  }
  function parseDate(v, params) {
    v = String(v || '').trim();
    var dm = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dm || params.VALUE === 'DATE') { dm = dm || v.match(/^(\d{4})(\d{2})(\d{2})/); if (!dm) return null; return { ms: new Date(+dm[1], +dm[2] - 1, +dm[3]).getTime(), ad: true }; }
    var m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/); if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +(m[6] || 0);
    if (m[7] === 'Z') return { ms: Date.UTC(y, mo - 1, d, h, mi, s), ad: false };
    if (params.TZID) { try { return { ms: zoned(y, mo, d, h, mi, s, params.TZID), ad: false }; } catch (e) { /* unknown zone: treat as local */ } }
    return { ms: new Date(y, mo - 1, d, h, mi, s).getTime(), ad: false };
  }
  function parseDuration(v) {
    var m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/); if (!m) return null;
    var ms = (((+m[2] || 0) * 7 + (+m[3] || 0)) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
    return m[1] === '-' ? -ms : ms;
  }

  function parse(text) {
    var lines = unfold(text).split('\n'), out = [], cur = null, depth = 0, calName = '';
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i]; if (!ln) continue;
      if (/^BEGIN:VEVENT/i.test(ln)) { cur = { ex: [] }; depth = 0; continue; }
      if (!cur) { var top = parseLine(ln); if (top && top.name === 'X-WR-CALNAME') calName = unescape(top.value); continue; }
      if (/^BEGIN:/i.test(ln)) { depth++; continue; }
      if (/^END:VEVENT/i.test(ln)) {
        if (cur.s != null && cur.status !== 'CANCELLED') {
          var e = cur.e;
          if (e == null) e = cur.dur != null ? cur.s + cur.dur : (cur.ad ? cur.s + 86400000 : cur.s);
          out.push({ u: cur.u || ('x' + out.length), t: cur.t || '', s: cur.s, e: e, ad: cur.ad ? 1 : 0, rr: cur.rr || '', ex: cur.ex, rid: cur.rid || 0 });
        }
        cur = null; continue;
      }
      if (/^END:/i.test(ln)) { depth = Math.max(0, depth - 1); continue; }
      if (depth > 0) continue; // inside VALARM etc.
      var p = parseLine(ln); if (!p) continue;
      switch (p.name) {
        case 'UID': cur.u = p.value.trim(); break;
        case 'SUMMARY': cur.t = unescape(p.value).slice(0, 120); break;
        case 'DTSTART': { var ds = parseDate(p.value, p.params); if (ds) { cur.s = ds.ms; cur.ad = ds.ad; } break; }
        case 'DTEND': { var de = parseDate(p.value, p.params); if (de) cur.e = de.ms; break; }
        case 'DURATION': cur.dur = parseDuration(p.value); break;
        case 'RRULE': cur.rr = p.value.trim(); break;
        case 'STATUS': cur.status = p.value.trim().toUpperCase(); break;
        case 'EXDATE': p.value.split(',').forEach(function (v) { var x = parseDate(v, p.params); if (x) cur.ex.push(x.ms); }); break;
        case 'RECURRENCE-ID': { var r = parseDate(p.value, p.params); if (r) cur.rid = r.ms; break; }
      }
    }
    return { name: calName, events: out };
  }

  var DAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  function parseRule(s) {
    var o = {}; String(s || '').split(';').forEach(function (kv) { var p = kv.split('='); if (p[0]) o[p[0].toUpperCase()] = p[1] || ''; });
    var r = { freq: o.FREQ, interval: Math.max(1, +o.INTERVAL || 1), count: o.COUNT ? +o.COUNT : 0, until: 0, byday: [], bymonthday: [] };
    if (o.UNTIL) { var u = parseDate(o.UNTIL, {}); if (u) r.until = u.ad ? u.ms + 86400000 - 1 : u.ms; }
    if (o.BYDAY) r.byday = o.BYDAY.split(',').map(function (d) { var m = d.match(/^([+-]?\d+)?([A-Z]{2})$/); return m ? { n: m[1] ? +m[1] : 0, w: DAYS[m[2]] } : null; }).filter(Boolean);
    if (o.BYMONTHDAY) r.bymonthday = o.BYMONTHDAY.split(',').map(Number);
    return r;
  }
  function atTime(base, y, mo, d) { var b = new Date(base); return new Date(y, mo, d, b.getHours(), b.getMinutes(), b.getSeconds()).getTime(); }
  function nthWeekday(y, mo, w, n) {
    if (n > 0) { var first = new Date(y, mo, 1).getDay(); var day = 1 + ((w - first + 7) % 7) + (n - 1) * 7; return day <= new Date(y, mo + 1, 0).getDate() ? day : 0; }
    var lastD = new Date(y, mo + 1, 0).getDate(), lastW = new Date(y, mo, lastD).getDay(); var dd = lastD - ((lastW - w + 7) % 7) + (n + 1) * 7; return dd >= 1 ? dd : 0;
  }

  // Occurrences of stored events overlapping [from, to). Events with RECURRENCE-ID replace their original slot.
  function expand(list, from, to) {
    var moved = {}, out = [];
    list.forEach(function (ev) { if (ev.rid) (moved[ev.u] || (moved[ev.u] = {}))[ev.rid] = 1; });
    list.forEach(function (ev) {
      var dur = Math.max(0, ev.e - ev.s);
      function push(s) { if (s < to && s + dur > from) out.push({ id: ev.u + '@' + s, t: ev.t, s: s, e: s + dur, ad: ev.ad }); }
      if (!ev.rr || ev.rid) { push(ev.s); return; }
      var r = parseRule(ev.rr), ex = {}, skip = moved[ev.u] || {};
      (ev.ex || []).forEach(function (x) { ex[x] = 1; });
      var n = 0, guard = 0, start = new Date(ev.s);
      function emit(s) {
        if (s < ev.s) return true;
        if (r.until && s > r.until) return false;
        n++; if (r.count && n > r.count) return false;
        if (!ex[s] && !skip[s]) push(s);
        return s < to + 86400000;
      }
      var y = start.getFullYear(), mo = start.getMonth(), d = start.getDate(), go = true;
      if (r.freq === 'DAILY') {
        for (var i = 0; go && guard < 20000; i += r.interval, guard++) go = emit(atTime(ev.s, y, mo, d + i));
      } else if (r.freq === 'WEEKLY') {
        var wds = r.byday.length ? r.byday.map(function (b) { return b.w; }).sort() : [start.getDay()];
        var weekStart = d - start.getDay();
        for (var wk = 0; go && guard < 20000; wk += r.interval, guard++) {
          for (var k = 0; k < wds.length && go; k++) go = emit(atTime(ev.s, y, mo, weekStart + wk * 7 + wds[k]));
        }
      } else if (r.freq === 'MONTHLY') {
        for (var m = 0; go && guard < 5000; m += r.interval, guard++) {
          var yy = y + Math.floor((mo + m) / 12), mm = (mo + m) % 12, days = [];
          if (r.bymonthday.length) days = r.bymonthday.map(function (x) { return x < 0 ? new Date(yy, mm + 1, 0).getDate() + 1 + x : x; });
          else if (r.byday.length) days = r.byday.map(function (b) { return nthWeekday(yy, mm, b.w, b.n || 1); });
          else days = [d];
          days = days.filter(function (x) { return x >= 1 && x <= new Date(yy, mm + 1, 0).getDate(); }).sort(function (p, q) { return p - q; });
          for (var z = 0; z < days.length && go; z++) go = emit(atTime(ev.s, yy, mm, days[z]));
        }
      } else if (r.freq === 'YEARLY') {
        for (var yr = 0; go && guard < 300; yr += r.interval, guard++) go = emit(atTime(ev.s, y + yr, mo, d));
      } else push(ev.s);
    });
    return out;
  }

  var api = { parse: parse, expand: expand, parseDate: parseDate, parseRule: parseRule };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EpockICS = api;
})(typeof self !== 'undefined' ? self : this);
