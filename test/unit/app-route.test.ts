import {
  appRouteToHash,
  parseAppRouteHash,
  queryHasUnread,
  setUnreadInQuery,
  DEFAULT_ROUTE,
  type AppRoute,
} from '@/lib/app-route';
import type { InboxTab } from '@/store/ui-store';

const route = (inboxTab: InboxTab = 'focused', unread = false): AppRoute => ({ inboxTab, unread });

describe('app-route hash parsing', () => {
  it.each([
    ['', route()],
    ['#', route()],
    ['#/', route()],
    ['#/inbox', route()],
    ['#/unknown', route()],
    ['#/networking', route()],
    ['#/anything-else', route()],
    // Every inbox tab is its own destination.
    ['#/inbox/focused', route('focused')],
    ['#/inbox/other', route('other')],
    ['#/inbox/archived', route('archived')],
    ['#/inbox/spam', route('spam')],
    ['#/inbox/ARCHIVED', route('archived')],
    // An unknown tab is a stale or hand-edited URL: land on the inbox rather
    // than a blank screen.
    ['#/inbox/nonsense', route('focused')],
    // Unread rides along as a modifier on the tab.
    ['#/inbox/other?unread', route('other', true)],
    ['#/inbox/spam?unread', route('spam', true)],
    ['#/inbox?unread', route('focused', true)],
    ['#/inbox/other?foo=1', route('other')],
  ])('parses %j', (hash, expected) => {
    expect(parseAppRouteHash(hash)).toEqual(expected);
  });

  it('treats null/undefined as the default route', () => {
    expect(parseAppRouteHash(null)).toEqual(DEFAULT_ROUTE);
    expect(parseAppRouteHash(undefined)).toEqual(DEFAULT_ROUTE);
  });

  it('round-trips every inbox tab, with and without unread', () => {
    for (const tab of ['focused', 'other', 'archived', 'spam'] as const) {
      for (const unread of [false, true]) {
        const r = route(tab, unread);
        expect(parseAppRouteHash(appRouteToHash(r))).toEqual(r);
      }
    }
  });

});

describe('the unread token', () => {
  it.each([
    ['is:unread', true],
    ['hello is:unread', true],
    ['is:unread hello', true],
    ['IS:UNREAD', true],
    ['', false],
    ['hello', false],
    // Guard the boundaries: neither of these is the unread filter.
    ['is:unreadish', false],
    ['xis:unread', false],
  ])('reads %j as %s', (query, expected) => {
    expect(queryHasUnread(query)).toBe(expected);
  });

  it('adds and removes the token without disturbing the rest of the query', () => {
    expect(setUnreadInQuery('', true)).toBe('is:unread');
    expect(setUnreadInQuery('from:ada', true)).toBe('from:ada is:unread');
    expect(setUnreadInQuery('from:ada is:unread', false)).toBe('from:ada');
    expect(setUnreadInQuery('is:unread', false)).toBe('');
  });

  it('is a no-op when the token is already in the wanted state', () => {
    expect(setUnreadInQuery('from:ada is:unread', true)).toBe('from:ada is:unread');
    expect(setUnreadInQuery('from:ada', false)).toBe('from:ada');
  });
});
