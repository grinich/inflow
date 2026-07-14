/**
 * Inbound read/unread sync (coverage fix): a read/unread toggle made on another
 * device arrives as a RealtimeConversation SSE event that carries no read flag,
 * and the focused-inbox reconcile poll only covers PRIMARY_INBOX top-20 — so a
 * toggle on a secondary/archived or lower-ranked thread never reflected.
 *
 * Fix: the per-conversation message refetch (which runs on every event) reads
 * the authoritative `read` flag from the parent Conversation entity LinkedIn
 * decorates into the messages response, and applies it — for ANY conversation.
 * A pending optimistic action or mark-read suppression blocks it so our own
 * optimistic state isn't clobbered.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
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
const suppressState = { pending: false, mutation: false, echo: false };
vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  shouldSuppressConversationUpdate: () => suppressState.echo,
  isMutationSuppressed: () => suppressState.mutation,
  recordMutation: vi.fn(),
  recordMarkRead: vi.fn(),
}));
vi.mock('../../entrypoints/background/sync/pending-guard', () => ({
  hasPendingAction: () => Promise.resolve(suppressState.pending),
}));

import {
  handleRealtimeEvent,
  __resetInboundReadState,
} from '../../entrypoints/background/realtime/event-handler';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

/** A messages response whose parent Conversation entity carries `read`. The lone
 *  message is from SELF so it isn't treated as a new inbound (which would force
 *  unread) — isolating the pure read/unread-toggle path. */
function messagesResponseWithRead(convId: string, read: boolean) {
  const page = buildMessagesPageResponse(convId, [
    { senderProfileId: 'SELF', senderName: 'Me', body: 'hello', createdAt: 1000 },
  ]);
  page.included.push({
    $type: 'com.linkedin.messenger.Conversation',
    entityUrn: `urn:li:msg_conversation:(${MEMBER_URN},${convId})`,
    read,
    unreadCount: read ? 0 : 1,
  });
  return page;
}

/** Dispatch an old-format RealtimeConversation event for a conversation. */
function fire(convId: string): Promise<void> {
  return handleRealtimeEvent('event', {
    'com.linkedin.realtimefrontend.DecoratedEvent': {
      topic: 'urn:li-realtime:conversationsTopic:urn:li-realtime:myself',
      payload: {
        data: {
          included: [
            { $type: 'com.linkedin.voyager.messaging.MessagingMember', entityUrn: 'urn:li:msg_messagingMember:x' },
            {
              $type: 'com.linkedin.voyager.messaging.realtime.RealtimeConversation',
              entityUrn: `urn:li:msg_conversation:(${MEMBER_URN},${convId})`,
              action: 'UPDATE',
              unreadConversationsCount: 1,
            },
          ],
        },
      },
    },
  });
}

function seedConv(id: string, read: number, category = 'SECONDARY_INBOX') {
  return testDb.conversations.put({
    id, participantUrns: [], participantNames: [], participantPictures: [],
    lastMessage: 'x', lastActivityAt: 2000, read, archived: 0, category,
    hasAttachments: 0, starred: 0,
  });
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_89_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  suppressState.pending = false;
  suppressState.mutation = false;
  suppressState.echo = false;
  fetchMessages.mockReset();
  __resetInboundReadState();
});

afterEach(async () => {
  __resetInboundReadState();
  if (testDb) { testDb.close(); await Dexie.delete(testDb.name); }
});

describe('per-conversation inbound read reconcile', () => {
  it('flips a read thread to unread from the server flag (secondary inbox)', async () => {
    await seedConv('2-x', 1, 'SECONDARY_INBOX');
    fetchMessages.mockResolvedValue(messagesResponseWithRead('2-x', false));

    await fire('2-x');
    await vi.waitFor(async () => {
      expect((await testDb.conversations.get('2-x')).read).toBe(0);
    });
  });

  it('flips an unread thread to read from the server flag (cross-device read)', async () => {
    await seedConv('2-y', 0, 'SECONDARY_INBOX');
    fetchMessages.mockResolvedValue(messagesResponseWithRead('2-y', true));

    await fire('2-y');
    await vi.waitFor(async () => {
      expect((await testDb.conversations.get('2-y')).read).toBe(1);
    });
  });

  it('does not clobber optimistic state while a mutation is suppressed', async () => {
    suppressState.mutation = true;
    await seedConv('2-z', 1, 'SECONDARY_INBOX');
    fetchMessages.mockResolvedValue(messagesResponseWithRead('2-z', false));

    await fire('2-z');
    // Give the fire-and-forget fetch time to complete.
    await new Promise((r) => setTimeout(r, 50));
    expect((await testDb.conversations.get('2-z')).read).toBe(1);
  });

  it('does not apply read state while a pending action is in flight', async () => {
    suppressState.pending = true;
    await seedConv('2-p', 1, 'SECONDARY_INBOX');
    fetchMessages.mockResolvedValue(messagesResponseWithRead('2-p', false));

    await fire('2-p');
    await new Promise((r) => setTimeout(r, 50));
    expect((await testDb.conversations.get('2-p')).read).toBe(1);
  });
});
