/**
 * Epock bridge
 *
 * Lets your Epock app read your Google calendars and add the gold you plan.
 * It runs inside your own Google account, as you. Epock talks to it through
 * this project's Web app link, so keep that link private, like a password.
 *
 * Setup: Services → + → Google Calendar API → Add.
 * Then Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 */
var VERSION = 1;
var MARK = 'epock:';

function doGet(e) {
  var p = (e && e.parameter) || {};
  var req = { action: 'hello' };
  if (p.q) {
    try { req = JSON.parse(p.q); } catch (err) { req = { action: 'bad' }; }
  }
  return reply_(handle_(req), p.callback);
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { req = { action: 'bad' }; }
  return reply_(handle_(req));
}

function handle_(req) {
  try {
    switch (req && req.action) {
      case 'hello':
        return { ok: true, app: 'Epock bridge', version: VERSION, message: 'Your Epock bridge is running. Paste this page’s link into Epock → Setup.' };
      case 'ping':
        return { ok: true, version: VERSION };
      case 'calendars':
        return { calendars: listCalendars_() };
      case 'events':
        return { results: (req.ranges || []).slice(0, 40).map(function (r) { return listEvents_(r.cal, r.from, r.to); }) };
      case 'create':
        return createEvent_(req);
      case 'delete':
        return deleteEvent_(req.cal, req.id);
      default:
        return { error: 'bad_request', message: 'Epock sent a request this bridge doesn’t know. Update the bridge code.' };
    }
  } catch (err) {
    return { error: 'failed', message: String((err && err.message) || err) };
  }
}

function reply_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback && /^[A-Za-z_$][\w$]{0,60}$/.test(callback)) {
    return ContentService.createTextOutput(callback + '(' + json + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function listCalendars_() {
  var out = [], pageToken;
  do {
    var res = Calendar.CalendarList.list({ maxResults: 250, pageToken: pageToken });
    (res.items || []).forEach(function (c) {
      out.push({ id: c.id, summary: c.summaryOverride || c.summary || c.id, accessRole: c.accessRole });
    });
    pageToken = res.nextPageToken;
  } while (pageToken);
  return out;
}

function listEvents_(cal, from, to) {
  var events = [], pageToken, pages = 0;
  try {
    do {
      var res = Calendar.Events.list(cal, {
        timeMin: from, timeMax: to, singleEvents: true, orderBy: 'startTime', maxResults: 2500, pageToken: pageToken
      });
      (res.items || []).forEach(function (ev) { events.push(slim_(ev)); });
      pageToken = res.nextPageToken;
      pages++;
    } while (pageToken && pages < 10);
    return { cal: cal, events: events };
  } catch (err) {
    return { cal: cal, error: String((err && err.message) || err) };
  }
}

// Only what Epock needs: times, titles, and whether Epock made the event.
function slim_(ev) {
  var me = (ev.attendees || []).filter(function (a) { return a.self; })
    .map(function (a) { return { self: true, responseStatus: a.responseStatus }; });
  return {
    id: ev.id,
    status: ev.status,
    summary: ev.summary || '',
    start: ev.start,
    end: ev.end,
    description: ev.description && ev.description.indexOf(MARK) !== -1 ? ev.description : undefined,
    attendees: me.length ? me : undefined
  };
}

function createEvent_(req) {
  var tz = req.timeZone || Session.getScriptTimeZone();
  var description = String(req.description || 'Picked in Epock.').slice(0, 500);
  if (description.indexOf(MARK) === -1) description += ' ' + MARK;
  var ev = Calendar.Events.insert({
    summary: String(req.summary || 'Epock pick').slice(0, 200),
    description: description,
    start: { dateTime: req.start, timeZone: tz },
    end: { dateTime: req.end, timeZone: tz }
  }, req.cal || 'primary');
  return { id: ev.id };
}

// Epock only ever removes events it added itself.
function deleteEvent_(cal, id) {
  var ev;
  try { ev = Calendar.Events.get(cal, id); } catch (err) { return { gone: true }; }
  if (!ev || ev.status === 'cancelled') return { gone: true };
  if (!ev.description || ev.description.indexOf(MARK) === -1) return { gone: true, kept: true };
  Calendar.Events.remove(cal, id);
  return { ok: true };
}
