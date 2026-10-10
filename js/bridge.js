/* Epock for Chrome: reaches Google Calendar through the user's own Apps Script "bridge".
   Gives the app the same small interface it uses inside claude.ai: callTool, watchTool, invalidate. */
(function () {
  'use strict';
  var LS_URL = 'epock:bridge', LS_MODE = 'epock:bridge-mode';
  var CODE = "/**\n * Epock bridge\n *\n * Lets your Epock app read your Google calendars and add the gold you plan.\n * It runs inside your own Google account, as you. Epock talks to it through\n * this project's Web app link, so keep that link private, like a password.\n *\n * Setup: Services \u2192 + \u2192 Google Calendar API \u2192 Add.\n * Then Deploy \u2192 New deployment \u2192 Web app, Execute as: Me, Who has access: Anyone.\n */\nvar VERSION = 1;\nvar MARK = 'epock:';\n\nfunction doGet(e) {\n  var p = (e && e.parameter) || {};\n  var req = { action: 'hello' };\n  if (p.q) {\n    try { req = JSON.parse(p.q); } catch (err) { req = { action: 'bad' }; }\n  }\n  return reply_(handle_(req), p.callback);\n}\n\nfunction doPost(e) {\n  var req;\n  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { req = { action: 'bad' }; }\n  return reply_(handle_(req));\n}\n\nfunction handle_(req) {\n  try {\n    switch (req && req.action) {\n      case 'hello':\n        return { ok: true, app: 'Epock bridge', version: VERSION, message: 'Your Epock bridge is running. Paste this page\u2019s link into Epock \u2192 Setup.' };\n      case 'ping':\n        return { ok: true, version: VERSION };\n      case 'calendars':\n        return { calendars: listCalendars_() };\n      case 'events':\n        return { results: (req.ranges || []).slice(0, 40).map(function (r) { return listEvents_(r.cal, r.from, r.to); }) };\n      case 'create':\n        return createEvent_(req);\n      case 'delete':\n        return deleteEvent_(req.cal, req.id);\n      default:\n        return { error: 'bad_request', message: 'Epock sent a request this bridge doesn\u2019t know. Update the bridge code.' };\n    }\n  } catch (err) {\n    return { error: 'failed', message: String((err && err.message) || err) };\n  }\n}\n\nfunction reply_(obj, callback) {\n  var json = JSON.stringify(obj);\n  if (callback && /^[A-Za-z_$][\\w$]{0,60}$/.test(callback)) {\n    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);\n  }\n  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);\n}\n\nfunction listCalendars_() {\n  var out = [], pageToken;\n  do {\n    var res = Calendar.CalendarList.list({ maxResults: 250, pageToken: pageToken });\n    (res.items || []).forEach(function (c) {\n      out.push({ id: c.id, summary: c.summaryOverride || c.summary || c.id, accessRole: c.accessRole });\n    });\n    pageToken = res.nextPageToken;\n  } while (pageToken);\n  return out;\n}\n\nfunction listEvents_(cal, from, to) {\n  var events = [], pageToken, pages = 0;\n  try {\n    do {\n      var res = Calendar.Events.list(cal, {\n        timeMin: from, timeMax: to, singleEvents: true, orderBy: 'startTime', maxResults: 2500, pageToken: pageToken\n      });\n      (res.items || []).forEach(function (ev) { events.push(slim_(ev)); });\n      pageToken = res.nextPageToken;\n      pages++;\n    } while (pageToken && pages < 10);\n    return { cal: cal, events: events };\n  } catch (err) {\n    return { cal: cal, error: String((err && err.message) || err) };\n  }\n}\n\n// Only what Epock needs: times, titles, and whether Epock made the event.\nfunction slim_(ev) {\n  var me = (ev.attendees || []).filter(function (a) { return a.self; })\n    .map(function (a) { return { self: true, responseStatus: a.responseStatus }; });\n  return {\n    id: ev.id,\n    status: ev.status,\n    summary: ev.summary || '',\n    start: ev.start,\n    end: ev.end,\n    description: ev.description && ev.description.indexOf(MARK) !== -1 ? ev.description : undefined,\n    attendees: me.length ? me : undefined\n  };\n}\n\nfunction createEvent_(req) {\n  var tz = req.timeZone || Session.getScriptTimeZone();\n  var description = String(req.description || 'Picked in Epock.').slice(0, 500);\n  if (description.indexOf(MARK) === -1) description += ' ' + MARK;\n  var ev = Calendar.Events.insert({\n    summary: String(req.summary || 'Epock pick').slice(0, 200),\n    description: description,\n    start: { dateTime: req.start, timeZone: tz },\n    end: { dateTime: req.end, timeZone: tz }\n  }, req.cal || 'primary');\n  return { id: ev.id };\n}\n\n// Epock only ever removes events it added itself.\nfunction deleteEvent_(cal, id) {\n  var ev;\n  try { ev = Calendar.Events.get(cal, id); } catch (err) { return { gone: true }; }\n  if (!ev || ev.status === 'cancelled') return { gone: true };\n  if (!ev.description || ev.description.indexOf(MARK) === -1) return { gone: true, kept: true };\n  Calendar.Events.remove(cal, id);\n  return { ok: true };\n}\n";
  var EXEC = /^https:\/\/script\.google\.com\/(?:a\/macros\/[A-Za-z0-9.-]+\/|macros\/)s\/[A-Za-z0-9_-]{20,}\/exec$/;
  var OFFLINE_MSG = 'You’re offline.';

  function get(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function put(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* storage blocked */ } }
  function fail(code, message, extra) { var e = { code: code, message: message }; if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; }); return e; }
  function offline() { return navigator.onLine === false; }
  function offlineErr() { return fail('server_unavailable', OFFLINE_MSG, { retryable: true, offline: true }); }

  function clean(u) { return String(u || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, ''); }
  function check(u) {
    u = clean(u);
    if (!u) return { ok: false, msg: 'Paste your bridge link first.' };
    if (/\/dev$/.test(u)) return { ok: false, msg: 'That’s the test link. Copy the Web app URL that ends in /exec instead.' };
    if (!EXEC.test(u)) return { ok: false, msg: 'That doesn’t look like a bridge link. It starts with https://script.google.com/macros/s/ and ends in /exec.' };
    return { ok: true, url: u };
  }

  // Way 1: a plain POST. A text body keeps it a "simple" request, so the browser sends no preflight.
  function viaPost(url, body) {
    return fetch(url, { method: 'POST', body: JSON.stringify(body), redirect: 'follow', cache: 'no-store', credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw fail(r.status === 429 || r.status >= 500 ? 'server_unavailable' : 'bridge_unreachable', 'Your Google bridge answered with error ' + r.status + '.', { retryable: r.status >= 500 });
        return r.text();
      }, function () { throw fail('network', 'Network error'); })
      .then(function (text) {
        try { return JSON.parse(text); } catch (e) { throw fail('bridge_unreachable', 'Your Google bridge didn’t answer like Epock expects.'); }
      });
  }
  // Way 2: a script tag (JSONP), for browsers or networks that block the POST.
  var seq = 0;
  function viaScript(url, body) {
    return new Promise(function (resolve, reject) {
      var name = '__epockBridge' + Date.now().toString(36) + (seq++), el = document.createElement('script'), done = false;
      var timer = setTimeout(function () { end(); reject(fail('server_unavailable', 'Your Google bridge took too long to answer.', { retryable: true })); }, 45000);
      function end() { done = true; clearTimeout(timer); try { delete window[name]; } catch (e) { window[name] = undefined; } if (el.parentNode) el.parentNode.removeChild(el); }
      window[name] = function (data) { if (done) return; end(); resolve(data); };
      el.onerror = function () { if (done) return; end(); reject(offline() ? offlineErr() : fail('bridge_unreachable', 'Couldn’t reach your Google bridge.')); };
      el.onload = function () { setTimeout(function () { if (done) return; end(); reject(fail('bridge_unreachable', 'Your Google bridge didn’t answer like Epock expects.')); }, 0); };
      el.src = url + '?q=' + encodeURIComponent(JSON.stringify(body)) + '&callback=' + name;
      document.head.appendChild(el);
    });
  }
  function call(body) {
    var url = get(LS_URL);
    if (!url) return Promise.reject(fail('server_not_connected', 'Set up your Google bridge in Setup.'));
    if (offline()) return Promise.reject(offlineErr());
    var p = get(LS_MODE) === 'script' ? viaScript(url, body) : viaPost(url, body).catch(function (e) {
      if (!e || e.code !== 'network') throw e;
      if (offline()) throw offlineErr();
      return viaScript(url, body).then(function (j) { put(LS_MODE, 'script'); return j; });
    });
    return p.then(function (j) {
      if (!j || typeof j !== 'object') throw fail('bridge_unreachable', 'Your Google bridge didn’t answer like Epock expects.');
      if (j.error) throw fail('tool_error', j.message || j.error, { bridge: j.error });
      return j;
    });
  }

  // Wall-clock time on this computer ("2026-10-12T08:00:00") → an exact instant for Google.
  function iso(local) { var d = new Date(local); return isNaN(d.getTime()) ? String(local) : d.toISOString(); }
  function dayStart(k) { var p = String(k).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime(); }
  function span(ev) {
    var s = ev.start || {}, e = ev.end || s;
    var a = s.dateTime ? Date.parse(s.dateTime) : s.date ? dayStart(s.date) : NaN;
    var b = e.dateTime ? Date.parse(e.dateTime) : e.date ? dayStart(e.date) : a;
    return [a, b];
  }
  function within(ev, a, b) { var t = span(ev); return (t[0] < b && t[1] > a) || (t[0] === t[1] && t[0] >= a && t[0] < b); }

  function callTool(server, tool, input) {
    input = input || {};
    switch (tool) {
      case 'list_calendars':
        return call({ action: 'calendars' }).then(function (j) { return { content: [], payload: { calendars: j.calendars || [] } }; });
      case 'list_events':
        return call({ action: 'events', ranges: [{ cal: input.calendarId || 'primary', from: iso(input.startTime), to: iso(input.endTime) }] }).then(function (j) {
          var r = (j.results || [])[0] || {};
          if (r.error) throw fail('tool_error', r.error);
          return { content: [], payload: { events: r.events || [] } };
        });
      case 'create_event':
        return call({ action: 'create', cal: input.calendarId || 'primary', summary: input.summary, start: input.startTime, end: input.endTime, timeZone: input.timeZone, description: input.description })
          .then(function (j) { return { content: [], payload: { id: j.id } }; });
      case 'delete_event':
        return call({ action: 'delete', cal: input.calendarId || 'primary', id: input.eventId }).then(function () { return { content: [], payload: {} }; });
      default:
        return Promise.reject(fail('bad_request', 'Epock asked the bridge for something it can’t do: ' + tool));
    }
  }

  // Watches: every month-and-calendar the app shows. They share one bridge call per refresh.
  var watches = [], timer = 0, lastRun = 0, running = false, again = false;
  function soon(ms) { clearTimeout(timer); timer = setTimeout(run, ms); }
  function run() {
    if (running) { again = true; return; }
    var list = watches.filter(function (w) { return w.live; });
    if (!list.length) return;
    var byCal = {};
    list.forEach(function (w) {
      var c = w.input.calendarId || 'primary', a = iso(w.input.startTime), b = iso(w.input.endTime), r = byCal[c];
      if (!r) byCal[c] = { cal: c, from: a, to: b };
      else { if (a < r.from) r.from = a; if (b > r.to) r.to = b; }
    });
    running = true; lastRun = Date.now();
    call({ action: 'events', ranges: Object.keys(byCal).map(function (k) { return byCal[k]; }) }).then(function (j) {
      var res = {}, at = Date.now();
      (j.results || []).forEach(function (r) { res[r.cal] = r; });
      list.forEach(function (w) {
        if (!w.live) return;
        var r = res[w.input.calendarId || 'primary'];
        if (!r) return;
        if (r.error) { w.handler({ type: 'error', error: fail('tool_error', r.error) }); return; }
        var a = Date.parse(iso(w.input.startTime)), b = Date.parse(iso(w.input.endTime));
        w.handler({ type: 'data', result: { content: [], payload: { events: (r.events || []).filter(function (ev) { return within(ev, a, b); }) }, cache: { storedAt: at, revalidating: false } } });
      });
    }, function (e) {
      list.forEach(function (w) { if (w.live) w.handler({ type: 'error', error: e }); });
    }).then(function () {
      running = false;
      if (again) { again = false; soon(0); }
    });
  }
  function watchTool(server, tool, input, handler) {
    var w = { input: input || {}, handler: handler, live: true };
    watches.push(w); soon(40);
    return function () { w.live = false; watches = watches.filter(function (x) { return x !== w; }); };
  }
  function invalidate() { soon(0); return Promise.resolve(); }

  // Refresh every 5 minutes while Epock is on screen, and when it comes back.
  setInterval(function () { if (!document.hidden && watches.length && Date.now() - lastRun > 290000) soon(0); }, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && watches.length && Date.now() - lastRun > 90000) soon(0); });
  window.addEventListener('online', function () { if (watches.length) soon(800); });

  window.EpockPlatform = {
    standalone: true,
    mcp: { callTool: callTool, watchTool: watchTool, invalidate: invalidate },
    configured: function () { return !!get(LS_URL); },
    getUrl: function () { return get(LS_URL); },
    setUrl: function (u) { put(LS_URL, u ? clean(u) : ''); put(LS_MODE, ''); },
    check: check,
    code: CODE
  };
})();
