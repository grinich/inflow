/**
 * Regression: reading + replying to a thread on LinkedIn web (another client)
 * left the conversation stuck unread in inflow.
 *
 * Two holes combined:
 * 1. The SSE echo of our own reply only bumped lastMessage/lastActivityAt —
 *    nothing marked the conversation read, even though replying implies the
 *    thread was read (and LinkedIn marks it read server-side).
 * 2. That lastActivityAt bump then made LinkedIn's (often delayed) Dash
 *    read=true echo fail the staleness guard — its snapshot predates the
 *    reply — so the read state never synced at all.
 *
 * Fix: a genuinely NEW outbound message marks the conversation read (unless a
 * newer inbound arrived in the same batch), and the Dash staleness guard
 * accepts a read=true echo when the only newer local activity is our own
 * stored reply.
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

import { handleRealtimeEvent } from '../../entrypoints/background/realtime/event-handler';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';
const CONV_ID = '2-kane';
const CONV_URN = `urn:li:msg_conversation:(${MEMBER_URN},${CONV_ID})`;

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONV_ID,
    participantUrns: ['urn:li:fsd_profile:KANE'],
    participantNames: ['Kane Other'],
    participantPictures: [''],
    lastMessage: 'inbound from Kane',
    lastActivityAt: 1000,
    read: 0,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

function makeStoredMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'urn:li:msg_message:(2-kane,1)',
    conversationId: CONV_ID,
    senderUrn: 'urn:li:fsd_profile:KANE',
    senderName: 'Kane Other',
    senderPicture: '',
    body: 'inbound from Kane',
    createdAt: 1000,
    isFromMe: false,
    ...overrides,
  };
}

/** DecoratedEvent wrapping com.linkedin.messenger.Message entities. */
function buildMessengerMessageEvent(messages: Array<{
  entityUrn: string;
  senderProfileId: string;
  body: string;
  deliveredAt: number;
}>): { eventType: string; data: any } {
  const included: any[] = [];
  for (const msg of messages) {
    const participantUrn = `urn:li:msg_messagingParticipant:urn:li:fsd_profile:${msg.senderProfileId}`;
    included.push({
      $type: 'com.linkedin.messenger.MessagingParticipant',
      entityUrn: participantUrn,
      hostIdentityUrn: `urn:li:fsd_profile:${msg.senderProfileId}`,
      participantType: {
        member: {
          firstName: { text: msg.senderProfileId },
          lastName: { text: '' },
        },
      },
    });
    included.push({
      $type: 'com.linkedin.messenger.Message',
      entityUrn: msg.entityUrn,
      body: { text: msg.body },
      deliveredAt: msg.deliveredAt,
      '*sender': participantUrn,
      '*conversation': CONV_URN,
    });
  }
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: { data: { included } },
      },
    },
  };
}

/** Dash-format conversation update: ActionResponse result under a dynamic key. */
function buildDashConversationEvent(entity: Record<string, any>) {
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: 'urn:li-realtime:conversationsTopic:urn:li-realtime:myself',
        payload: {
          data: {
            dGVzdA: {
              result: {
                _type: 'com.linkedin.messenger.Conversation',
                entityUrn: CONV_URN,
                ...entity,
              },
            },
          },
        },
      },
    },
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_101_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('cross-client reply marks the conversation read', () => {
  it('a new outbound echo (reply sent from LinkedIn web) marks an unread conversation read', async () => {
    await testDb.conversations.put(makeConversation({ read: 0, lastActivityAt: 1000 }));
    await testDb.messages.put(makeStoredMessage());

    const ev = buildMessengerMessageEvent([
      { entityUrn: 'urn:li:msg_message:(2-kane,2)', senderProfileId: 'SELF', body: 'my reply from web', deliveredAt: 2000 },
    ]);
    await handleRealtimeEvent(ev.eventType, ev.data);

    const conv = await testDb.conversations.get(CONV_ID);
    expect(conv.read).toBe(1);
    expect(conv.lastActivityAt).toBe(2000);
    expect(conv.lastMessage).toBe('my reply from web');
  });

  it('a re-delivered echo of an OLD own message (edit/reaction) does not mark read', async () => {
    await testDb.conversations.put(makeConversation({ read: 0, lastActivityAt: 3000 }));
    await testDb.messages.bulkPut([
      makeStoredMessage({ id: 'urn:li:msg_message:(2-kane,old-own)', senderUrn: MEMBER_URN, senderName: 'You', isFromMe: true, createdAt: 2000, body: 'old own message' }),
      makeStoredMessage({ id: 'urn:li:msg_message:(2-kane,newest)', createdAt: 3000, body: 'newest inbound' }),
    ]);

    // Same entityUrn as the stored own message → a re-delivery, not new mail.
    const ev = buildMessengerMessageEvent([
      { entityUrn: 'urn:li:msg_message:(2-kane,old-own)', senderProfileId: 'SELF', body: 'old own message (edited)', deliveredAt: 2000 },
    ]);
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).read).toBe(0);
  });

  it('a catch-up batch where an inbound is NEWER than our reply stays unread', async () => {
    await testDb.conversations.put(makeConversation({ read: 1, lastActivityAt: 1000 }));
    await testDb.messages.put(makeStoredMessage());

    const ev = buildMessengerMessageEvent([
      { entityUrn: 'urn:li:msg_message:(2-kane,2)', senderProfileId: 'SELF', body: 'my reply', deliveredAt: 2000 },
      { entityUrn: 'urn:li:msg_message:(2-kane,3)', senderProfileId: 'KANE', body: 'kane again', deliveredAt: 3000 },
    ]);
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).read).toBe(0);
  });
});

describe('delayed Dash read=true echo after our own reply', () => {
  it('applies read=true when the only newer local activity is our own stored reply', async () => {
    // Reply echo already processed: own message at 2000 advanced lastActivityAt.
    await testDb.conversations.put(makeConversation({ read: 0, lastActivityAt: 2000 }));
    await testDb.messages.bulkPut([
      makeStoredMessage({ createdAt: 1000 }),
      makeStoredMessage({ id: 'urn:li:msg_message:(2-kane,2)', senderUrn: MEMBER_URN, senderName: 'You', isFromMe: true, createdAt: 2000, body: 'my reply from web' }),
    ]);

    // LinkedIn's read echo snapshots the conversation as of the READ (before
    // the reply): lastActivityAt=1000 < local 2000.
    const ev = buildDashConversationEvent({ read: true, lastActivityAt: 1000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).read).toBe(1);
  });

  it('still ignores a stale read=true echo when a NEWER INBOUND is stored (regression 75)', async () => {
    await testDb.conversations.put(makeConversation({ read: 0, lastActivityAt: 2000 }));
    await testDb.messages.put(makeStoredMessage({ id: 'urn:li:msg_message:(2-kane,newest)', createdAt: 2000, body: 'newest inbound' }));

    const ev = buildDashConversationEvent({ read: true, lastActivityAt: 1000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).read).toBe(0);
  });

  it('still ignores a stale echo when the advance cannot be proven from stored rows', async () => {
    // Conversation advanced to 2000 but no message rows are stored (e.g. bumped
    // by a conversations sync) — freshness unprovable, keep treating as stale.
    await testDb.conversations.put(makeConversation({ read: 0, lastActivityAt: 2000 }));

    const ev = buildDashConversationEvent({ read: true, lastActivityAt: 1000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).read).toBe(0);
  });
});
