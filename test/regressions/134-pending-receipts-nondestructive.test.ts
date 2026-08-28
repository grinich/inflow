/**
 * Regression: two flaws in the buffered-receipt consumption (regression 103).
 *
 * 1. applyPendingReceipts deleted the buffer entry as it applied — BEFORE the
 *    surrounding transaction committed. A write aborted by an account switch
 *    (isStaleContext early-return) destroyed the only copy of the receipt,
 *    and the pagination API doesn't reliably return receipts, so the message
 *    showed unseen forever. Apply is now non-destructive; callers consume the
 *    returned ids only after the write goes through.
 *
 * 2. Applying BEFORE the preserve step let a stale buffered receipt REGRESS a
 *    newer stored seenAt: the buffered value filled m.seenAt first, so the
 *    "carry prev.seenAt when incoming lacks it" preservation was skipped and
 *    the bulkPut wrote the older timestamp. Apply now runs after preservation
 *    and takes the max.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Message } from '@/types/message';
import type { Conversation } from '@/types/conversation';
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

const fetchMessages = vi.fn();
vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: (...args: any[]) => fetchMessages(...args),
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
vi.mock('../../entrypoints/background/sync/reconcile-messages', () => ({
  reconcileRecalledMessages: vi.fn().mockResolvedValue(undefined),
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

import {
  stashUnmatchedReceipt,
  applyPendingReceipts,
  consumePendingReceipts,
  __resetPendingReceipts,
} from '../../entrypoints/background/realtime/pending-receipts';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';
const CONV_ID = '2-rcpt';
const MSG_URN = 'urn:li:msg_message:(2-rcpt,1)';
const PARTICIPANT_URN = `urn:li:msg_messagingParticipant:${MEMBER_URN}`;

beforeEach(async () => {
  testDb = new Dexie(`TestDB_134_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  fetchMessages.mockReset();
  __resetPendingReceipts();
});

afterEach(async () => {
  __resetPendingReceipts();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('apply is non-destructive until the caller consumes', () => {
  stashUnmatchedReceipt(MSG_URN, 3000);

  const first: any = { id: MSG_URN };
  const matched = applyPendingReceipts([first]);
  expect(first.seenAt).toBe(3000);
  expect(matched).toEqual([MSG_URN]);

  // The write failed/aborted — a later attempt must still find the receipt.
  const second: any = { id: MSG_URN };
  applyPendingReceipts([second]);
  expect(second.seenAt).toBe(3000);

  consumePendingReceipts(matched);
  const third: any = { id: MSG_URN };
  expect(applyPendingReceipts([third])).toEqual([]);
  expect(third.seenAt).toBeUndefined();
});

it('a stale buffered receipt never regresses a newer stored seenAt', async () => {
  const { handleMessage } = await import('../../entrypoints/background/messages');

  await testDb.conversations.put({
    id: CONV_ID,
    participantUrns: ['urn:li:fsd_profile:OTHER'],
    participantNames: ['Other'],
    participantPictures: [''],
    lastMessage: 'x',
    lastActivityAt: 2000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
  } satisfies Conversation);

  // A receipt was stashed while the row didn't exist…
  stashUnmatchedReceipt(MSG_URN, 5000);
  // …then the row was created by a non-consuming path and a NEWER direct
  // receipt landed on it.
  await testDb.messages.put({
    id: MSG_URN,
    conversationId: CONV_ID,
    senderUrn: MEMBER_URN,
    senderName: 'You',
    senderPicture: '',
    body: 'my message',
    createdAt: 2000,
    isFromMe: true,
    seenAt: 9000,
  } satisfies Message);

  fetchMessages.mockResolvedValue({
    data: {},
    included: [
      {
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: PARTICIPANT_URN,
        hostIdentityUrn: MEMBER_URN,
        participantType: { member: { firstName: { text: 'Me' }, lastName: { text: '' } } },
      },
      {
        $type: 'com.linkedin.messenger.Message',
        entityUrn: MSG_URN,
        body: { text: 'my message' },
        deliveredAt: 2000,
        '*sender': PARTICIPANT_URN,
        '*conversation': `urn:li:msg_conversation:(${MEMBER_URN},${CONV_ID})`,
      },
    ],
  } as VoyagerResponse);

  await handleMessage({ type: 'FETCH_MESSAGES', conversationId: CONV_ID } as any);

  expect((await testDb.messages.get(MSG_URN)).seenAt).toBe(9000);
});
