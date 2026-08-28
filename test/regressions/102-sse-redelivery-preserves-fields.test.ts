/**
 * Regression: SSE re-deliveries and the RealtimeConversation-triggered refetch
 * replaced stored message rows wholesale, wiping fields the incoming payload
 * doesn't carry.
 *
 * LinkedIn re-delivers the full Message entity when it's edited or reacted to.
 * Those echoes never carry seenAt (receipts arrive as separate SeenReceipt
 * events) and often omit renderContent (reply quotes, attachments). The batch
 * handlers built a fresh row from the echo and bulkPut it — a full replace —
 * so someone reacting to a message would silently wipe its ✓✓ read receipt,
 * reply quote, or attachment.
 *
 * Likewise _doFetchLatest (the per-conversation refetch that runs on
 * RealtimeConversation events) bulkPut normalizeMessages output raw, without
 * the preserveSseFields carry-over that the FETCH_MESSAGES and backfill paths
 * both apply — wiping seenAt/reactions/editedAt on every echo-triggered
 * refetch.
 *
 * Reactions on re-delivered entities are NOT preserved by design: the echo's
 * reactionSummaries (or their absence) IS the payload of a reaction change,
 * and preserving them would break cross-client reaction removal.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Message } from '@/types/message';
import type { Conversation } from '@/types/conversation';
import { buildMessagesPageResponse } from '../fixtures/voyager-responses';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return { ...original, get db() { return testDb; } };
});

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

const fetchMessages = vi.fn();
vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: (...args: any[]) => fetchMessages(...args),
}));
vi.mock('../../entrypoints/background/sync/sync-engine', () => ({ syncConversations: vi.fn() }));
vi.mock('../../entrypoints/background/sync/reconcile-messages', () => ({ reconcileRecalledMessages: vi.fn() }));
vi.mock('../../entrypoints/background/sync/repair-participants', () => ({ repairConversationParticipants: vi.fn() }));
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
const CONV_ID = '2-fields';
const CONV_URN = `urn:li:msg_conversation:(${MEMBER_URN},${CONV_ID})`;
const MSG_URN = 'urn:li:msg_message:(2-fields,1)';

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

function makeStoredMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: MSG_URN,
    conversationId: CONV_ID,
    senderUrn: MEMBER_URN,
    senderName: 'You',
    senderPicture: '',
    body: 'hello',
    createdAt: 1000,
    isFromMe: true,
    ...overrides,
  };
}

/** DecoratedEvent wrapping a com.linkedin.messenger.Message re-delivery. */
function buildRedeliveryEvent(entity: Record<string, any>): { eventType: string; data: any } {
  const participantUrn = `urn:li:msg_messagingParticipant:${MEMBER_URN}`;
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
                hostIdentityUrn: MEMBER_URN,
                participantType: { member: { firstName: { text: 'Me' }, lastName: { text: '' } } },
              },
              {
                $type: 'com.linkedin.messenger.Message',
                entityUrn: MSG_URN,
                body: { text: 'hello' },
                deliveredAt: 1000,
                '*sender': participantUrn,
                '*conversation': CONV_URN,
                ...entity,
              },
            ],
          },
        },
      },
    },
  };
}

/** Dispatch an old-format RealtimeConversation event (triggers _doFetchLatest). */
function fireConversationUpdate(): Promise<void> {
  return handleRealtimeEvent('event', {
    'com.linkedin.realtimefrontend.DecoratedEvent': {
      topic: 'urn:li-realtime:conversationsTopic:urn:li-realtime:myself',
      payload: {
        data: {
          included: [
            {
              $type: 'com.linkedin.voyager.messaging.realtime.RealtimeConversation',
              entityUrn: CONV_URN,
              action: 'UPDATE',
              unreadConversationsCount: 0,
            },
          ],
        },
      },
    },
  });
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_102_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  fetchMessages.mockReset();
  fetchMessages.mockResolvedValue({ data: {}, included: [] });
  __resetInboundReadState();
});

afterEach(async () => {
  __resetInboundReadState();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('SSE re-delivery of an existing message preserves stored fields', () => {
  it('a reaction echo keeps seenAt while applying the reaction', async () => {
    await testDb.conversations.put(makeConversation());
    await testDb.messages.put(makeStoredMessage({ seenAt: 5000 }));

    const ev = buildRedeliveryEvent({
      reactionSummaries: [{ emoji: '👍', count: 1, firstReactedAt: 6000, viewerReacted: false }],
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    const stored = await testDb.messages.get(MSG_URN);
    expect(stored.reactions).toEqual([
      { emoji: '👍', count: 1, firstReactedAt: 6000, viewerReacted: false },
    ]);
    expect(stored.seenAt).toBe(5000);
  });

  it('an edit echo without renderContent keeps the reply quote and attachments', async () => {
    await testDb.conversations.put(makeConversation());
    await testDb.messages.put(makeStoredMessage({
      repliedMessage: { senderName: 'Other User', body: 'original quoted text' },
      attachments: [{ type: 'image', imageUrl: 'https://cdn/img.jpg' }],
    }));

    const ev = buildRedeliveryEvent({ body: { text: 'hello (edited)' }, editedAt: 4000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    const stored = await testDb.messages.get(MSG_URN);
    expect(stored.body).toBe('hello (edited)');
    expect(stored.editedAt).toBe(4000);
    expect(stored.repliedMessage).toEqual({ senderName: 'Other User', body: 'original quoted text' });
    expect(stored.attachments).toEqual([{ type: 'image', imageUrl: 'https://cdn/img.jpg' }]);
  });

  it('a reaction-removal echo (no reactionSummaries) still clears reactions but keeps seenAt', async () => {
    await testDb.conversations.put(makeConversation());
    await testDb.messages.put(makeStoredMessage({
      seenAt: 5000,
      reactions: [{ emoji: '👍', count: 1, firstReactedAt: 6000, viewerReacted: false }],
    }));

    const ev = buildRedeliveryEvent({});
    await handleRealtimeEvent(ev.eventType, ev.data);

    const stored = await testDb.messages.get(MSG_URN);
    expect(stored.reactions ?? []).toEqual([]);
    expect(stored.seenAt).toBe(5000);
  });

  it('a re-delivery with an unchanged body keeps extracted mentions', async () => {
    await testDb.conversations.put(makeConversation());
    await testDb.messages.put(makeStoredMessage({
      mentions: [{ start: 0, length: 5, urn: 'urn:li:fsd_profile:OTHER' }],
    }));

    // Echo carries the same text but no attributes (shape variance).
    const ev = buildRedeliveryEvent({
      reactionSummaries: [{ emoji: '🎉', count: 1, firstReactedAt: 6000, viewerReacted: false }],
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    const stored = await testDb.messages.get(MSG_URN);
    expect(stored.mentions).toEqual([{ start: 0, length: 5, urn: 'urn:li:fsd_profile:OTHER' }]);
  });
});

describe('_doFetchLatest preserves SSE-only fields on refetch', () => {
  it('keeps seenAt/reactions/editedAt when the pagination API omits them', async () => {
    await testDb.conversations.put(makeConversation());
    await testDb.messages.put(makeStoredMessage({
      seenAt: 5000,
      editedAt: 4000,
      reactions: [{ emoji: '👍', count: 1, firstReactedAt: 6000, viewerReacted: false }],
    }));

    // The refetch returns the same canonical message with none of the
    // SSE-only fields (the messenger pagination API doesn't serve them).
    const page = buildMessagesPageResponse(CONV_ID, [
      { id: MSG_URN, senderProfileId: 'SELF', senderName: 'Me', body: 'hello', createdAt: 1000 },
    ]);
    fetchMessages.mockResolvedValue(page);

    await fireConversationUpdate();

    const stored = await testDb.messages.get(MSG_URN);
    expect(stored.seenAt).toBe(5000);
    expect(stored.editedAt).toBe(4000);
    expect(stored.reactions).toEqual([
      { emoji: '👍', count: 1, firstReactedAt: 6000, viewerReacted: false },
    ]);
  });
});
