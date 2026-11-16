/* SEER Owner service worker: lets the installed app open with no signal.
   Only this app's own files are kept (page, script, styles, icons, fonts).
   Requests to the SEER server are never touched here: figures always come live from the server. */
const CACHE = "seer-owner-v1";
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icon-192.png", "/logo-light.png", "/logo-dark.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin, font = FONT_HOSTS.includes(url.hostname);
  if (!own && !font) return;                       // the SEER server and everything else: straight to the network

  // the page itself: newest when online, the saved copy when not
  if (own && req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return res; })
      .catch(() => caches.match("/")));
    return;
  }
  // scripts, styles, images, fonts: saved copy first, refreshed in the background
  e.respondWith(caches.match(req).then((hit) => {
    const fresh = fetch(req).then((res) => { if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; });
    return hit ? (fresh.catch(() => undefined), hit) : fresh;
  }));
});
