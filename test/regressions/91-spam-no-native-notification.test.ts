/**
 * Regression: a new message arriving in a SPAM conversation fired a native OS
 * notification, even though spam threads intentionally stay quiet everywhere
 * else (they are never marked unread, moved to Focused, or un-archived).
 *
 * Fix: showNativeNotification checks the conversation's category and skips
 * SPAM conversations.
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
    id: 'conv-spam',
    participantUrns: ['urn:li:fsd_profile:ALICE'],
    participantNames: ['Alice Jones'],
    participantPictures: [''],
    lastMessage: 'earlier message',
    lastActivityAt: 5000,
    read: 1,
    archived: 0,
    category: 'SPAM',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

function buildMessageEvent(msg: {
  entityUrn: string;
  convId: string;
  body: string;
  deliveredAt: number;
}) {
  const participantUrn = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:ALICE';
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
                hostIdentityUrn: 'urn:li:fsd_profile:ALICE',
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

// showNativeNotification is fire-and-forget — flush its detached async chain
// (tabs.query → conversations.get → notifications.create) before asserting.
function flush(ms = 25) {
  return new Promise((r) => setTimeout(r, ms));
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_91_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  vi.mocked(chrome.tabs.query).mockResolvedValue([]);
  vi.mocked(chrome.notifications.create).mockClear();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('native notifications for spam conversations', () => {
  it('does not fire a desktop notification for a new message in a SPAM conversation', async () => {
    await testDb.conversations.put(makeConversation());

    const ev = buildMessageEvent({
      entityUrn: 'urn:li:msg_message:SPAM_NEW',
      convId: 'conv-spam',
      body: 'buy my thing',
      deliveredAt: 6000,
    });
    await handleRealtimeEvent(ev.eventType, ev.data);
    await flush();

    expect(chrome.notifications.create).not.toHaveBeenCalled();

    // Spam behavior otherwise unchanged: stays in SPAM, stays read.
    const conv = await testDb.conversations.get('conv-spam');
    expect(conv.category).toBe('SPAM');
    expect(conv.read).toBe(1);
    // The message itself is still stored.
    expect(await testDb.messages.get('urn:li:msg_message:SPAM_NEW')).toBeDefined();
  });

  it('still fires a desktop notification for a new message in a non-spam conversation', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'conv-normal', category: 'PRIMARY_INBOX' })
    );

    const ev = buildMessageEvent({
      entityUrn: 'urn:li:msg_message:NORMAL_NEW',
      convId: 'conv-normal',
      body: 'hello there',
      deliveredAt: 6000,
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    await vi.waitFor(() => {
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'conv-normal',
        expect.objectContaining({ title: 'Alice Jones' })
      );
    });
  });
});
