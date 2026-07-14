/**
 * Regression: unsend/recall SSE events were misclassified as typing indicators
 * and dropped.
 *
 * Captured from a live session: when the other party unsends a message,
 * LinkedIn delivers a Voyager messaging.Event whose eventContent is a
 * MessageEvent with `recalledAt` set and an empty body:
 *
 *   [RT] Typing indicator (Voyager): conv=2-MThkM2QwNzkt...
 *        ecType=com.linkedin.voyager.messaging.event.MessageEvent
 *        keys=recalledAt,messageBodyRenderFormat,body,attributedBody,$type
 *
 * The empty-body check treated it as a typing indicator, so the recalled
 * message only disappeared if some later fetch happened to reconcile it.
 *
 * Fix: recalledAt events delete the stored message immediately — by SSE id,
 * and by sender+timestamp for the canonical copy — and rewind the conversation
 * preview when the recalled message was the latest.
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

const CONV_ID = '2-recall-conv';
const SENDER_PROFILE = 'OTHERPERSON';
const SENDER_URN = `urn:li:fsd_profile:${SENDER_PROFILE}`;

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONV_ID,
    participantUrns: [SENDER_URN],
    participantNames: ['Other Person'],
    participantPictures: [''],
    lastMessage: 'now you see me',
    lastActivityAt: 5000,
    read: 0,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

/** Voyager recall event, shaped like the captured live payload. */
function buildRecallEvent(opts: { createdAt: number; msgId?: string }) {
  const memberUrn = `urn:li:fs_messagingMember:(${CONV_ID},${SENDER_PROFILE})`;
  const miniProfileUrn = `urn:li:fs_miniProfile:${SENDER_PROFILE}`;
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: 'urn:li-realtime:messagesTopic:urn:li-realtime:myself',
        payload: {
          data: {
            included: [
              {
                $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
                entityUrn: miniProfileUrn,
                firstName: 'Other',
                lastName: 'Person',
              },
              {
                $type: 'com.linkedin.voyager.messaging.MessagingMember',
                entityUrn: memberUrn,
                '*miniProfile': miniProfileUrn,
              },
              {
                $type: 'com.linkedin.voyager.messaging.Event',
                entityUrn: `urn:li:fs_event:(${CONV_ID},${opts.msgId || '2-msg-recalled'})`,
                dashEntityUrn: `urn:li:fsd_message:${opts.msgId || '2-msg-recalled'}`,
                createdAt: opts.createdAt,
                '*from': memberUrn,
                eventContent: {
                  $type: 'com.linkedin.voyager.messaging.event.MessageEvent',
                  recalledAt: opts.createdAt + 60_000,
                  messageBodyRenderFormat: 'RECALLED',
                  body: '',
                  attributedBody: { text: '' },
                },
              },
            ],
          },
        },
      },
    },
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_77_${Date.now()}_${Math.random()}`);
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

describe('live recall (unsend) events', () => {
  it('deletes the stored canonical copy by sender+timestamp and rewinds the preview', async () => {
    await testDb.conversations.put(makeConversation());
    await testDb.messages.bulkPut([
      {
        id: 'urn:li:msg_message:earlier',
        conversationId: CONV_ID,
        senderUrn: SENDER_URN,
        senderName: 'Other Person',
        senderPicture: '',
        body: 'an earlier message',
        createdAt: 3000,
        isFromMe: false,
      },
      {
        // Canonical copy of the message being recalled (fetched via REST, so
        // its id does NOT match the recall event's fs/fsd ids).
        id: 'urn:li:msg_message:latest',
        conversationId: CONV_ID,
        senderUrn: SENDER_URN,
        senderName: 'Other Person',
        senderPicture: '',
        body: 'now you see me',
        createdAt: 5000,
        isFromMe: false,
      },
    ]);

    const ev = buildRecallEvent({ createdAt: 5000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect(await testDb.messages.get('urn:li:msg_message:latest')).toBeUndefined();
    expect(await testDb.messages.get('urn:li:msg_message:earlier')).toBeDefined();
    // Preview rewound to the newest remaining message.
    const conv = await testDb.conversations.get(CONV_ID);
    expect(conv.lastMessage).toBe('an earlier message');
  });

  it('deletes an SSE-format copy by its event id', async () => {
    await testDb.conversations.put(makeConversation());
    await testDb.messages.put({
      id: 'urn:li:fsd_message:2-msg-recalled',
      conversationId: CONV_ID,
      senderUrn: SENDER_URN,
      senderName: 'Other Person',
      senderPicture: '',
      body: 'now you see me',
      // Fabricated local timestamp — id matching must not depend on createdAt.
      createdAt: 9999,
      isFromMe: false,
    });

    const ev = buildRecallEvent({ createdAt: 5000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect(await testDb.messages.get('urn:li:fsd_message:2-msg-recalled')).toBeUndefined();
  });

  it('does not delete a different sender\'s message with the same timestamp', async () => {
    await testDb.conversations.put(makeConversation());
    await testDb.messages.put({
      id: 'urn:li:msg_message:same-ms',
      conversationId: CONV_ID,
      senderUrn: 'urn:li:fsd_profile:SOMEONE_ELSE',
      senderName: 'Someone Else',
      senderPicture: '',
      body: 'coincidentally simultaneous',
      createdAt: 5000,
      isFromMe: false,
    });

    const ev = buildRecallEvent({ createdAt: 5000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect(await testDb.messages.get('urn:li:msg_message:same-ms')).toBeDefined();
  });

  it('is a no-op for an unknown conversation (no minimal conversation created)', async () => {
    const ev = buildRecallEvent({ createdAt: 5000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect(await testDb.conversations.count()).toBe(0);
    expect(await testDb.messages.count()).toBe(0);
  });
});
