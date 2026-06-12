import Dexie from 'dexie';
import { applySchema, type SyncState, type SyncQueueItem } from '@/db/database';

// ── Test DB setup ────────────────────────────────────────────────────────────
let testDb: any;

// Controllable DB generation so tests can simulate an account switch
// (switchDatabase) completing while a network fetch is in flight.
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

vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
}));

vi.mock('@/lib/sync-settings', () => ({
  getBackfillCutoff: vi.fn().mockResolvedValue(0),
}));

beforeEach(async () => {
  genState.gen = 1;
  testDb = new Dexie(`TestDB_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function makeSyncQueueItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    conversationId: 'conv-001',
    category: 'PRIMARY_INBOX',
    lastActivityAt: Date.now(),
    messagesSyncedAt: 0,
    status: 'pending',
    failCount: 0,
    lastFailedAt: 0,
    priority: Number.MAX_SAFE_INTEGER - Date.now(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('sync-coordinator', () => {
  describe('setupSyncCoordinator', () => {
    it('creates an alarm with 0.5 minute period', async () => {
      vi.resetModules();

      const { setupSyncCoordinator } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      setupSyncCoordinator();

      expect(chrome.alarms.create).toHaveBeenCalledWith('inflow-sync', {
        periodInMinutes: 0.5,
      });
    });

    it('calls recoverStuckItems on setup', async () => {
      vi.resetModules();

      const { recoverStuckItems } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );
      vi.mocked(recoverStuckItems).mockClear();

      const { setupSyncCoordinator } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      setupSyncCoordinator();

      // recoverStuckItems is called asynchronously via db.open().then()
      await vi.waitFor(() => {
        expect(recoverStuckItems).toHaveBeenCalled();
      });
    });
  });

  describe('toggleSyncPause', () => {
    it('returns true after first call (paused)', async () => {
      vi.resetModules();

      const { toggleSyncPause } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      const result = toggleSyncPause();
      expect(result).toBe(true);
    });

    it('returns false after second call (unpaused)', async () => {
      vi.resetModules();

      const { toggleSyncPause } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      toggleSyncPause(); // true (paused)
      const result = toggleSyncPause(); // false (unpaused)
      expect(result).toBe(false);
    });
  });

  describe('broadcastProgress', () => {
    it('sends SYNC_PROGRESS via chrome.runtime.sendMessage with correct queue counts', async () => {
      vi.resetModules();

      const { broadcastProgress } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      // Insert some sync queue items with various statuses
      await testDb.syncQueue.bulkPut([
        makeSyncQueueItem({ conversationId: 'c1', status: 'pending' }),
        makeSyncQueueItem({ conversationId: 'c2', status: 'pending' }),
        makeSyncQueueItem({ conversationId: 'c3', status: 'syncing' }),
        makeSyncQueueItem({ conversationId: 'c4', status: 'done' }),
        makeSyncQueueItem({ conversationId: 'c5', status: 'done' }),
        makeSyncQueueItem({ conversationId: 'c6', status: 'done' }),
        makeSyncQueueItem({ conversationId: 'c7', status: 'failed' }),
      ]);

      const stateMap = new Map<string, SyncState>();
      stateMap.set('PRIMARY_INBOX', makeSyncState({
        category: 'PRIMARY_INBOX',
        phase: 'backfilling',
        totalDiscovered: 42,
      }));

      vi.mocked(chrome.runtime.sendMessage).mockClear();

      broadcastProgress(stateMap);

      // broadcastProgress reads the queue async then sends — wait for it
      await vi.waitFor(() => {
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'SYNC_PROGRESS',
            progress: expect.objectContaining({
              queue: expect.objectContaining({
                pending: 2,
                syncing: 1,
                done: 3,
                failed: 1,
                total: 7,
              }),
              categories: expect.objectContaining({
                PRIMARY_INBOX: expect.objectContaining({
                  phase: 'backfilling',
                  totalDiscovered: 42,
                }),
              }),
            }),
          })
        );
      });
    });
  });

  describe('burstDiscover', () => {
    it('paginates through pages (calls discoverPage in a loop)', async () => {
      vi.resetModules();

      const { discoverPage, enqueueConversations } = await import(
        '../../entrypoints/background/sync/sync-discovery'
      );
      const { burstDiscover } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      // Set up sync state for the category
      await testDb.syncState.put(makeSyncState({
        category: 'SECONDARY_INBOX',
        phase: 'discovering',
        cursor: '',
      }));

      // Clear any calls from module init
      vi.mocked(discoverPage).mockClear();
      vi.mocked(enqueueConversations).mockClear();

      let callCount = 0;
      vi.mocked(discoverPage).mockImplementation(async (_cat, _cursor) => {
        callCount++;
        if (callCount < 3) {
          return {
            conversations: [{ id: `conv-${callCount}` }] as any[],
            profiles: [],
            isLastPage: false,
            nextCursor: `cursor-${callCount}`,
          };
        }
        return {
          conversations: [{ id: `conv-${callCount}` }] as any[],
          profiles: [],
          isLastPage: true,
          nextCursor: null,
        };
      });
      vi.mocked(enqueueConversations).mockResolvedValue({ enqueued: 1, skipped: 0 });

      await burstDiscover('SECONDARY_INBOX');

      // Should have called discoverPage 3 times (page1, page2, lastPage)
      expect(callCount).toBe(3);
      expect(enqueueConversations).toHaveBeenCalledTimes(3);
    });

    // Regression: burstDiscover had no DB-generation checks at all. `db` is a
    // live binding rebound by switchDatabase, so when an account switch
    // completed during the discoverPage network await, the discovered
    // conversations were enqueued into the NEW account's database.
    it('stops without writing when the account switches mid-discoverPage', async () => {
      vi.resetModules();

      const { discoverPage, enqueueConversations } = await import(
        '../../entrypoints/background/sync/sync-discovery'
      );
      const { burstDiscover } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      await testDb.syncState.put(makeSyncState({
        category: 'SECONDARY_INBOX',
        phase: 'discovering',
        cursor: '',
      }));

      vi.mocked(discoverPage).mockClear();
      vi.mocked(enqueueConversations).mockClear();
      vi.mocked(discoverPage).mockImplementation(async () => {
        genState.gen++; // switchDatabase completes while the fetch is in flight
        return {
          conversations: [{ id: 'conv-old-account' }] as any[],
          profiles: [],
          isLastPage: true,
          nextCursor: null,
        };
      });

      await burstDiscover('SECONDARY_INBOX');

      expect(enqueueConversations).not.toHaveBeenCalled();
      // syncState must not be flipped to backfilling in the new account's DB
      const state = await testDb.syncState.get('SECONDARY_INBOX');
      expect(state.phase).toBe('discovering');
    });

    it('prevents concurrent burst for same category (_discoveringCategories)', async () => {
      vi.resetModules();

      const { discoverPage, enqueueConversations } = await import(
        '../../entrypoints/background/sync/sync-discovery'
      );
      const { burstDiscover } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      await testDb.syncState.put(makeSyncState({
        category: 'ARCHIVE',
        phase: 'discovering',
        cursor: '',
      }));

      let resolveFirst!: () => void;
      let firstCallMade = false;

      vi.mocked(discoverPage).mockImplementation(async () => {
        if (!firstCallMade) {
          firstCallMade = true;
          // First call blocks so we can test concurrent access
          await new Promise<void>((r) => { resolveFirst = r; });
        }
        return {
          conversations: [],
          profiles: [],
          isLastPage: true,
          nextCursor: null,
        };
      });
      vi.mocked(enqueueConversations).mockResolvedValue({ enqueued: 0, skipped: 0 });

      // Start first burst (will block)
      const p1 = burstDiscover('ARCHIVE');

      // Wait for the first call to register
      await vi.waitFor(() => {
        expect(firstCallMade).toBe(true);
      });

      // Start second burst for same category — should be skipped
      vi.mocked(discoverPage).mockClear();
      await burstDiscover('ARCHIVE');

      // discoverPage should NOT have been called again for the second burst
      expect(discoverPage).not.toHaveBeenCalled();

      // Resolve first burst
      resolveFirst();
      await p1;
    });

    it('skips fresh categories (<15 min since completion)', async () => {
      vi.resetModules();

      const { discoverPage } = await import(
        '../../entrypoints/background/sync/sync-discovery'
      );
      const { burstDiscover } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      // Set up a complete category that finished recently
      await testDb.syncState.put(makeSyncState({
        category: 'SPAM',
        phase: 'complete',
        discoveryCompletedAt: Date.now() - 5 * 60 * 1000, // 5 min ago (< 15 min threshold)
      }));

      vi.mocked(discoverPage).mockClear();

      await burstDiscover('SPAM');

      // Should not discover — category is fresh
      expect(discoverPage).not.toHaveBeenCalled();
    });

    it('transitions to backfilling when last page reached', async () => {
      vi.resetModules();

      const { discoverPage, enqueueConversations } = await import(
        '../../entrypoints/background/sync/sync-discovery'
      );
      const { burstDiscover } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      await testDb.syncState.put(makeSyncState({
        category: 'PRIMARY_INBOX',
        phase: 'discovering',
        cursor: '',
        totalDiscovered: 0,
      }));

      vi.mocked(discoverPage).mockResolvedValue({
        conversations: [{ id: 'c1' }] as any[],
        profiles: [],
        isLastPage: true,
        nextCursor: null,
      });
      vi.mocked(enqueueConversations).mockResolvedValue({ enqueued: 1, skipped: 0 });

      await burstDiscover('PRIMARY_INBOX');

      const state = await testDb.syncState.get('PRIMARY_INBOX');
      expect(state.phase).toBe('backfilling');
      expect(state.totalDiscovered).toBe(1);
      expect(state.discoveryCompletedAt).toBeGreaterThan(0);
    });

    it('runs backfill pass after burst discovery', async () => {
      vi.resetModules();

      const { discoverPage, enqueueConversations } = await import(
        '../../entrypoints/background/sync/sync-discovery'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );
      const { burstDiscover } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      await testDb.syncState.put(makeSyncState({
        category: 'PRIMARY_INBOX',
        phase: 'discovering',
      }));

      vi.mocked(discoverPage).mockResolvedValue({
        conversations: [],
        profiles: [],
        isLastPage: true,
        nextCursor: null,
      });
      vi.mocked(enqueueConversations).mockResolvedValue({ enqueued: 0, skipped: 0 });
      vi.mocked(backfillBatch).mockClear();

      // Insert a pending item so the post-burst backfill triggers
      await testDb.syncQueue.put(makeSyncQueueItem({
        conversationId: 'conv-backfill',
        status: 'pending',
      }));

      await burstDiscover('PRIMARY_INBOX');

      expect(backfillBatch).toHaveBeenCalled();
    });
  });

  describe('tick lifecycle (via alarm trigger)', () => {
    it('drains action queue at start of tick', async () => {
      vi.resetModules();

      const { drainActionQueue } = await import(
        '../../entrypoints/background/action-queue'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );
      vi.mocked(drainActionQueue).mockClear();
      vi.mocked(syncConversations).mockResolvedValue(undefined);

      const { setupSyncCoordinator } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      setupSyncCoordinator();

      // Wait for the initial tick to complete (setupSyncCoordinator fires onSyncTick immediately)
      await vi.waitFor(() => {
        expect(drainActionQueue).toHaveBeenCalled();
      });
    });

    it('skips quick poll when SSE connected', async () => {
      vi.resetModules();

      const { isRealtimeConnected } = await import(
        '../../entrypoints/background/realtime/sse-client'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );
      const { drainActionQueue } = await import(
        '../../entrypoints/background/action-queue'
      );

      vi.mocked(isRealtimeConnected).mockReturnValue(true);
      vi.mocked(syncConversations).mockClear();
      vi.mocked(drainActionQueue).mockResolvedValue(undefined);

      const { setupSyncCoordinator } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      setupSyncCoordinator();

      // Wait for the initial tick to complete
      await vi.waitFor(() => {
        expect(drainActionQueue).toHaveBeenCalled();
      });

      // Give tick time to complete fully
      await new Promise((r) => setTimeout(r, 100));

      // syncConversations should NOT have been called since SSE is connected
      expect(syncConversations).not.toHaveBeenCalled();

      // Reset
      vi.mocked(isRealtimeConnected).mockReturnValue(false);
    });

    it('runs quick poll when SSE disconnected', async () => {
      vi.resetModules();

      const { isRealtimeConnected } = await import(
        '../../entrypoints/background/realtime/sse-client'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );
      const { drainActionQueue } = await import(
        '../../entrypoints/background/action-queue'
      );

      vi.mocked(isRealtimeConnected).mockReturnValue(false);
      vi.mocked(syncConversations).mockClear();
      vi.mocked(drainActionQueue).mockResolvedValue(undefined);

      const { setupSyncCoordinator } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      setupSyncCoordinator();

      // Wait for the initial tick and its full lifecycle
      await vi.waitFor(() => {
        expect(syncConversations).toHaveBeenCalled();
      });
    });

    it('paused tick is skipped', async () => {
      vi.resetModules();

      const { drainActionQueue } = await import(
        '../../entrypoints/background/action-queue'
      );
      const { syncConversations } = await import(
        '../../entrypoints/background/sync/sync-engine'
      );

      vi.mocked(drainActionQueue).mockClear();
      vi.mocked(syncConversations).mockClear();

      const { setupSyncCoordinator, toggleSyncPause } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      // Wait for initial tick to finish before pausing
      setupSyncCoordinator();
      await vi.waitFor(() => {
        expect(drainActionQueue).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 100));

      // Now pause
      toggleSyncPause();
      vi.mocked(drainActionQueue).mockClear();
      vi.mocked(syncConversations).mockClear();

      // Capture the alarm listener that was registered
      const addListenerCalls = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls;
      expect(addListenerCalls.length).toBeGreaterThan(0);
      const alarmListener = addListenerCalls[addListenerCalls.length - 1][0] as (alarm: any) => void;

      // Trigger the alarm while paused
      alarmListener({ name: 'inflow-sync' });

      // Give a moment for async operations
      await new Promise((r) => setTimeout(r, 100));

      // drainActionQueue and syncConversations should NOT have been called while paused
      expect(drainActionQueue).not.toHaveBeenCalled();
      expect(syncConversations).not.toHaveBeenCalled();
    });

    it('alarm handler triggers tick for inflow-sync alarm', async () => {
      vi.resetModules();

      const { drainActionQueue } = await import(
        '../../entrypoints/background/action-queue'
      );
      vi.mocked(drainActionQueue).mockClear();

      const { setupSyncCoordinator } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      setupSyncCoordinator();

      // Wait for initial tick
      await vi.waitFor(() => {
        expect(drainActionQueue).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 100));

      // Clear mocks to track only alarm-triggered tick
      vi.mocked(drainActionQueue).mockClear();

      // Get the alarm listener
      const addListenerCalls = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls;
      const alarmListener = addListenerCalls[addListenerCalls.length - 1][0] as (alarm: any) => void;

      // Trigger with the correct alarm name
      alarmListener({ name: 'inflow-sync' });

      await vi.waitFor(() => {
        expect(drainActionQueue).toHaveBeenCalled();
      });
    });

    it('does not trigger tick for other alarm names', async () => {
      vi.resetModules();

      const { drainActionQueue } = await import(
        '../../entrypoints/background/action-queue'
      );
      vi.mocked(drainActionQueue).mockClear();

      const { setupSyncCoordinator } = await import(
        '../../entrypoints/background/sync/sync-coordinator'
      );

      setupSyncCoordinator();

      // Wait for initial tick
      await vi.waitFor(() => {
        expect(drainActionQueue).toHaveBeenCalled();
      });
      await new Promise((r) => setTimeout(r, 100));

      // Clear mocks
      vi.mocked(drainActionQueue).mockClear();

      // Get the alarm listener
      const addListenerCalls = vi.mocked(chrome.alarms.onAlarm.addListener).mock.calls;
      const alarmListener = addListenerCalls[addListenerCalls.length - 1][0] as (alarm: any) => void;

      // Trigger with a different alarm name
      alarmListener({ name: 'some-other-alarm' });

      // Give time for async operations
      await new Promise((r) => setTimeout(r, 100));

      // Should NOT have triggered a tick
      expect(drainActionQueue).not.toHaveBeenCalled();
    });
  });
});
