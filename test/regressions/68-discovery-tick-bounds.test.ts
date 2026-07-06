/**
 * Regression: one sync tick could monopolize the coordinator for hours.
 *
 * The tick's discovery step exhausted every discovering category in a single
 * tick (up to 1000 pages per category with 1.5–3s delays), and _tickRunning
 * blocked all subsequent ticks — including the quick poll that reconciles
 * cross-device read state — for the duration of a large initial sync.
 *
 * Fix: discovery is a bounded round (runDiscoveryRound) that processes at most
 * N pages per tick, saving the cursor so the next tick resumes.
 *
 * Also: recoverStuckItems only ran at service-worker startup when the DB was
 * already open. Logging in later (or switching accounts) left 'syncing' rows
 * stuck until some future SW restart. Fix: each tick recovers once per DB
 * generation.
 */
import Dexie from 'dexie';
import { applySchema, type SyncState } from '@/db/database';

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

vi.mock('../../entrypoints/background/sync/sync-engine', () => ({
  syncConversations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/background/sync/sync-discovery', () => ({
  discoverPage: vi.fn().mockResolvedValue({
    conversations: [],
    profiles: [],
    isLastPage: true,
    nextCursor: null,
  }),
  enqueueConversations: vi.fn().mockResolvedValue({ enqueued: 0, skipped: 0 }),
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

function makeSyncState(overrides: Partial<SyncState> = {}): SyncState {
  return {
    category: 'PRIMARY_INBOX',
    phase: 'discovering',
    cursor: '',
    totalDiscovered: 0,
    discoveryCompletedAt: 0,
    lastSyncStartedAt: Date.now(),
    lastSyncCompletedAt: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  genState.gen = 1;
  testDb = new Dexie(`TestDB_68_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('runDiscoveryRound page bound', () => {
  it('stops after maxPages, leaving the category discovering with the cursor saved', async () => {
    vi.resetModules();
    const { discoverPage } = await import('../../entrypoints/background/sync/sync-discovery');
    const { runDiscoveryRound } = await import(
      '../../entrypoints/background/sync/sync-coordinator'
    );

    // Ensure all 4 category rows exist so only PRIMARY is discovering.
    await testDb.syncState.bulkPut([
      makeSyncState({ category: 'PRIMARY_INBOX', phase: 'discovering' }),
      makeSyncState({ category: 'SECONDARY_INBOX', phase: 'complete' }),
      makeSyncState({ category: 'ARCHIVE', phase: 'complete' }),
      makeSyncState({ category: 'SPAM', phase: 'complete' }),
    ]);

    // Endless pagination: cursor always advances, never a last page.
    let page = 0;
    vi.mocked(discoverPage).mockImplementation(async () => ({
      conversations: [],
      profiles: [],
      isLastPage: false,
      nextCursor: `cursor-${++page}`,
    }));

    await runDiscoveryRound(5, () => Promise.resolve());

    expect(discoverPage).toHaveBeenCalledTimes(5);
    const state = await testDb.syncState.get('PRIMARY_INBOX');
    expect(state.phase).toBe('discovering');
    expect(state.cursor).toBe('cursor-5');
  });

  it('completes a category (phase→backfilling) when the last page arrives within the bound', async () => {
    vi.resetModules();
    const { discoverPage } = await import('../../entrypoints/background/sync/sync-discovery');
    const { runDiscoveryRound } = await import(
      '../../entrypoints/background/sync/sync-coordinator'
    );

    await testDb.syncState.bulkPut([
      makeSyncState({ category: 'PRIMARY_INBOX', phase: 'discovering' }),
      makeSyncState({ category: 'SECONDARY_INBOX', phase: 'complete' }),
      makeSyncState({ category: 'ARCHIVE', phase: 'complete' }),
      makeSyncState({ category: 'SPAM', phase: 'complete' }),
    ]);

    // The mock instance is shared across tests in this file — reset both the
    // implementation and the call count left by the previous test.
    vi.mocked(discoverPage).mockReset();
    vi.mocked(discoverPage)
      .mockResolvedValueOnce({ conversations: [], profiles: [], isLastPage: false, nextCursor: 'c1' })
      .mockResolvedValueOnce({ conversations: [], profiles: [], isLastPage: true, nextCursor: null });

    await runDiscoveryRound(10, () => Promise.resolve());

    expect(discoverPage).toHaveBeenCalledTimes(2);
    const state = await testDb.syncState.get('PRIMARY_INBOX');
    expect(state.phase).toBe('backfilling');
    expect(state.cursor).toBe('');
  });
});

describe('stuck-item recovery per DB generation', () => {
  it('re-runs recoverStuckItems when the account/database generation changes', async () => {
    vi.resetModules();
    const { discoverPage } = await import('../../entrypoints/background/sync/sync-discovery');
    const { recoverStuckItems } = await import(
      '../../entrypoints/background/sync/sync-backfill'
    );
    const { setupSyncCoordinator } = await import(
      '../../entrypoints/background/sync/sync-coordinator'
    );

    // Reset the shared mock so the startup tick's discovery finishes instantly.
    vi.mocked(discoverPage).mockReset();
    vi.mocked(discoverPage).mockResolvedValue({
      conversations: [],
      profiles: [],
      isLastPage: true,
      nextCursor: null,
    });

    setupSyncCoordinator();

    // Wait for the startup recovery.
    await vi.waitFor(() => {
      expect(recoverStuckItems).toHaveBeenCalled();
    });

    // Grab the alarm listener registered by the coordinator.
    const listener = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls[0][0];

    // Simulate a login/account switch AFTER startup: new DB generation.
    vi.mocked(recoverStuckItems).mockClear();
    genState.gen = 2;

    // Re-fire the alarm on each retry — an alarm that lands while the startup
    // tick is still running is skipped by the tick-overlap guard.
    await vi.waitFor(
      () => {
        listener({ name: 'inflow-sync' } as any);
        expect(recoverStuckItems).toHaveBeenCalled();
      },
      { timeout: 5000 }
    );
  });
});
