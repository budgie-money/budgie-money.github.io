// Offline support for Budgie. App files come from the network when it's there (so an update arrives
// straight away) and from the cache when it isn't. VERSION only names the cache.
const VERSION = "1.4.0";
const CACHE = "budgie-" + VERSION;
const FILES = ["./", "./index.html", "./app.js", "./engine.js", "./demo.js", "./themes.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./maskable-512.png", "./icon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, {cache: "reload"})))).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("budgie-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const fresh = (req, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("slow")), ms);
  fetch(req, {cache: "no-cache"}).then(r => { clearTimeout(t); r.ok ? res(r) : rej(new Error("status " + r.status)); }, err => { clearTimeout(t); rej(err); });
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // fonts: cache them once they've loaded; the Google Sheet always goes to the network
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(caches.open(CACHE).then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE), key = req.mode === "navigate" ? "./index.html" : req;
    try {
      // a slow phone signal shouldn't hold the app up: after 3 seconds use the copy we have
      const r = await fresh(req.mode === "navigate" ? "./index.html" : req, 3000);
      cache.put(key, r.clone());
      return r;
    } catch (err) {
      const hit = (await cache.match(key, {ignoreSearch: true})) || (req.mode === "navigate" ? await cache.match("./") : null);
      if (hit) return hit;
      try { return await fetch(req); } catch (e2) { return (await cache.match("./index.html")) || Response.error(); }
    }
  })());
});
