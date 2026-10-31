const SHELL_CACHE = "iitb-campus-map-shell-v2";
// tiles and glyphs keep across app updates; their URLs are versioned
const TILE_CACHE = "iitb-campus-map-tiles-v1";
const tileCache = caches.open(TILE_CACHE);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // the offline fallback for pages never visited
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add(self.registration.scope)).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.pathname.endsWith(".pbf")) {
    event.respondWith(
      tileCache.then((cache) =>
        cache.match(request.url).then(
          (cached) =>
            cached ??
            fetch(request).then((response) => {
              if (response.ok) cache.put(request.url, response.clone());
              return response;
            }),
        ),
      ),
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Cache key drops the query string: every shareable-route URL (?from=&to=&...) serves the
  // same app-shell document, so keying on it verbatim would grow the cache without bound.
  const cacheKey = new URL(request.url);
  cacheKey.search = "";

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(cacheKey.href, copy));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(cacheKey.href)
          // an unvisited /b/<slug>/ page offline: the app shell reads the slug itself
          .then((cached) => cached ?? (request.mode === "navigate" ? caches.match(self.registration.scope) : undefined))
          .then((cached) => cached ?? Response.error()),
      ),
  );
});
