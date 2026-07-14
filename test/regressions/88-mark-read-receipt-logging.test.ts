/**
 * Outbound mark-read/unread observability: when marking read/unread INSIDE
 * inflow, the bridge handler now logs receipt of the MARK_READ / MARK_UNREAD
 * before dispatching to LinkedIn. Combined with patchConversation's response
 * logging (regression 86), the whole unread->read chain is visible in the debug
 * panel — so a sync that silently doesn't take can be traced end to end.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { debugLog } from '@/lib/debug-log';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return { ...original, get db() { return testDb; } };
});

vi.mock('../../entrypoints/background/db-ready', () => ({
  dbReady: Promise.resolve(),
  markDbReady: vi.fn(),
}));

vi.mock('../../entrypoints/background/api/conversations', () => ({
  markConversationRead: vi.fn().mockResolvedValue(undefined),
  markConversationUnread: vi.fn().mockResolvedValue(undefined),
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
  moveToOther: vi.fn(),
  moveToFocused: vi.fn(),
  moveToSpam: vi.fn(),
  deleteConversation: vi.fn(),
  starConversation: vi.fn(),
  unstarConversation: vi.fn(),
  searchConversations: vi.fn(),
}));
vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn(), fetchAllMessages: vi.fn(), sendMessage: vi.fn(),
  editMessage: vi.fn(), createConversation: vi.fn(), reactWithEmoji: vi.fn(), recallMessage: vi.fn(),
}));
vi.mock('../../entrypoints/background/api/typeahead', () => ({ searchTypeahead: vi.fn() }));
vi.mock('../../entrypoints/background/api/posts', () => ({ fetchPost: vi.fn() }));
vi.mock('../../entrypoints/background/auth/session', () => ({
  getSession: vi.fn().mockResolvedValue({ authenticated: true, memberUrn: 'urn:li:fsd_profile:SELF' }),
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));
vi.mock('../../entrypoints/background/sync/sync-engine', () => ({ syncConversations: vi.fn(), syncCategory: vi.fn() }));
vi.mock('../../entrypoints/background/sync/sync-coordinator', () => ({
  burstDiscover: vi.fn(), toggleSyncPause: vi.fn(), broadcastProgress: vi.fn(),
}));
vi.mock('../../entrypoints/background/sync/sync-backfill', () => ({ backfillBatch: vi.fn() }));
vi.mock('../../entrypoints/background/sync/prefetch-posts', () => ({ prefetchSharedPosts: vi.fn() }));
vi.mock('../../entrypoints/background/sync/repair-participants', () => ({ repairConversationParticipants: vi.fn() }));
vi.mock('../../entrypoints/background/diagnostic', () => ({ runDiagnosticSync: vi.fn() }));
vi.mock('../../entrypoints/background/realtime/sse-client', () => ({ getSSEStatus: vi.fn() }));
vi.mock('../../entrypoints/background/update-check', () => ({ checkForUpdate: vi.fn() }));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn(), getDebugLogs: vi.fn(), clearDebugLogs: vi.fn() }));
vi.mock('@/lib/sync-settings', () => ({ getBackfillCutoff: vi.fn().mockResolvedValue(0) }));

import { handleMessage } from '../../entrypoints/background/messages';
import { markConversationRead, markConversationUnread } from '../../entrypoints/background/api/conversations';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_88_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  vi.mocked(debugLog).mockClear();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('mark-read/unread receipt logging', () => {
  it('logs receipt of MARK_READ and still dispatches to LinkedIn', async () => {
    const res = await handleMessage({ type: 'MARK_READ', conversationId: 'c1' } as any);
    expect(res).toEqual({ success: true });
    expect(markConversationRead).toHaveBeenCalledWith('c1');
    expect(debugLog).toHaveBeenCalledWith('info', expect.stringContaining('MARK_READ received'));
  });

  it('logs receipt of MARK_UNREAD and still dispatches to LinkedIn', async () => {
    const res = await handleMessage({ type: 'MARK_UNREAD', conversationId: 'c1' } as any);
    expect(res).toEqual({ success: true });
    expect(markConversationUnread).toHaveBeenCalledWith('c1');
    expect(debugLog).toHaveBeenCalledWith('info', expect.stringContaining('MARK_UNREAD received'));
  });
});
