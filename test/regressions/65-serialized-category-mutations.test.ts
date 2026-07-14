/**
 * Regression: category/read mutations for one conversation could race.
 *
 * Sends were serialized per conversation via the send queue, but archive /
 * unarchive / move / mark-read calls ran as independent concurrent fetches.
 * Archive followed by a quick undo (UNARCHIVE) dispatched two racing API calls;
 * if LinkedIn applied them out of order the server ended archived while the UI
 * showed unarchived — and the next reconcile poll "helpfully" re-archived it.
 *
 * Fix: mutations go through the same per-conversation chain as sends, so they
 * execute strictly in dispatch order.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

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

vi.mock('../../entrypoints/background/db-ready', () => ({
  dbReady: Promise.resolve(),
  markDbReady: vi.fn(),
}));

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
  searchConversations: vi.fn(),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn(),
  fetchAllMessages: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  createConversation: vi.fn(),
  reactWithEmoji: vi.fn(),
  recallMessage: vi.fn(),
}));

vi.mock('../../entrypoints/background/api/typeahead', () => ({ searchTypeahead: vi.fn() }));
vi.mock('../../entrypoints/background/api/posts', () => ({ fetchPost: vi.fn() }));
vi.mock('../../entrypoints/background/auth/session', () => ({
  getSession: vi.fn().mockResolvedValue({ authenticated: true, memberUrn: 'urn:li:fsd_profile:SELF' }),
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));
vi.mock('../../entrypoints/background/sync/sync-engine', () => ({
  syncConversations: vi.fn(),
  syncCategory: vi.fn(),
}));
vi.mock('../../entrypoints/background/sync/sync-coordinator', () => ({
  burstDiscover: vi.fn(),
  toggleSyncPause: vi.fn(),
  broadcastProgress: vi.fn(),
}));
vi.mock('../../entrypoints/background/sync/sync-backfill', () => ({ backfillBatch: vi.fn() }));
vi.mock('../../entrypoints/background/sync/prefetch-posts', () => ({ prefetchSharedPosts: vi.fn() }));
vi.mock('../../entrypoints/background/sync/repair-participants', () => ({
  repairConversationParticipants: vi.fn(),
}));
vi.mock('../../entrypoints/background/diagnostic', () => ({ runDiagnosticSync: vi.fn() }));
vi.mock('../../entrypoints/background/realtime/sse-client', () => ({ getSSEStatus: vi.fn() }));
vi.mock('../../entrypoints/background/update-check', () => ({ checkForUpdate: vi.fn() }));
vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
  getDebugLogs: vi.fn(),
  clearDebugLogs: vi.fn(),
}));
vi.mock('@/lib/sync-settings', () => ({ getBackfillCutoff: vi.fn().mockResolvedValue(0) }));

import { handleMessage } from '../../entrypoints/background/messages';
import {
  archiveConversation,
  unarchiveConversation,
} from '../../entrypoints/background/api/conversations';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_65_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('per-conversation mutation serialization', () => {
  it('runs UNARCHIVE only after a slow in-flight ARCHIVE for the same conversation', async () => {
    const order: string[] = [];
    let releaseArchive!: () => void;
    vi.mocked(archiveConversation).mockImplementation(async () => {
      order.push('archive:start');
      await new Promise<void>((r) => (releaseArchive = r));
      order.push('archive:end');
    });
    vi.mocked(unarchiveConversation).mockImplementation(async () => {
      order.push('unarchive');
    });

    const p1 = handleMessage({ type: 'ARCHIVE', conversationId: 'c1' } as any);
    const p2 = handleMessage({ type: 'UNARCHIVE', conversationId: 'c1' } as any);

    // Give the second call every chance to (incorrectly) start concurrently.
    await new Promise((r) => setTimeout(r, 25));
    expect(unarchiveConversation).not.toHaveBeenCalled();

    releaseArchive();
    await Promise.all([p1, p2]);

    expect(order).toEqual(['archive:start', 'archive:end', 'unarchive']);
  });

  it('does not serialize mutations across different conversations', async () => {
    let releaseArchive!: () => void;
    vi.mocked(archiveConversation).mockImplementation(
      () => new Promise<void>((r) => (releaseArchive = r))
    );
    vi.mocked(unarchiveConversation).mockResolvedValue(undefined);

    const p1 = handleMessage({ type: 'ARCHIVE', conversationId: 'c1' } as any);
    const p2 = handleMessage({ type: 'UNARCHIVE', conversationId: 'c2' } as any);

    // The unrelated conversation's mutation must complete without waiting.
    await expect(p2).resolves.toEqual({ success: true });
    expect(unarchiveConversation).toHaveBeenCalled();

    releaseArchive();
    await p1;
  });
});
