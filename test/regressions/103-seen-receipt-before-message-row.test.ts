/**
 * Regression: a SeenReceipt arriving before its message row existed was
 * silently dropped.
 *
 * handleReadReceipt looked the message up by exact id and did nothing on a
 * miss. When our sent message existed only under an SSE-format id (send
 * response unparseable, canonical copy not yet fetched) — or the receipt
 * simply raced the message write — the receipt targeted the canonical
 * urn:li:msg_message: id, missed, and the ✓✓ indicator was lost for good
 * (the pagination API doesn't reliably return receipts).
 *
 * Fix: unmatched receipts are buffered (bounded, TTL'd, in-memory) and
 * consumed when a row with that id is written — by the SSE write path or by
 * the FETCH_MESSAGES fast path.
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
  handleRealtimeEvent,
  __resetInboundReadState,
} from '../../entrypoints/background/realtime/event-handler';
import { __resetPendingReceipts } from '../../entrypoints/background/realtime/pending-receipts';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';
const CONV_ID = '2-receipt';
const CONV_URN = `urn:li:msg_conversation:(${MEMBER_URN},${CONV_ID})`;
const MSG_URN = 'urn:li:msg_message:(2-receipt,new)';
const PARTICIPANT_URN = `urn:li:msg_messagingParticipant:${MEMBER_URN}`;

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONV_ID,
    participantUrns: ['urn:li:fsd_profile:OTHER'],
    participantNames: ['Other User'],
    participantPictures: [''],
    lastMessage: 'hello',
    lastActivityAt: 1000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

function buildSeenReceiptEvent(messageUrn: string, seenAt: number) {
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: {
          data: {
            included: [
              { $type: 'com.linkedin.messenger.SeenReceipt', '*message': messageUrn, seenAt },
            ],
          },
        },
      },
    },
  };
}

function buildOwnMessageEvent(entityUrn: string, deliveredAt: number) {
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: {
          data: {
            included: [
              {
                $type: 'com.linkedin.messenger.MessagingParticipant',
                entityUrn: PARTICIPANT_URN,
                hostIdentityUrn: MEMBER_URN,
                participantType: { member: { firstName: { text: 'Me' }, lastName: { text: '' } } },
              },
              {
                $type: 'com.linkedin.messenger.Message',
                entityUrn,
                body: { text: 'my message' },
                deliveredAt,
                '*sender': PARTICIPANT_URN,
                '*conversation': CONV_URN,
              },
            ],
          },
        },
      },
    },
  };
}

/** A pagination-API page returning the canonical message (no receipts). */
function makeApiPage(): VoyagerResponse {
  return {
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
        '*conversation': CONV_URN,
      },
    ],
  } as VoyagerResponse;
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_103_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  fetchMessages.mockReset();
  __resetInboundReadState();
  __resetPendingReceipts();
});

afterEach(async () => {
  __resetInboundReadState();
  __resetPendingReceipts();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('SeenReceipt arriving before its message row', () => {
  it('is buffered and applied when the canonical row is written by the SSE path', async () => {
    await testDb.conversations.put(makeConversation());
    // Our message exists only under an SSE-format id — the receipt's canonical
    // target has no row yet.
    await testDb.messages.put({
      id: 'urn:li:fsd_message:sse-copy',
      conversationId: CONV_ID,
      senderUrn: MEMBER_URN,
      senderName: 'You',
      senderPicture: '',
      body: 'my message',
      createdAt: 2000,
      isFromMe: true,
    } satisfies Message);

    const receipt = buildSeenReceiptEvent(MSG_URN, 3000);
    await handleRealtimeEvent(receipt.eventType, receipt.data);

    // The canonical echo arrives afterwards.
    const echo = buildOwnMessageEvent(MSG_URN, 2000);
    await handleRealtimeEvent(echo.eventType, echo.data);

    expect((await testDb.messages.get(MSG_URN)).seenAt).toBe(3000);
  });

  it('is buffered and applied when the canonical row is written by FETCH_MESSAGES', async () => {
    const { handleMessage } = await import('../../entrypoints/background/messages');

    await testDb.conversations.put(makeConversation());
    // An older stored message puts FETCH_MESSAGES on the fast path.
    await testDb.messages.put({
      id: 'urn:li:msg_message:(2-receipt,old)',
      conversationId: CONV_ID,
      senderUrn: 'urn:li:fsd_profile:OTHER',
      senderName: 'Other User',
      senderPicture: '',
      body: 'hello',
      createdAt: 1000,
      isFromMe: false,
    } satisfies Message);

    const receipt = buildSeenReceiptEvent(MSG_URN, 3000);
    await handleRealtimeEvent(receipt.eventType, receipt.data);

    fetchMessages.mockResolvedValue(makeApiPage());
    await handleMessage({ type: 'FETCH_MESSAGES', conversationId: CONV_ID } as any);

    expect((await testDb.messages.get(MSG_URN)).seenAt).toBe(3000);
  });

  it('a receipt for an already-stored row still applies directly (no buffering regression)', async () => {
    await testDb.conversations.put(makeConversation());
    await testDb.messages.put({
      id: MSG_URN,
      conversationId: CONV_ID,
      senderUrn: MEMBER_URN,
      senderName: 'You',
      senderPicture: '',
      body: 'my message',
      createdAt: 2000,
      isFromMe: true,
    } satisfies Message);

    const receipt = buildSeenReceiptEvent(MSG_URN, 3000);
    await handleRealtimeEvent(receipt.eventType, receipt.data);

    expect((await testDb.messages.get(MSG_URN)).seenAt).toBe(3000);
  });
});
