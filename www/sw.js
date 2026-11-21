// Sunnyloha service worker (browser only; the Android app doesn't register it).
// Makes the web app installable and lets it open with no connection: the page and its scripts, fonts and icons
// are kept on the device, and the app then shows the last forecast it saved. Weather requests always go to the
// network (the app keeps its own copy of the last forecast), so nothing here can show stale weather as new.
// __V__ is stamped with the commit on each deploy, so every deploy gets a fresh cache.
const CACHE = "sunnyloha-__V__";
const CORE = ["./", "offline.html", "manifest.webmanifest", "fonts/fonts.css", "vendor/leaflet/leaflet.css",
  "vendor/leaflet/leaflet.js", "icon-192.png", "favicon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("sunnyloha-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // weather, map tiles, Spotify: straight to the network

  // The page itself: newest from the network, else the saved copy, else the "No connection" screen.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put("./", copy)); }
      return r;
    }).catch(async () => (await caches.match("./")) || (await caches.match("offline.html")) || Response.error()));
    return;
  }

  // Scripts, styles, fonts, icons: saved copy first (script URLs change with each deploy), filled in as they load.
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return r;
  })));
});
