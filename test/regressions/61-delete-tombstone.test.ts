/**
 * Regression: a deleted conversation must not be resurrected by a stale page.
 *
 * mergeConversation's pending-action guard only applies to EXISTING rows; for a
 * missing row it unconditionally re-inserted the conversation. A discovery page
 * fetched just before a local delete (discovery paginates for minutes) would
 * re-insert the deleted conversation — and since server pages never mention it
 * again, it was stranded in the local DB forever.
 *
 * Fix: deletes write a tombstone; mergeConversation skips inserting a
 * tombstoned conversation (until the tombstone expires), and a genuinely new
 * inbound SSE message clears the tombstone (LinkedIn resurrects deleted threads
 * on new mail, so we must too).
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

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

import { mergeConversation } from '../../entrypoints/background/sync/merge-conversation';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_61_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('delete tombstones', () => {
  it('has a tombstones table in the schema', () => {
    expect(testDb.tombstones).toBeDefined();
  });

  it('mergeConversation does not re-insert a tombstoned conversation', async () => {
    await testDb.tombstones.put({ conversationId: 'c-deleted', deletedAt: Date.now() });

    await mergeConversation(makeConversation({ id: 'c-deleted' }));

    expect(await testDb.conversations.get('c-deleted')).toBeUndefined();
  });

  it('an expired tombstone no longer blocks inserts (and is cleaned up)', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    await testDb.tombstones.put({ conversationId: 'c-old-del', deletedAt: eightDaysAgo });

    await mergeConversation(makeConversation({ id: 'c-old-del' }));

    expect(await testDb.conversations.get('c-old-del')).toBeDefined();
    expect(await testDb.tombstones.get('c-old-del')).toBeUndefined();
  });

  it('merging an existing (non-deleted) conversation is unaffected', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c-live', lastMessage: 'old' }));
    await mergeConversation(
      makeConversation({ id: 'c-live', lastMessage: 'new', lastActivityAt: Date.now() + 1000 })
    );
    expect((await testDb.conversations.get('c-live')).lastMessage).toBe('new');
  });
});
