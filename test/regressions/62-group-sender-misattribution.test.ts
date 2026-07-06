/**
 * Regression: inbound messages from unknown-but-valid senders were claimed as
 * our own.
 *
 * resolveSelfSender treated any sender it couldn't resolve from the event
 * payload — and that wasn't in the conversation's stored participantUrns — as
 * the viewer's own outbound echo. In group conversations with incomplete
 * participant lists (or any conversation awaiting participant repair) a genuine
 * inbound message rendered as "You", produced no unread flag, and had its
 * senderUrn rewritten to the member URN (breaking dedup against the canonical
 * copy → permanent duplicate).
 *
 * Fix: a sender whose reference resolves to a VALID fsd_profile URN is trusted
 * as inbound even when the participant entity is omitted and the URN isn't in
 * participantUrns. Only truly unresolvable (invalid/garbage URN) senders fall
 * back to the omitted-self heuristic.
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

import { handleRealtimeEvent } from '../../entrypoints/background/realtime/event-handler';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '2-group',
    participantUrns: ['urn:li:fsd_profile:KNOWN'],
    participantNames: ['Known Person'],
    participantPictures: [''],
    lastMessage: 'hi',
    lastActivityAt: 1000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

/** A Message event whose sender participant entity is OMITTED from included[]. */
function buildUnresolvedSenderEvent(msg: {
  entityUrn: string;
  convId: string;
  senderRef: string;
  body: string;
  deliveredAt: number;
}) {
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: {
          data: {
            included: [
              {
                $type: 'com.linkedin.messenger.Message',
                entityUrn: msg.entityUrn,
                body: { text: msg.body },
                deliveredAt: msg.deliveredAt,
                '*sender': msg.senderRef,
                '*conversation': `urn:li:msg_conversation:(${MEMBER_URN},${msg.convId})`,
              },
            ],
          },
        },
      },
    },
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_62_${Date.now()}_${Math.random()}`);
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

describe('unresolved sender with a valid profile URN', () => {
  it('keeps the message inbound (group member not yet in participantUrns)', async () => {
    await testDb.conversations.put(makeConversation());

    const ev = buildUnresolvedSenderEvent({
      entityUrn: 'urn:li:msg_message:FROM_STRANGER',
      convId: '2-group',
      // Participant entity omitted, but the ref itself carries a valid profile URN.
      senderRef: 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:STRANGER',
      body: 'hello from a group member you have not stored',
      deliveredAt: 9000,
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    const msg = await testDb.messages.get('urn:li:msg_message:FROM_STRANGER');
    expect(msg).toBeDefined();
    expect(msg.isFromMe).toBe(false);
    // The real sender URN must be preserved so dedup against the canonical
    // fetched copy (same senderUrn + deliveredAt) still works.
    expect(msg.senderUrn).toBe('urn:li:fsd_profile:STRANGER');

    // Inbound message → conversation goes unread.
    expect((await testDb.conversations.get('2-group')).read).toBe(0);
  });

  it('still treats our own sender reference as self', async () => {
    await testDb.conversations.put(makeConversation({ id: '2-own-echo' }));

    const ev = buildUnresolvedSenderEvent({
      entityUrn: 'urn:li:msg_message:MY_ECHO',
      convId: '2-own-echo',
      senderRef: 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:SELF',
      body: 'sent from another device',
      deliveredAt: 9000,
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    const msg = await testDb.messages.get('urn:li:msg_message:MY_ECHO');
    expect(msg.isFromMe).toBe(true);
    expect(msg.senderUrn).toBe(MEMBER_URN);
    expect((await testDb.conversations.get('2-own-echo')).read).toBe(1);
  });

  it('still treats a garbage (unparseable) sender as the omitted-self echo', async () => {
    const ev = buildUnresolvedSenderEvent({
      entityUrn: 'urn:li:msg_message:GARBAGE_SENDER',
      convId: '2-garbage',
      // No fsd_profile anywhere in the ref — cannot identify the sender.
      senderRef: 'urn:li:msg_messagingParticipant:(2-garbage,OPAQUE)',
      body: 'first message to a new contact',
      deliveredAt: 9000,
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    const msg = await testDb.messages.get('urn:li:msg_message:GARBAGE_SENDER');
    expect(msg.isFromMe).toBe(true);
    expect(msg.senderUrn).toBe(MEMBER_URN);
  });
});
