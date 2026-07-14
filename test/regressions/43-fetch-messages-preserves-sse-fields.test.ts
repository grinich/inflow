// Regression: the FETCH_MESSAGES fast path (existingCount > 0) bulkPut fresh
// API rows WITHOUT preserving SSE-written fields (seenAt / reactions /
// editedAt), unlike backfill which explicitly preserves them because the
// pagination API doesn't return them. Once a prior dedup had removed the SSE
// duplicate rows there was nothing left to re-merge from, so reopening a
// thread permanently wiped read receipts, reactions, and edit markers.
//
// Also: the optimistic/SSE dedup at the end of FETCH_MESSAGES ran outside a
// transaction (backfill's identical logic is wrapped in one), letting
// concurrent SSE/backfill writes interleave between the read and the delete.
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Message } from '@/types/message';
import type { VoyagerResponse } from '@/types/voyager';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
    mergeProfiles: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn(),
  fetchAllMessages: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  createConversation: vi.fn(),
  reactWithEmoji: vi.fn(),
  recallMessage: vi.fn(),
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
vi.mock('../../entrypoints/background/sync/prefetch-posts', () => ({
  prefetchSharedPosts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../entrypoints/background/sync/repair-participants', () => ({
  repairConversationParticipants: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../entrypoints/background/sync/merge-conversation', () => ({ mergeConversation: vi.fn() }));
vi.mock('../../entrypoints/background/diagnostic', () => ({ runDiagnosticSync: vi.fn() }));
vi.mock('../../entrypoints/background/realtime/sse-client', () => ({ getSSEStatus: vi.fn() }));
vi.mock('../../entrypoints/background/db-ready', () => ({
  dbReady: Promise.resolve(),
  markDbReady: vi.fn(),
}));
vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
  getDebugLogs: vi.fn(),
  clearDebugLogs: vi.fn(),
}));

const CONV = '2-conv-preserve';
const MSG_ID = 'urn:li:msg_message:preserve-1';

function makeStoredMessage(over: Partial<Message> = {}): Message {
  return {
    id: MSG_ID,
    conversationId: CONV,
    senderUrn: 'urn:li:fsd_profile:OTHER',
    senderName: 'Other',
    senderPicture: '',
    body: 'hello',
    createdAt: 1_000_000,
    isFromMe: false,
    ...over,
  };
}

/** A pagination-API page returning the same message WITHOUT seenAt/reactions/editedAt. */
function makeApiPage(): VoyagerResponse {
  const participantUrn = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:OTHER';
  return {
    data: {},
    included: [
      {
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: participantUrn,
        hostIdentityUrn: 'urn:li:fsd_profile:OTHER',
        participantType: { member: { firstName: { text: 'Other' }, lastName: { text: 'User' } } },
      },
      {
        $type: 'com.linkedin.messenger.Message',
        entityUrn: MSG_ID,
        body: { text: 'hello' },
        deliveredAt: 1_000_000,
        '*sender': participantUrn,
      },
    ],
  } as VoyagerResponse;
}

beforeEach(async () => {
  testDb = new Dexie(`FetchPreserve_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('FETCH_MESSAGES fast path', () => {
  it('preserves seenAt / reactions / editedAt that the pagination API does not return', async () => {
    const { handleMessage } = await import('../../entrypoints/background/messages');
    const { fetchMessages } = await import('../../entrypoints/background/api/messages');

    const reactions = [{ emoji: '👍', count: 1, firstReactedAt: 1_000_500, viewerReacted: false }];
    await testDb.messages.put(
      makeStoredMessage({ seenAt: 1_000_900, editedAt: 1_000_800, reactions })
    );

    vi.mocked(fetchMessages).mockResolvedValue(makeApiPage());

    const res = await handleMessage({ type: 'FETCH_MESSAGES', conversationId: CONV } as any);
    expect(res.success).toBe(true);

    const stored = await testDb.messages.get(MSG_ID);
    expect(stored).toBeTruthy();
    expect(stored.seenAt).toBe(1_000_900);
    expect(stored.editedAt).toBe(1_000_800);
    expect(stored.reactions).toEqual(reactions);
  });

  it('runs the SSE/optimistic dedup inside a rw transaction on messages', async () => {
    const { handleMessage } = await import('../../entrypoints/background/messages');
    const { fetchMessages } = await import('../../entrypoints/background/api/messages');

    await testDb.messages.put(makeStoredMessage());
    vi.mocked(fetchMessages).mockResolvedValue(makeApiPage());

    const txSpy = vi.spyOn(testDb, 'transaction');
    const res = await handleMessage({ type: 'FETCH_MESSAGES', conversationId: CONV } as any);
    expect(res.success).toBe(true);
    expect(txSpy).toHaveBeenCalledWith('rw', testDb.messages, expect.any(Function));
  });
});
