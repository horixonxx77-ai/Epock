/* Epock service worker: keeps the app itself working offline.
   Calendar data never passes through here; it goes straight to your Google bridge. */
var VERSION = 'epock-000fa6fc85';
var SHELL = ["./", "styles.css?v=000fa6fc85", "js/engine.js?v=000fa6fc85", "js/ics.js?v=000fa6fc85", "js/bridge.js?v=000fa6fc85", "js/app.js?v=000fa6fc85", "manifest.webmanifest", "icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon.svg", "icons/maskable-512.png", "fonts/source-serif-4-latin-400-normal.woff2", "fonts/source-serif-4-latin-500-normal.woff2", "fonts/source-serif-4-latin-600-normal.woff2", "fonts/source-serif-4-latin-400-italic.woff2", "fonts/inter-latin-400-normal.woff2", "fonts/inter-latin-500-normal.woff2", "fonts/inter-latin-600-normal.woff2", "fonts/inter-latin-700-normal.woff2"];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('epock-') === 0 && k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  // The page: newest copy when online, saved copy when not.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put('./', copy); }); }
      return res;
    }).catch(function () { return caches.match('./'); }));
    return;
  }
  // Scripts, styles, fonts, icons: their names change with each version, so a saved copy is always right.
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok && res.type === 'basic') { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    });
  }));
});
