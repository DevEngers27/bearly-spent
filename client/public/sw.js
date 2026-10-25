// MoneyQuest service worker: makes the app installable and keeps the shell,
// fonts and postcard art available offline. API calls always go to the network.
const VERSION = "mq-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // Pages: network first so updates show up, cache as fallback.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { caches.open(VERSION).then((c) => c.put("/", r.clone())); return r; }).catch(() => caches.match("/")));
    return;
  }
  // Static assets, postcards, fonts: cache first.
  const cacheable = url.origin === location.origin || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com");
  if (!cacheable) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
      if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    })),
  );
});
