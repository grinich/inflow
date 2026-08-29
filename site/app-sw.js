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

// v3: purges v2 caches, whose '/app' key could be poisoned by a direct
// navigation to /app.webmanifest (the pre-fix fetch handler keyed every
// in-scope navigation to '/app').
const CACHE = 'inflow-app-shell-v3';

// No maskable icon on purpose: Chrome prefers it for the macOS dock and
// applies its own mask to the full-bleed art, which looked badly cropped —
// the plain icons carry the full artwork with its own margins.
const PRECACHE = [
  '/app',
  '/app.webmanifest',
  '/base.css',
  '/icons/app-icon-192.png',
  '/icons/app-icon-512.png',
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

  // SW scope is a raw path PREFIX ('/app' also controls /apple and
  // /app.webmanifest), so gate navigations on the exact shell path: anything
  // else must reach the network (Vercel's 404, the real manifest, …) — and
  // must never be cache.put under the '/app' key, which would poison the
  // shell. Query-string variants (?demo, deep links) share the '/app' key.
  const isShellNav = req.mode === 'navigate' && url.pathname === '/app';
  if (!isShellNav && !PRECACHE.includes(url.pathname)) return;
  const key = isShellNav ? '/app' : url.pathname;

  // Stale-while-revalidate, with the revalidation held open via waitUntil —
  // otherwise the worker may be torn down as soon as the cached response is
  // returned and the cache stays stale indefinitely.
  const refresh = caches.open(CACHE).then((cache) =>
    fetch(req).then((response) => {
      if (response && response.ok) {
        return cache.put(key, response.clone()).then(() => response);
      }
      return response;
    })
  );
  event.waitUntil(refresh.catch(() => {}));
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(key))
      .then((cached) => cached || refresh)
      .catch(() => fetch(req))
  );
});
