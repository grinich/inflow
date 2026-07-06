/**
 * Regression: conversations deleted on LinkedIn lived in the local DB forever.
 *
 * Sync was upsert-only — nothing ever removed a local conversation the server
 * stopped returning. Deleting a thread from the LinkedIn website (or another
 * device) left it permanently in inflow, resurfacing in every tab and search.
 *
 * Fix: mergeConversation stamps rows with seenInSyncAt whenever server data
 * merges; after a category's discovery fully completes, the sweep removes rows
 * of that category that were not seen — with a two-strike rule (a row must be
 * missed by two consecutive completed discoveries) so a flaky page can't mass-
 * delete real conversations. Rows with local activity newer than the discovery
 * start, drafts, and rows with in-flight actions are never swept.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makeConversation, makeMessage, makePendingAction, makeSyncQueueItem } from '../fixtures/factories';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { sweepDeletedConversations } from '../../entrypoints/background/sync/sweep-deleted';
import { mergeConversation } from '../../entrypoints/background/sync/merge-conversation';

const OLD = Date.now() - 60 * 60_000; // an hour ago

beforeEach(async () => {
  testDb = new Dexie(`TestDB_69_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('sweepDeletedConversations', () => {
  it('deletes a conversation (and its messages + queue row) only after two missed discoveries', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'c-gone', category: 'PRIMARY_INBOX', lastActivityAt: OLD })
    );
    await testDb.messages.put(makeMessage({ id: 'm1', conversationId: 'c-gone' }));
    await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'c-gone' }));

    // First completed discovery misses it → strike 1, still present.
    await sweepDeletedConversations('PRIMARY_INBOX', Date.now() - 1000);
    let row = await testDb.conversations.get('c-gone');
    expect(row).toBeDefined();
    expect(row.missedSyncCycles).toBe(1);

    // Second completed discovery misses it → deleted everywhere.
    await sweepDeletedConversations('PRIMARY_INBOX', Date.now() - 500);
    expect(await testDb.conversations.get('c-gone')).toBeUndefined();
    expect(await testDb.messages.get('m1')).toBeUndefined();
    expect(await testDb.syncQueue.get('c-gone')).toBeUndefined();
  });

  it('a merge from the server resets the strike counter', async () => {
    await testDb.conversations.put(
      makeConversation({
        id: 'c-back',
        category: 'PRIMARY_INBOX',
        lastActivityAt: OLD,
        missedSyncCycles: 1,
      } as any)
    );

    // The next discovery DOES return it — merge stamps seenInSyncAt + resets strikes.
    await mergeConversation(makeConversation({ id: 'c-back', lastActivityAt: OLD }));

    const row = await testDb.conversations.get('c-back');
    expect(row.missedSyncCycles).toBe(0);
    expect(row.seenInSyncAt).toBeGreaterThan(0);

    // A sweep against a discovery that started before the merge sees it as seen.
    await sweepDeletedConversations('PRIMARY_INBOX', row.seenInSyncAt - 1);
    expect((await testDb.conversations.get('c-back')).missedSyncCycles).toBe(0);
  });

  it('never sweeps rows with local activity newer than the discovery start (SSE-created)', async () => {
    const startedAt = Date.now() - 1000;
    await testDb.conversations.put(
      makeConversation({ id: 'c-live', category: 'PRIMARY_INBOX', lastActivityAt: Date.now() })
    );

    await sweepDeletedConversations('PRIMARY_INBOX', startedAt);
    await sweepDeletedConversations('PRIMARY_INBOX', startedAt);

    const row = await testDb.conversations.get('c-live');
    expect(row).toBeDefined();
    expect(row.missedSyncCycles ?? 0).toBe(0);
  });

  it('never sweeps rows with an in-flight pending action', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'c-pending', category: 'PRIMARY_INBOX', lastActivityAt: OLD })
    );
    await testDb.pendingActions.put(
      makePendingAction({ conversationId: 'c-pending', status: 'pending' })
    );

    await sweepDeletedConversations('PRIMARY_INBOX', Date.now() - 1000);
    await sweepDeletedConversations('PRIMARY_INBOX', Date.now() - 500);

    expect(await testDb.conversations.get('c-pending')).toBeDefined();
  });

  it('never sweeps drafts and ignores other categories', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'c-draft', category: 'PRIMARY_INBOX', lastActivityAt: OLD, draft: 1 })
    );
    await testDb.conversations.put(
      makeConversation({ id: 'c-other-cat', category: 'ARCHIVE', lastActivityAt: OLD })
    );

    await sweepDeletedConversations('PRIMARY_INBOX', Date.now() - 1000);
    await sweepDeletedConversations('PRIMARY_INBOX', Date.now() - 500);

    expect(await testDb.conversations.get('c-draft')).toBeDefined();
    expect(await testDb.conversations.get('c-other-cat')).toBeDefined();
    expect((await testDb.conversations.get('c-other-cat')).missedSyncCycles ?? 0).toBe(0);
  });
});
