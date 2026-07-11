/**
 * Regression: transient network failures spammed the extension error console.
 *
 * A dropped connection or request timeout during background sync/SSE (offline,
 * machine sleep/wake, LinkedIn closing an idle stream) was logged at error
 * level — Chrome collects those into chrome://extensions "Errors", so routine
 * flakiness read as a crash:
 *   [COORDINATOR] Discovery failed for ARCHIVE: TypeError: Failed to fetch
 *   [COORDINATOR] Discovery failed for ARCHIVE: TimeoutError: signal timed out
 *   [SSE] Stream read error: TypeError: network error
 *
 * All of these self-heal (discovery resumes from its saved cursor on the next
 * tick, the SSE client reconnects with backoff). Fix: classify transient
 * network errors (isTransientNetworkError) and log them at warn level; genuine
 * failures still log at error level.
 */
import Dexie from 'dexie';
import { applySchema, type SyncState } from '@/db/database';
import { debugLog } from '@/lib/debug-log';
import { discoverPage } from '../../entrypoints/background/sync/sync-discovery';
import { realtimeFetch } from '../../entrypoints/background/api/client';
import { runDiscoveryRound } from '../../entrypoints/background/sync/sync-coordinator';
import { startRealtime, stopRealtime } from '../../entrypoints/background/realtime/sse-client';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
    getDbGeneration: () => 1,
  };
});

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

vi.mock('../../entrypoints/background/sync/sync-engine', () => ({
  syncConversations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/background/sync/sync-discovery', () => ({
  discoverPage: vi.fn(),
  enqueueConversations: vi.fn().mockResolvedValue({ enqueued: 0, skipped: 0 }),
}));

vi.mock('../../entrypoints/background/sync/sync-backfill', () => ({
  backfillBatch: vi.fn().mockResolvedValue(0),
  recoverStuckItems: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../entrypoints/background/action-queue', () => ({
  drainActionQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/api/client', () => ({
  realtimeFetch: vi.fn(),
}));

vi.mock('../../entrypoints/background/realtime/event-handler', () => ({
  handleRealtimeEvent: vi.fn().mockResolvedValue(undefined),
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

function logCalls(level: 'warn' | 'error', match: string) {
  return vi
    .mocked(debugLog)
    .mock.calls.filter((c) => c[0] === level && String(c[1]).includes(match));
}

beforeEach(async () => {
  vi.mocked(debugLog).mockClear();
  testDb = new Dexie(`TestDB_90_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.syncState.bulkPut([
    makeSyncState({ category: 'PRIMARY_INBOX', phase: 'discovering' }),
    makeSyncState({ category: 'SECONDARY_INBOX', phase: 'complete' }),
    makeSyncState({ category: 'ARCHIVE', phase: 'complete' }),
    makeSyncState({ category: 'SPAM', phase: 'complete' }),
  ]);
});

afterEach(async () => {
  stopRealtime();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('discovery network failures log at warn level', () => {
  it('logs "Failed to fetch" during discovery as a warning, not an error', async () => {
    vi.mocked(discoverPage).mockRejectedValue(new TypeError('Failed to fetch'));

    await runDiscoveryRound(5, () => Promise.resolve());

    expect(logCalls('warn', 'Discovery failed for PRIMARY_INBOX')).toHaveLength(1);
    expect(logCalls('error', 'Discovery failed for PRIMARY_INBOX')).toHaveLength(0);
  });

  it('logs an AbortSignal timeout during discovery as a warning, not an error', async () => {
    vi.mocked(discoverPage).mockRejectedValue(
      new DOMException('signal timed out', 'TimeoutError')
    );

    await runDiscoveryRound(5, () => Promise.resolve());

    expect(logCalls('warn', 'Discovery failed for PRIMARY_INBOX')).toHaveLength(1);
    expect(logCalls('error', 'Discovery failed for PRIMARY_INBOX')).toHaveLength(0);
  });

  it('still logs a non-network discovery failure at error level', async () => {
    vi.mocked(discoverPage).mockRejectedValue(new Error('unexpected schema'));

    await runDiscoveryRound(5, () => Promise.resolve());

    expect(logCalls('error', 'Discovery failed for PRIMARY_INBOX')).toHaveLength(1);
    expect(logCalls('warn', 'Discovery failed for PRIMARY_INBOX')).toHaveLength(0);
  });
});

describe('SSE network failures log at warn level', () => {
  it('logs a mid-stream network drop as a warning, not an error', async () => {
    // Stream that errors on first read — Chrome surfaces this exact error when
    // the connection drops mid-stream.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new TypeError('network error'));
      },
    });
    vi.mocked(realtimeFetch).mockResolvedValue({ ok: true, body } as unknown as Response);

    startRealtime();
    await vi.waitFor(() => {
      expect(logCalls('warn', '[SSE] Stream read error')).toHaveLength(1);
    });
    expect(logCalls('error', '[SSE] Stream read error')).toHaveLength(0);
  });

  it('logs a failed connection attempt as a warning, not an error', async () => {
    vi.mocked(realtimeFetch).mockRejectedValue(new TypeError('Failed to fetch'));

    startRealtime();
    await vi.waitFor(() => {
      expect(logCalls('warn', '[SSE] Initial connection failed')).toHaveLength(1);
    });
    expect(logCalls('error', '[SSE] Initial connection failed')).toHaveLength(0);
  });
});
