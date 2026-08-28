/**
 * Service worker for the app shell at /app.
 *
 * The app itself is local-first (it lives in the extension, on the user's
 * machine) — this worker just makes sure the tiny shell page that embeds it
 * can't become an online-only gate. Everything is served stale-while-
 * revalidate: instant (and offline-capable) opens, at most one deploy behind.
 *
 * Scope is /app only; the marketing pages stay uncached.
 */

const CACHE = 'inflow-app-shell-v1';

const PRECACHE = [
  '/app',
  '/app.webmanifest',
  '/base.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations are cached under the bare '/app' key so query-string variants
  // (?demo, deep links) hit the same cached shell.
  const isNavigation = req.mode === 'navigate';
  if (!isNavigation && !PRECACHE.includes(url.pathname)) return;

  const key = isNavigation ? '/app' : url.pathname;
  event.respondWith(staleWhileRevalidate(req, key));
});

function staleWhileRevalidate(request, cacheKey) {
  return caches.open(CACHE).then((cache) =>
    cache.match(cacheKey).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(cacheKey, response.clone());
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || refresh;
    })
  );
}
