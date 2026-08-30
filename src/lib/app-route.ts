// ---------------------------------------------------------------------------
// App routes — the nav state lives in the URL hash.
//
// inflow is a single extension page (app.html). Rather than pull in a router,
// the hash is the route:
//
//   #/inbox/focused   #/inbox/other   #/inbox/archived   #/inbox/spam
//   #/inbox/other?unread
//
// The UI store stays the source of truth — it writes the hash when the nav
// state changes and a `hashchange` listener reads it back — so Chrome's
// back/forward buttons, reloads and deep links all land where you left off.
//
// The background locates the app tab with `chrome.tabs.query({ url })`, which
// ignores fragment identifiers, so the hash never breaks tab discovery.
//
// Parsing keys off the first path segment, so a future top-level view can
// become its own sibling of `inbox` without changing this contract.
// ---------------------------------------------------------------------------
import type { InboxTab } from '@/store/ui-store';

export interface AppRoute {
  inboxTab: InboxTab;
  /** The `is:unread` quick-filter, which reads as a modifier on the tab. */
  unread: boolean;
}

const INBOX_TABS: readonly InboxTab[] = ['focused', 'other', 'archived', 'spam'];

export const DEFAULT_ROUTE: AppRoute = { inboxTab: 'focused', unread: false };

/** The hash for a route, e.g. `{other, unread}` → `'#/inbox/other?unread'`. */
export function appRouteToHash(route: AppRoute): string {
  const base = `#/inbox/${route.inboxTab}`;
  return route.unread ? `${base}?unread` : base;
}

/**
 * Parse a location hash into a route. An unknown tab falls back to the default
 * rather than throwing — a hand-edited or stale URL should land on the inbox,
 * not a blank screen.
 */
export function parseAppRouteHash(hash: string | null | undefined): AppRoute {
  if (!hash) return DEFAULT_ROUTE;
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const [, second] = path.replace(/^\/+/, '').split('/');
  const tab = INBOX_TABS.find((t) => t === second?.toLowerCase());
  return { inboxTab: tab ?? DEFAULT_ROUTE.inboxTab, unread: new URLSearchParams(query).has('unread') };
}

export function routesEqual(a: AppRoute, b: AppRoute): boolean {
  return appRouteToHash(a) === appRouteToHash(b);
}

/** The route the URL currently describes — the default outside a DOM. */
export function readAppRouteFromLocation(): AppRoute {
  if (typeof window === 'undefined' || !window.location) return DEFAULT_ROUTE;
  return parseAppRouteHash(window.location.hash);
}

/** True when the page was opened without any route in the URL. */
export function locationHasRoute(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return Boolean(window.location.hash.replace(/^#\/?/, ''));
}

/**
 * Reflect a route into the URL hash. No-op when the hash already describes it,
 * so a `hashchange`-driven store update doesn't write straight back and push a
 * duplicate history entry.
 *
 * Assigning `location.hash` pushes an entry, which is what gives the back
 * button meaning between tabs. `replace` is for changes that shouldn't
 * accumulate — restoring the URL on first load, and toggling the unread
 * modifier, which is a filter rather than a destination.
 *
 * `force` writes even when the hash already resolves to this route. Only the
 * first-load canonicalization needs it: an empty hash parses AS the default
 * route, so the no-op guard would otherwise leave `app.html` with no route in
 * the URL at all.
 */
export function writeAppRouteToLocation(
  route: AppRoute,
  opts: { replace?: boolean; force?: boolean } = {}
): void {
  if (typeof window === 'undefined' || !window.location) return;
  if (!opts.force && routesEqual(parseAppRouteHash(window.location.hash), route)) return;
  const hash = appRouteToHash(route);
  if (opts.replace && typeof window.history?.replaceState === 'function') {
    window.history.replaceState(null, '', hash);
    return;
  }
  window.location.hash = hash;
}

/**
 * Subscribe to hash-driven route changes (back/forward, manual URL edits).
 * Returns an unsubscribe function; a no-op outside a DOM.
 */
export function subscribeToAppRouteHash(onChange: (route: AppRoute) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  const handler = () => onChange(readAppRouteFromLocation());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}

// ── The unread modifier ────────────────────────────────────────────────────
// Unread isn't separate state: it's the `is:unread` token inside searchQuery,
// which is what the quick-filter button and the search box both drive. The
// route mirrors the token's presence, so these two helpers are the single
// place that knows how to read and write it.

const UNREAD_TOKEN = /(^|\s)is:unread(\s|$)/i;

export function queryHasUnread(searchQuery: string): boolean {
  return UNREAD_TOKEN.test(searchQuery);
}

export function setUnreadInQuery(searchQuery: string, unread: boolean): string {
  if (unread === queryHasUnread(searchQuery)) return searchQuery;
  if (!unread) {
    return searchQuery.replace(/\bis:unread\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  }
  const trimmed = searchQuery.trim();
  return trimmed ? `${trimmed} is:unread` : 'is:unread';
}
