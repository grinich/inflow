// Bug (Medium): re-queueing a conversation with new activity didn't reset
// failCount, so a previously-failed item got marked 'failed' again after a
// single attempt instead of a fresh retry budget.
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { enqueueConversations } from '../../entrypoints/background/sync/sync-discovery';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_requeue_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('resets failCount when re-queueing a previously-failed conversation that has new activity', async () => {
  const old = Date.now() - 100_000;
  await testDb.syncQueue.put({
    conversationId: 'c1',
    category: 'PRIMARY_INBOX',
    lastActivityAt: old,
    messagesSyncedAt: old,
    status: 'failed',
    failCount: 3,
    lastFailedAt: Date.now() - 50_000,
    priority: 0,
  });

  await enqueueConversations([makeConversation({ id: 'c1', lastActivityAt: Date.now() })], 'PRIMARY_INBOX');

  const item = await testDb.syncQueue.get('c1');
  expect(item.status).toBe('pending');
  expect(item.failCount).toBe(0);
});
