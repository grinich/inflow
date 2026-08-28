// @vitest-environment jsdom
/**
 * Regression: switching tabs while a search was active rendered the previous
 * tab's SEARCH RESULTS as the new tab's content (and cached them as such).
 *
 * The stale-tab guard compares "tab changed AND the live-query value is
 * identical to the last one seen" — but the tracker was only updated while
 * NOT searching, so it froze at the pre-search value. setInboxTab clears the
 * query and switches the tab in ONE update, so the next render compared the
 * still-pending search results against the remembered pre-search array:
 * different → "not stale" → the old tab's search leftovers rendered as the
 * new tab's content with no spinner, and were even recorded as the new tab's
 * cached results.
 *
 * Fix: keep the identity tracker current while searching too (without
 * storing search results as any tab's own content).
 */
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

import { act, renderHook, waitFor } from '@testing-library/react';
import { useConversations } from '@/hooks/useConversations';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_121_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ searchQuery: '', inboxTab: 'focused' });
});

afterEach(() => testDb.close());

it('shows the target tab cached results, not search leftovers, when switching tabs mid-search', async () => {
  await testDb.conversations.bulkPut([
    makeConversation({ id: 'focused-a', category: 'PRIMARY_INBOX', archived: 0 }),
    makeConversation({ id: 'other-b', category: 'SECONDARY_INBOX', archived: 0 }),
  ]);

  const { result } = renderHook(() => useConversations());

  // Visit Other so it has cached results, then return to Focused.
  await act(async () => { useUIStore.setState({ inboxTab: 'other' }); });
  await waitFor(() => expect(result.current.conversations.map((c) => c.id)).toEqual(['other-b']));
  await act(async () => { useUIStore.setState({ inboxTab: 'focused' }); });
  await waitFor(() => expect(result.current.conversations.map((c) => c.id)).toEqual(['focused-a']));

  // Search with no matches on Focused.
  await act(async () => { useUIStore.setState({ searchQuery: 'zzz-no-match' }); });
  await waitFor(() => expect(result.current.conversations).toEqual([]));

  // Switch tabs the way setInboxTab does: clear query + change tab in ONE update.
  await act(async () => { useUIStore.setState({ inboxTab: 'other', searchQuery: '' }); });

  // The FIRST paint after the switch must not show the Focused tab's empty
  // search leftovers as Other's content — it should serve Other's cached
  // results until the live query catches up.
  expect(result.current.conversations.map((c) => c.id)).toEqual(['other-b']);
});
