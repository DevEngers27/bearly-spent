// MoneyQuest service worker: keeps the built shell and postcard art offline.
// API calls always go to the network; the child snapshot lives in localStorage.
const VERSION = "mq-v8"; // wardrobe art lives under /bear/w3 (re-cut layers); older caches can never serve it
const SHELL = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    const page = await fetch("/", { cache: "reload" });
    if (!page.ok) throw new Error("Couldn't load the app shell");
    const copy = page.clone();
    const html = await page.text();
    const assets = [...SHELL];
    // Workers have no DOMParser. Read the built HTML's script and link tags,
    // including Vite's hashed entry bundle and stylesheet, in any attr order.
    for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) || []) {
      const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
        .map((m) => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4]]));
      const src = /^<script\b/i.test(tag) ? attrs.src : attrs.rel?.toLowerCase().split(/\s+/).includes("stylesheet") ? attrs.href : null;
      if (src) assets.push(new URL(src.replace(/&amp;/g, "&"), self.location.origin).href);
    }
    const unique = [...new Set(assets)];
    await cache.addAll(unique.filter((src) => new URL(src, self.location.origin).origin === self.location.origin));
    await Promise.all(unique.filter((src) => new URL(src, self.location.origin).origin !== self.location.origin).map(async (src) => {
      try { await cache.add(src); } catch {} // Optional fonts must not prevent shell installation.
    }));
    await cache.put("/", copy);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("mq-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Warm collected art even if Album hasn't been opened on this device yet.
self.addEventListener("message", (e) => {
  if (e.data?.type !== "mq:cache-art" || !Array.isArray(e.data.images)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(e.data.images.map(async (src) => {
      try {
        const url = new URL(src, self.location.origin);
        if (url.origin !== self.location.origin || !/^\/(postcards|bear)\//.test(url.pathname) || await cache.match(url.href)) return;
        const response = await fetch(url.href);
        if (response.ok) await cache.put(url.href, response);
      } catch {} // A missed image must not stop the remaining postcards.
    }));
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname === "/api" || url.pathname.startsWith("/api/")) return;
  // Pages: network first so updates show up, cache successful shells only.
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then(async (r) => {
      if (r.ok) {
        const copy = r.clone();
        try { const cache = await caches.open(VERSION); await cache.put("/", copy); } catch {}
      }
      return r;
    }).catch(() => caches.match("/")));
    return;
  }
  // Static assets, postcards, fonts: cache first, never store error responses.
  const cacheable = url.origin === self.location.origin || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!cacheable) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then(async (r) => {
      if (r.ok) {
        const copy = r.clone();
        try { const cache = await caches.open(VERSION); await cache.put(e.request, copy); } catch {}
      }
      return r;
    })),
  );
});
