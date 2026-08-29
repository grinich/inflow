/**
 * Service worker for the app shell at /app.
 *
 * Two jobs. First, the cache: the app itself is local-first (it lives in the
 * extension, on the user's machine), so this worker just makes sure the tiny
 * shell page that embeds it can't become an online-only gate. Everything is
 * served stale-while-revalidate: instant (and offline-capable) opens, at most
 * one deploy behind.
 *
 * Second, notifications — see the notificationclick handler at the bottom.
 *
 * Scope is /app only; the marketing pages stay uncached.
 */

/** The shell page. Also the SW scope, which is a raw path PREFIX. */
const SHELL_PATH = '/app';

// v3: purges v2 caches, whose '/app' key could be poisoned by a direct
// navigation to /app.webmanifest (the pre-fix fetch handler keyed every
// in-scope navigation to '/app').
const CACHE = 'inflow-app-shell-v3';

// The maskable icon is the art at NATURAL proportions with corners filled in
// the tile's own dark color — Chrome masks it for the macOS dock (like any
// native icon). Without one, Chrome mounts the padded icon on a white tile
// (halo); a zoom-cropped one renders the envelope oversized. Both were tried
// and rejected.
const PRECACHE = [
  '/app',
  '/app.webmanifest',
  '/base.css',
  '/icons/app-icon-192.png',
  '/icons/app-icon-512.png',
  '/icons/app-icon-512-fullbleed.png',
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
  const isShellNav = req.mode === 'navigate' && url.pathname === SHELL_PATH;
  if (!isShellNav && !PRECACHE.includes(url.pathname)) return;
  const key = isShellNav ? SHELL_PATH : url.pathname;

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

/**
 * A clicked message notification: raise the app, then open the conversation.
 *
 * The shell shows its notifications through THIS worker
 * (registration.showNotification) rather than with a page `new Notification`,
 * for two reasons:
 *
 *  - Only a service-worker click handler may raise a window. A page's
 *    `Notification.onclick` calling `window.focus()` is ignored while the
 *    window is in the background, which is exactly when a notification is
 *    clicked — so clicking one did nothing at all.
 *  - A page's notification dies with its page. This one outlives the window,
 *    so it can still be clicked after the app is closed — and then there is
 *    no client to focus, so we open one at the conversation.
 *
 * What this does NOT control is whose name and icon macOS puts on the
 * notification. That is attribution, and it is a Chrome-version thing, not a
 * page-vs-worker thing: before Chrome 152 every PWA notification is
 * attributed to Chrome no matter where it was created. From 152 macOS shows
 * the installed app's own identity (and gives it its own entry in System
 * Settings › Notifications, with its own permission prompt).
 */
self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  const conversationId =
    typeof data.conversationId === 'string' ? data.conversationId : '';
  event.notification.close();

  event.waitUntil(
    (async () => {
      // Window clients come back most-recently-focused first. Uncontrolled
      // ones count: a shell loaded before this worker activated is still a
      // perfectly good window to raise.
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const shell = clients.find((client) => {
        try {
          return new URL(client.url).pathname === SHELL_PATH;
        } catch (_) {
          return false;
        }
      });

      if (shell) {
        // focus() first: it is what brings the installed app forward. The
        // shell relays the id into the app frame (see app.html).
        try {
          await shell.focus();
        } catch (_) {}
        if (conversationId) {
          shell.postMessage({ type: 'OPEN_CONVERSATION', conversationId });
        }
        return;
      }

      // Nothing open: launch the shell pointed at the conversation. It
      // forwards ?c= to the app frame as a launch param, which avoids racing
      // a postMessage against a frame that is still booting.
      const url = conversationId
        ? SHELL_PATH + '?c=' + encodeURIComponent(conversationId)
        : SHELL_PATH;
      await self.clients.openWindow(url);
    })()
  );
});
