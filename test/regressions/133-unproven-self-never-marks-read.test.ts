/**
 * Regression: the reply-implies-read rule (regression 101) marked genuinely
 * unread threads read when the self-sender HEURISTIC misfired.
 *
 * resolveSelfSender's last resort treats an unparseable, unknown sender as
 * "our own omitted-self echo" — its own doc comment warns that claiming a
 * real sender as self would hide the unread flag. Before regression 101 that
 * misclassification was passive; afterwards the message landed in
 * newOutbound and flipped read 0 → 1: the user lost the unread indicator for
 * a REAL inbound message and got no notification.
 *
 * Fix: only messages whose sender PROVABLY resolved to the member URN count
 * as read-implying outbound; heuristic-self messages never mark read.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Message } from '@/types/message';
import type { Conversation } from '@/types/conversation';

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

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn().mockResolvedValue({ data: {}, included: [] }),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  shouldSuppressConversationUpdate: vi.fn().mockReturnValue(false),
  isMutationSuppressed: vi.fn().mockReturnValue(false),
  recordMutation: vi.fn(),
  recordMarkRead: vi.fn(),
}));

import {
  handleRealtimeEvent,
  __resetInboundReadState,
} from '../../entrypoints/background/realtime/event-handler';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';
const CONV_ID = '2-heur';
const CONV_URN = `urn:li:msg_conversation:(${MEMBER_URN},${CONV_ID})`;

beforeEach(async () => {
  testDb = new Dexie(`TestDB_133_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  __resetInboundReadState();
});

afterEach(async () => {
  __resetInboundReadState();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

function messageEvent(entity: Record<string, any>) {
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: { data: { included: [entity] } },
      },
    },
  };
}

it('a heuristic-self message (unresolvable sender) never marks an unread thread read', async () => {
  await testDb.conversations.put({
    id: CONV_ID,
    participantUrns: ['urn:li:fsd_profile:KANE'],
    participantNames: ['Kane Other'],
    participantPictures: [''],
    lastMessage: 'unread inbound',
    lastActivityAt: 1000,
    read: 0,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
  } satisfies Conversation);
  await testDb.messages.put({
    id: 'urn:li:msg_message:(2-heur,1)',
    conversationId: CONV_ID,
    senderUrn: 'urn:li:fsd_profile:KANE',
    senderName: 'Kane Other',
    senderPicture: '',
    body: 'unread inbound',
    createdAt: 1000,
    isFromMe: false,
  } satisfies Message);

  // A newer message whose sender reference is unparseable garbage and whose
  // participant entity LinkedIn omitted — resolveSelfSender's last resort
  // treats it as our own omitted-self echo.
  const ev = messageEvent({
    $type: 'com.linkedin.messenger.Message',
    entityUrn: 'urn:li:msg_message:(2-heur,2)',
    body: { text: 'actually a real reply from someone' },
    deliveredAt: 2000,
    '*sender': 'urn:li:msg_messagingParticipant:!garbage!ref!',
    '*conversation': CONV_URN,
  });
  await handleRealtimeEvent(ev.eventType, ev.data);

  // The message is stored (as self, per the heuristic) — but the unread flag
  // for the REAL inbound must survive.
  expect(await testDb.messages.get('urn:li:msg_message:(2-heur,2)')).toBeTruthy();
  expect((await testDb.conversations.get(CONV_ID)).read).toBe(0);
});

it('a PROVEN self reply (sender resolves to the member URN) still marks read', async () => {
  await testDb.conversations.put({
    id: CONV_ID,
    participantUrns: ['urn:li:fsd_profile:KANE'],
    participantNames: ['Kane Other'],
    participantPictures: [''],
    lastMessage: 'unread inbound',
    lastActivityAt: 1000,
    read: 0,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
  } satisfies Conversation);

  const ev = messageEvent({
    $type: 'com.linkedin.messenger.Message',
    entityUrn: 'urn:li:msg_message:(2-heur,3)',
    body: { text: 'my reply from web' },
    deliveredAt: 2000,
    '*sender': `urn:li:msg_messagingParticipant:${MEMBER_URN}`,
    '*conversation': CONV_URN,
  });
  await handleRealtimeEvent(ev.eventType, ev.data);

  expect((await testDb.conversations.get(CONV_ID)).read).toBe(1);
});
