/**
 * Regression: composing to a previously-deleted contact left a live tombstone.
 *
 * Deleting a conversation writes a 7-day tombstone so stale server pages can't
 * resurrect it. But LinkedIn REUSES the same conversation ID when you message
 * that person again — CREATE_CONVERSATION brings the thread back to life while
 * the tombstone still blocks mergeConversation inserts, so sync could refuse
 * to (re-)store the now-active conversation.
 *
 * Fix: the CREATE_CONVERSATION handler clears any tombstone for the returned
 * conversation ID.
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
import { createConversation } from '../../entrypoints/background/api/messages';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_72_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('CREATE_CONVERSATION clears the tombstone when LinkedIn reuses a deleted conversation id', async () => {
  // The user deleted the thread with this person earlier…
  await testDb.tombstones.put({ conversationId: '2-reused', deletedAt: Date.now() });
  // …and LinkedIn returns the SAME conversation id for the new message.
  vi.mocked(createConversation).mockResolvedValue({ conversationId: '2-reused' });

  const res = await handleMessage({
    type: 'CREATE_CONVERSATION',
    recipientUrns: ['urn:li:fsd_profile:FRIEND'],
    body: 'hello again',
  } as any);

  expect(res.success).toBe(true);
  expect(await testDb.tombstones.get('2-reused')).toBeUndefined();
});
