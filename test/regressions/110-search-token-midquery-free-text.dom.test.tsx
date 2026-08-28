// @vitest-environment jsdom
/**
 * Regression: a filter token BETWEEN two free-text words broke the search.
 *
 * The parser stripped each token with `.replace(re, '').trim()`, which leaves
 * a doubled internal space: "project is:unread update" became the free-text
 * "project  update" (two spaces), and the substring match against
 * lastMessage "project update" never hit. stripFilterTokens (used by the row
 * highlighter) collapses whitespace, so matcher and highlighter disagreed by
 * construction. Leading/trailing tokens were absorbed by .trim(), which is
 * why this hid.
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

import { renderHook, waitFor } from '@testing-library/react';
import { useConversations } from '@/hooks/useConversations';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_110_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ searchQuery: '', inboxTab: 'focused' });
});

afterEach(() => testDb.close());

async function search(query: string) {
  useUIStore.setState({ searchQuery: query });
  const { result } = renderHook(() => useConversations());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result.current.conversations.map((c) => c.id);
}

it('matches free text split around a mid-query filter token', async () => {
  await testDb.conversations.put(
    makeConversation({ id: '2-hit', lastMessage: 'project update attached', read: 0 })
  );
  await testDb.conversations.put(
    makeConversation({ id: '2-miss', lastMessage: 'something else', read: 0 })
  );

  expect(await search('project is:unread update')).toEqual(['2-hit']);
});

it('matches free text split around a from: token', async () => {
  await testDb.conversations.put(
    makeConversation({
      id: '2-kane-hit',
      participantNames: ['Kane Other'],
      lastMessage: 'quarterly report draft',
    })
  );

  expect(await search('quarterly from:kane report')).toEqual(['2-kane-hit']);
});
