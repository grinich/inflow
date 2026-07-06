/**
 * Regression: SSE re-deliveries of OLD messages must not act like new mail.
 *
 * LinkedIn re-sends a com.linkedin.messenger.Message entity when a message is
 * edited or reacted to. The handler treated any inbound Message entity as a new
 * message: it marked the conversation unread, moved it to Focused, un-archived
 * it, fired the in-app toast + native notification, and overwrote lastMessage
 * with the OLD message's body (leaving preview and timestamp describing
 * different messages).
 *
 * Fix: only messages that are genuinely new — not already stored, and newer (in
 * server time) than every stored message / the conversation's lastActivityAt —
 * trigger the unread/move/notify side effects.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
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

vi.mock('../../entrypoints/background/api/profiles', () => ({
  fetchProfileByUrn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn().mockResolvedValue({ data: {}, included: [] }),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

vi.mock('@/lib/feature-flags', () => ({ ENABLE_PROFILE_ENRICHMENT: false }));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  shouldSuppressConversationUpdate: vi.fn().mockReturnValue(false),
  isMutationSuppressed: vi.fn().mockReturnValue(false),
  recordMutation: vi.fn(),
  recordMarkRead: vi.fn(),
}));

import { handleRealtimeEvent } from '../../entrypoints/background/realtime/event-handler';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-red',
    participantUrns: ['urn:li:fsd_profile:ALICE'],
    participantNames: ['Alice Jones'],
    participantPictures: [''],
    lastMessage: 'the latest message',
    lastActivityAt: 5000,
    read: 1,
    archived: 1,
    category: 'ARCHIVE',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

function buildMessageEvent(msg: {
  entityUrn: string;
  convId: string;
  senderProfileId: string;
  body: string;
  deliveredAt: number;
  editedAt?: number;
}) {
  const participantUrn = `urn:li:msg_messagingParticipant:urn:li:fsd_profile:${msg.senderProfileId}`;
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
                entityUrn: participantUrn,
                hostIdentityUrn: `urn:li:fsd_profile:${msg.senderProfileId}`,
                participantType: {
                  member: {
                    firstName: { text: 'Alice' },
                    lastName: { text: 'Jones' },
                  },
                },
              },
              {
                $type: 'com.linkedin.messenger.Message',
                entityUrn: msg.entityUrn,
                body: { text: msg.body },
                deliveredAt: msg.deliveredAt,
                ...(msg.editedAt ? { editedAt: msg.editedAt } : {}),
                '*sender': participantUrn,
                '*conversation': `urn:li:msg_conversation:(${MEMBER_URN},${msg.convId})`,
              },
            ],
          },
        },
      },
    },
  };
}

function incomingMessageCalls() {
  return vi
    .mocked(chrome.runtime.sendMessage)
    .mock.calls.filter((c: any[]) => c[0]?.type === 'INCOMING_MESSAGE');
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_60_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  vi.mocked(chrome.tabs.query).mockResolvedValue([]);
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('SSE re-delivery of an old message (edit/reaction echo)', () => {
  it('does not mark unread, un-archive, notify, or rewind the preview', async () => {
    await testDb.conversations.put(makeConversation());
    // The latest message (t=5000) is already stored.
    await testDb.messages.put({
      id: 'urn:li:msg_message:LATEST',
      conversationId: 'conv-red',
      senderUrn: 'urn:li:fsd_profile:ALICE',
      senderName: 'Alice Jones',
      senderPicture: '',
      body: 'the latest message',
      createdAt: 5000,
      isFromMe: false,
    });

    // Alice edits an OLDER message (t=3000) — LinkedIn re-delivers it as a
    // Message entity that we have not stored under this id.
    const ev = buildMessageEvent({
      entityUrn: 'urn:li:msg_message:OLD_EDITED',
      convId: 'conv-red',
      senderProfileId: 'ALICE',
      body: 'an old message, now edited',
      deliveredAt: 3000,
      editedAt: 9000,
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    const conv = await testDb.conversations.get('conv-red');
    expect(conv.read).toBe(1);
    expect(conv.archived).toBe(1);
    expect(conv.category).toBe('ARCHIVE');
    // Preview must not rewind to the older message's body.
    expect(conv.lastMessage).toBe('the latest message');
    expect(conv.lastActivityAt).toBe(5000);

    // No "new message" toast or native notification for an edit echo.
    expect(incomingMessageCalls()).toHaveLength(0);
    expect(chrome.notifications.create).not.toHaveBeenCalled();

    // The message itself is still stored (edits should render).
    expect(await testDb.messages.get('urn:li:msg_message:OLD_EDITED')).toBeDefined();
  });

  it('still treats a genuinely new inbound message as new mail', async () => {
    await testDb.conversations.put(makeConversation({ id: 'conv-new-mail' }));
    await testDb.messages.put({
      id: 'urn:li:msg_message:LATEST2',
      conversationId: 'conv-new-mail',
      senderUrn: 'urn:li:fsd_profile:ALICE',
      senderName: 'Alice Jones',
      senderPicture: '',
      body: 'the latest message',
      createdAt: 5000,
      isFromMe: false,
    });

    const ev = buildMessageEvent({
      entityUrn: 'urn:li:msg_message:GENUINELY_NEW',
      convId: 'conv-new-mail',
      senderProfileId: 'ALICE',
      body: 'hot off the press',
      deliveredAt: 6000,
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    const conv = await testDb.conversations.get('conv-new-mail');
    expect(conv.read).toBe(0);
    expect(conv.archived).toBe(0);
    expect(conv.category).toBe('PRIMARY_INBOX');
    expect(conv.lastMessage).toBe('hot off the press');
    expect(conv.lastActivityAt).toBe(6000);
    expect(incomingMessageCalls()).toHaveLength(1);
  });

  it('updates the preview (without unread side effects) when the LATEST message is edited', async () => {
    await testDb.conversations.put(makeConversation({ id: 'conv-latest-edit' }));
    await testDb.messages.put({
      id: 'urn:li:msg_message:LATEST3',
      conversationId: 'conv-latest-edit',
      senderUrn: 'urn:li:fsd_profile:ALICE',
      senderName: 'Alice Jones',
      senderPicture: '',
      body: 'the latest message',
      createdAt: 5000,
      isFromMe: false,
    });

    // Edit of the latest message arrives under its SSE id with the same deliveredAt.
    const ev = buildMessageEvent({
      entityUrn: 'urn:li:fsd_message:LATEST3_EDIT',
      convId: 'conv-latest-edit',
      senderProfileId: 'ALICE',
      body: 'the latest message (edited)',
      deliveredAt: 5000,
      editedAt: 9000,
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    const conv = await testDb.conversations.get('conv-latest-edit');
    expect(conv.lastMessage).toBe('the latest message (edited)');
    expect(conv.read).toBe(1);
    expect(conv.archived).toBe(1);
    expect(incomingMessageCalls()).toHaveLength(0);
  });
});
