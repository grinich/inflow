/**
 * Regression: a stale Dash conversation-update echo could flip a genuinely
 * unread conversation back to read.
 *
 * handleDashConversationUpdate applied the entity's `read` flag guarded only
 * by the suppression windows — with no freshness check. A delayed read=true
 * echo describing the conversation BEFORE its newest message (delivered while
 * the echo was queued/in flight) marked the conversation read and hid the new
 * message's unread indicator.
 *
 * Fix: when the Dash entity carries lastActivityAt, an entity older than local
 * state is ignored — same staleness rule as mergeConversation.
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

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: '2-dash',
    participantUrns: ['urn:li:fsd_profile:OTHER'],
    participantNames: ['Other User'],
    participantPictures: [''],
    lastMessage: 'newest inbound',
    lastActivityAt: 5000,
    read: 0,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
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
                entityUrn: `urn:li:msg_conversation:(${MEMBER_URN},2-dash)`,
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
  testDb = new Dexie(`TestDB_75_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('handleDashConversationUpdate staleness', () => {
  it('ignores a read=true echo older than the local conversation state', async () => {
    // A new message just arrived (unread, lastActivityAt 5000); a delayed echo
    // from BEFORE that message (lastActivityAt 3000) says read=true.
    await testDb.conversations.put(makeConversation({ read: 0, lastActivityAt: 5000 }));

    const ev = buildDashConversationEvent({ read: true, lastActivityAt: 3000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get('2-dash')).read).toBe(0);
  });

  it('applies read=true from an equally-fresh entity (cross-device read)', async () => {
    await testDb.conversations.put(makeConversation({ read: 0, lastActivityAt: 5000 }));

    const ev = buildDashConversationEvent({ read: true, lastActivityAt: 5000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get('2-dash')).read).toBe(1);
  });

  it('applies read state when the entity carries no lastActivityAt (unknown freshness)', async () => {
    await testDb.conversations.put(makeConversation({ read: 0, lastActivityAt: 5000 }));

    const ev = buildDashConversationEvent({ read: true });
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get('2-dash')).read).toBe(1);
  });
});
