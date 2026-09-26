// @vitest-environment jsdom
// Bug: a message landing in the Other tab fired a native OS notification.
//
// The notification path filtered exactly one category — SPAM — so
// SECONDARY_INBOX pinged the OS like anything else. Worse, the decision could
// not even see the truth: applyInboundMessageToConversation promoted any
// non-Focused thread to PRIMARY_INBOX on new inbound mail, and ran BEFORE
// announceInbound, so by notify time the row claimed Focused. LinkedIn's next
// sync wrote SECONDARY_INBOX back, which is where the user then found the
// message they had been interrupted for.
//
// Fix: Other threads are never promoted (LinkedIn overrules it seconds later
// anyway), the notification is skipped for SECONDARY_INBOX as it is for SPAM,
// and a conversation we have never stored resolves its category — from the
// event if it carries one, else one lookup — rather than assuming Focused.
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Conversation } from '@/types/conversation';

let testDb: any;
const fetchConversationSummary = vi.fn();

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return { ...original, get db() { return testDb; } };
});

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn().mockResolvedValue({ data: {}, included: [] }),
}));

vi.mock('../../entrypoints/background/api/conversations', () => ({
  fetchConversationSummary: (...args: any[]) => fetchConversationSummary(...args),
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
const PARTICIPANT = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:ALICE';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-other',
    participantUrns: ['urn:li:fsd_profile:ALICE'],
    participantNames: ['Alice Jones'],
    participantPictures: [''],
    lastMessage: 'earlier message',
    lastActivityAt: 5000,
    read: 1,
    archived: 0,
    category: 'SECONDARY_INBOX',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

/** A realtime message event, optionally carrying the conversation entity. */
function buildMessageEvent(opts: { convId: string; deliveredAt: number; categories?: string[] }) {
  const included: any[] = [
    {
      $type: 'com.linkedin.messenger.MessagingParticipant',
      entityUrn: PARTICIPANT,
      hostIdentityUrn: 'urn:li:fsd_profile:ALICE',
      participantType: { member: { firstName: { text: 'Alice' }, lastName: { text: 'Jones' } } },
    },
    {
      $type: 'com.linkedin.messenger.Message',
      entityUrn: `urn:li:msg_message:${opts.convId}-${opts.deliveredAt}`,
      body: { text: 'a new message' },
      deliveredAt: opts.deliveredAt,
      '*sender': PARTICIPANT,
      '*conversation': `urn:li:msg_conversation:(${MEMBER_URN},${opts.convId})`,
    },
  ];
  if (opts.categories) {
    included.push({
      $type: 'com.linkedin.messenger.Conversation',
      entityUrn: `urn:li:msg_conversation:(${MEMBER_URN},${opts.convId})`,
      categories: opts.categories,
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

/** The handler takes the event type and payload separately. */
const fire = (ev: { eventType: string; data: unknown }) => handleRealtimeEvent(ev.eventType, ev.data as any);

/** showNativeNotification is fire-and-forget — let its async chain settle. */
const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  testDb = new Dexie(`TestDB_181_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  vi.mocked(chrome.tabs.query).mockResolvedValue([]);
  vi.mocked(chrome.notifications.create).mockClear();
  fetchConversationSummary.mockReset();
  fetchConversationSummary.mockResolvedValue({ id: null, category: null });
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

describe('regression #181: the Other tab never raises an OS notification', () => {
  it('stays quiet for a message in an Other thread', async () => {
    await testDb.conversations.put(makeConversation());
    await fire(buildMessageEvent({ convId: 'conv-other', deliveredAt: 9000 }));
    await flush();
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('leaves that thread in Other rather than promoting it to Focused', async () => {
    await testDb.conversations.put(makeConversation());
    await fire(buildMessageEvent({ convId: 'conv-other', deliveredAt: 9000 }));
    const conv = await testDb.conversations.get('conv-other');
    expect(conv.category).toBe('SECONDARY_INBOX');
    // Still unread — quiet is not the same as ignored
    expect(conv.read).toBe(0);
  });

  it('still notifies for a Focused thread', async () => {
    await testDb.conversations.put(makeConversation({ id: 'conv-focused', category: 'PRIMARY_INBOX' }));
    await fire(buildMessageEvent({ convId: 'conv-focused', deliveredAt: 9000 }));
    await flush();
    expect(chrome.notifications.create).toHaveBeenCalled();
  });

  it('still un-archives and notifies when someone replies to an archived thread', async () => {
    await testDb.conversations.put(makeConversation({ id: 'conv-arch', category: 'ARCHIVE', archived: 1 }));
    await fire(buildMessageEvent({ convId: 'conv-arch', deliveredAt: 9000 }));
    await flush();
    const conv = await testDb.conversations.get('conv-arch');
    expect(conv.category).toBe('PRIMARY_INBOX');
    expect(conv.archived).toBe(0);
    expect(chrome.notifications.create).toHaveBeenCalled();
  });

  it('uses the category the event carries for a thread it has never seen', async () => {
    await fire(buildMessageEvent({ convId: 'conv-new', deliveredAt: 9000, categories: ['SECONDARY_INBOX'] }));
    await flush();
    expect((await testDb.conversations.get('conv-new')).category).toBe('SECONDARY_INBOX');
    expect(chrome.notifications.create).not.toHaveBeenCalled();
    // The event answered it; no need to ask LinkedIn
    expect(fetchConversationSummary).not.toHaveBeenCalled();
  });

  it('asks LinkedIn once when the event carries no category, and stays quiet on Other', async () => {
    fetchConversationSummary.mockResolvedValue({ id: 'conv-new', category: 'SECONDARY_INBOX' });
    await fire(buildMessageEvent({ convId: 'conv-new', deliveredAt: 9000 }));
    await flush();
    expect(fetchConversationSummary).toHaveBeenCalledWith(['urn:li:fsd_profile:ALICE']);
    expect((await testDb.conversations.get('conv-new')).category).toBe('SECONDARY_INBOX');
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('notifies for genuine first contact in Focused', async () => {
    fetchConversationSummary.mockResolvedValue({ id: 'conv-new', category: 'PRIMARY_INBOX' });
    await fire(buildMessageEvent({ convId: 'conv-new', deliveredAt: 9000 }));
    await flush();
    expect(chrome.notifications.create).toHaveBeenCalled();
  });

  it('falls back to Focused when the lookup fails, rather than dropping the alert', async () => {
    fetchConversationSummary.mockRejectedValue(new Error('429'));
    await fire(buildMessageEvent({ convId: 'conv-new', deliveredAt: 9000 }));
    await flush();
    expect((await testDb.conversations.get('conv-new')).category).toBe('PRIMARY_INBOX');
    expect(chrome.notifications.create).toHaveBeenCalled();
  });
});
