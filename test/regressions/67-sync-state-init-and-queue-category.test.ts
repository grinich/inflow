/**
 * Regression: two sync-bookkeeping consistency gaps.
 *
 * 1. initializeSync bailed if ANY syncState rows existed, so a category added
 *    in a later version (or a partially-initialized table) never got a state
 *    row — that category was never discovered. Fixed by ensuring a row exists
 *    per category (exported as ensureSyncStateInitialized).
 *
 * 2. enqueueConversations stamped every queue item with the category being
 *    DISCOVERED rather than the conversation's own category, so an item's
 *    category churned to whichever discovery saw it last and per-category
 *    completion accounting was wrong. Fixed by preferring the conversation's
 *    own category (with legacy INBOX normalized to PRIMARY_INBOX).
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makeConversation, makeSyncState, resetFactories } from '../fixtures/factories';

let testDb: any;
const genState = vi.hoisted(() => ({ gen: 1 }));

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
    getDbGeneration: () => genState.gen,
  };
});

vi.mock('../../entrypoints/background/api/conversations', () => ({
  fetchConversationsPage: vi.fn(),
}));
vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));
vi.mock('../../entrypoints/background/sync/sync-engine', () => ({
  syncConversations: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../entrypoints/background/sync/sync-backfill', () => ({
  backfillBatch: vi.fn().mockResolvedValue(0),
  recoverStuckItems: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../entrypoints/background/realtime/sse-client', () => ({
  isRealtimeConnected: vi.fn().mockReturnValue(false),
}));
vi.mock('../../entrypoints/background/action-queue', () => ({
  drainActionQueue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));
vi.mock('@/lib/sync-settings', () => ({
  getBackfillCutoff: vi.fn().mockResolvedValue(0),
}));

import { ensureSyncStateInitialized } from '../../entrypoints/background/sync/sync-coordinator';
import { enqueueConversations } from '../../entrypoints/background/sync/sync-discovery';

beforeEach(async () => {
  resetFactories();
  genState.gen = 1;
  testDb = new Dexie(`TestDB_67_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('ensureSyncStateInitialized', () => {
  it('creates rows for ALL categories when the table is partially initialized', async () => {
    await testDb.syncState.put(
      makeSyncState({ category: 'PRIMARY_INBOX', phase: 'complete', totalDiscovered: 7 })
    );

    await ensureSyncStateInitialized();

    const states = await testDb.syncState.toArray();
    const categories = states.map((s: any) => s.category).sort();
    expect(categories).toEqual(['ARCHIVE', 'PRIMARY_INBOX', 'SECONDARY_INBOX', 'SPAM']);

    // The pre-existing row must not be reset.
    const primary = await testDb.syncState.get('PRIMARY_INBOX');
    expect(primary.phase).toBe('complete');
    expect(primary.totalDiscovered).toBe(7);
  });

  it('initializes all categories from an empty table', async () => {
    await ensureSyncStateInitialized();
    expect(await testDb.syncState.count()).toBe(4);
  });
});

describe('enqueueConversations queue-item category', () => {
  it("uses the conversation's own category over the discovering category", async () => {
    await enqueueConversations(
      [makeConversation({ id: 'c-arch', category: 'ARCHIVE' })],
      'PRIMARY_INBOX'
    );
    expect((await testDb.syncQueue.get('c-arch')).category).toBe('ARCHIVE');
  });

  it('normalizes legacy INBOX to PRIMARY_INBOX', async () => {
    await enqueueConversations(
      [makeConversation({ id: 'c-inbox', category: 'INBOX' })],
      'PRIMARY_INBOX'
    );
    expect((await testDb.syncQueue.get('c-inbox')).category).toBe('PRIMARY_INBOX');
  });

  it('falls back to the discovering category when the conversation has none', async () => {
    const conv = makeConversation({ id: 'c-nocat' });
    delete (conv as any).category;
    await enqueueConversations([conv], 'SPAM');
    expect((await testDb.syncQueue.get('c-nocat')).category).toBe('SPAM');
  });
});
