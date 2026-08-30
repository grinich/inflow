// @vitest-environment jsdom
// Nothing about where you were was in the URL: the inbox tab and the unread
// quick-filter lived in the store alone, so ⌘R off Archive — or off Other with
// unread on — dropped you back on Focused. The nav state is in the hash now,
// and a reload is just "parse the hash again".
import '../dom-setup';
import { parseAppRouteHash, appRouteToHash, queryHasUnread } from '@/lib/app-route';
import type { InboxTab } from '@/store/ui-store';

/** Re-import the store with a given URL, which is what a reload amounts to. */
async function loadAppAt(hash: string) {
  window.location.hash = hash;
  vi.resetModules();
  const { useUIStore } = await import('@/store/ui-store');
  return useUIStore;
}

const TABS: InboxTab[] = ['focused', 'other', 'archived', 'spam'];

// This jsdom setup provides no localStorage, and the store reads it for the
// restored tab — shim it so the URL-vs-storage precedence is testable.
let store_: Record<string, string> = {};
beforeEach(() => {
  window.location.hash = '';
  store_ = {};
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store_[k] ?? null,
      setItem: (k: string, v: string) => { store_[k] = String(v); },
      removeItem: (k: string) => { delete store_[k]; },
      clear: () => { store_ = {}; },
    },
  });
});

describe('regression #144: nav state survives a reload', () => {
  it.each(TABS)('reloading on #/inbox/%s stays on that tab', async (tab) => {
    const store = await loadAppAt(`#/inbox/${tab}`);

    expect(store.getState().inboxTab).toBe(tab);
  });

  it.each(TABS)('reloading on #/inbox/%s?unread keeps the unread filter', async (tab) => {
    const store = await loadAppAt(`#/inbox/${tab}?unread`);

    expect(store.getState().inboxTab).toBe(tab);
    expect(queryHasUnread(store.getState().searchQuery)).toBe(true);
  });

  it('reloading without unread does not invent the filter', async () => {
    const store = await loadAppAt('#/inbox/archived');

    expect(queryHasUnread(store.getState().searchQuery)).toBe(false);
  });

  it('puts the route in the URL even when opened bare', async () => {
    // A reload of `app.html` with no hash has to leave a route behind, or the
    // next reload is back to guessing.
    const store = await loadAppAt('');

    expect(window.location.hash).toBe('#/inbox/focused');
    expect(store.getState().inboxTab).toBe('focused');
  });

  it('falls back to the stored tab when the URL carries no route', async () => {
    // localStorage still wins over the default for a bare URL — the hash only
    // takes precedence when it actually says something.
    localStorage.setItem(
      'inflow-view',
      JSON.stringify({ inboxTab: 'spam', selectedConversationId: null, selectedIndex: 0, viewMode: 'list' })
    );
    const store = await loadAppAt('');

    expect(store.getState().inboxTab).toBe('spam');
  });

  it('lets the URL override the stored tab', async () => {
    localStorage.setItem(
      'inflow-view',
      JSON.stringify({ inboxTab: 'spam', selectedConversationId: null, selectedIndex: 0, viewMode: 'list' })
    );
    const store = await loadAppAt('#/inbox/other');

    expect(store.getState().inboxTab).toBe('other');
  });
});

describe('regression #144: the URL follows the nav state', () => {
  it.each(TABS)('switching to %s writes it to the hash', async (tab) => {
    const store = await loadAppAt('');

    store.getState().setInboxTab(tab);

    expect(parseAppRouteHash(window.location.hash).inboxTab).toBe(tab);
  });

  it('toggling unread adds and removes the modifier', async () => {
    const store = await loadAppAt('#/inbox/other');

    store.getState().setSearchQuery('is:unread');
    expect(window.location.hash).toBe('#/inbox/other?unread');

    store.getState().setSearchQuery('');
    expect(window.location.hash).toBe('#/inbox/other');
  });

  it('keeps a free-text search out of the URL', async () => {
    // Only the unread modifier is routed; the search box itself is not, so
    // typing must not rewrite the hash on every keystroke.
    const store = await loadAppAt('#/inbox/focused');

    store.getState().setSearchQuery('quarterly report');

    expect(window.location.hash).toBe('#/inbox/focused');
  });

  it('carries unread alongside free text', async () => {
    const store = await loadAppAt('#/inbox/focused');

    store.getState().setSearchQuery('quarterly is:unread');

    expect(window.location.hash).toBe('#/inbox/focused?unread');
  });

  it('drops the unread modifier when switching tabs', async () => {
    // setInboxTab clears the search query, so the URL has to follow.
    const store = await loadAppAt('#/inbox/focused?unread');

    store.getState().setInboxTab('archived');

    expect(window.location.hash).toBe('#/inbox/archived');
  });

  it('round-trips every routable state', async () => {
    for (const tab of TABS) {
      for (const unread of [false, true]) {
        const hash = appRouteToHash({ inboxTab: tab, unread });
        const store = await loadAppAt(hash);
        expect(store.getState().inboxTab).toBe(tab);
        expect(queryHasUnread(store.getState().searchQuery)).toBe(unread);
      }
    }
  });
});
