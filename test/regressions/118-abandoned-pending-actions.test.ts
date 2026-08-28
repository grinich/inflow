/**
 * Regression: 'pending' actions stranded by a closed tab were never reclaimed.
 *
 * A pendingActions row starts at 'pending' and is transitioned solely by an
 * in-page promise callback. Close/crash/discard the app tab mid-flight and
 * the row stays 'pending' forever: cleanupStaleActions pruned only
 * 'confirmed'/'failed', and the drainer replays only 'queued'. Worse than
 * table growth, hasPendingAction treats 'pending' as an optimistic guard —
 * a stranded row blocked server merges (category/read/starred) for that
 * conversation indefinitely.
 *
 * Fix: cleanupStaleActions marks 'pending' rows older than an hour as
 * 'failed' (in-flight actions resolve in seconds; an hour-old pending row
 * has no page waiting on it). Failed rows stop guarding and age out on the
 * existing 1-day cleanup.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makePendingAction, resetFactories } from '../fixtures/factories';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('../../entrypoints/background/api/conversations', () => ({
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
  moveToOther: vi.fn(),
  moveToFocused: vi.fn(),
  moveToSpam: vi.fn(),
  markConversationRead: vi.fn(),
  markConversationUnread: vi.fn(),
  deleteConversation: vi.fn(),
  starConversation: vi.fn(),
  unstarConversation: vi.fn(),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  reactWithEmoji: vi.fn(),
  recallMessage: vi.fn(),
}));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  recordMarkRead: vi.fn(),
  recordMutation: vi.fn(),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { drainActionQueue } from '../../entrypoints/background/action-queue';

beforeEach(async () => {
  resetFactories();
  testDb = new Dexie(`TestDB_118_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('reclaims hour-old pending rows and leaves fresh ones alone', async () => {
  await testDb.pendingActions.bulkPut([
    makePendingAction({ id: 'a-stranded', type: 'archive', conversationId: '2-c1', status: 'pending', timestamp: Date.now() - 2 * 60 * 60 * 1000 }),
    makePendingAction({ id: 'a-inflight', type: 'archive', conversationId: '2-c2', status: 'pending', timestamp: Date.now() - 5_000 }),
  ]);

  await drainActionQueue();

  expect((await testDb.pendingActions.get('a-stranded')).status).toBe('failed');
  expect((await testDb.pendingActions.get('a-inflight')).status).toBe('pending');
});
