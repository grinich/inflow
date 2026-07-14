import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

let activeDb: any;
let dbA: any;
let dbB: any;

const mockFetchMessages = vi.fn();
const mockDebugLog = vi.fn();

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return activeDb;
    },
  };
});

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: mockFetchMessages,
}));

vi.mock('@/lib/debug-log', () => ({
  debugLog: mockDebugLog,
}));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  shouldSuppressConversationUpdate: vi.fn().mockReturnValue(false),
  isMutationSuppressed: vi.fn().mockReturnValue(false),
  recordMutation: vi.fn(),
  recordMarkRead: vi.fn(),
}));

vi.mock('@/lib/voyager-normalizer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/voyager-normalizer')>()),
  normalizeMessages: vi.fn().mockReturnValue([]),
}));

beforeEach(async () => {
  dbA = new Dexie(`RealtimeA_${Date.now()}_${Math.random()}`);
  dbB = new Dexie(`RealtimeB_${Date.now()}_${Math.random()}`);
  applySchema(dbA);
  applySchema(dbB);
  await dbA.open();
  await dbB.open();
  activeDb = dbA;
  mockFetchMessages.mockReset().mockResolvedValue({ data: {}, included: [] });
  mockDebugLog.mockReset();
});

afterEach(async () => {
  for (const database of [dbA, dbB]) {
    if (!database) continue;
    database.close();
    await Dexie.delete(database.name);
  }
});

function messengerMessageEvent(conversationId: string, body = 'hello') {
  const participantUrn = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:OTHER';
  return {
    'com.linkedin.realtimefrontend.DecoratedEvent': {
      topic: '/messaging',
      payload: {
        data: {
          included: [
            {
              $type: 'com.linkedin.messenger.MessagingParticipant',
              entityUrn: participantUrn,
              hostIdentityUrn: 'urn:li:fsd_profile:OTHER',
              participantType: {
                member: {
                  firstName: { text: 'Other' },
                  lastName: { text: 'Person' },
                },
              },
            },
            {
              $type: 'com.linkedin.messenger.Message',
              entityUrn: `urn:li:msg_message:${conversationId}`,
              body: { text: body },
              deliveredAt: 1234,
              '*sender': participantUrn,
              '*conversation': `urn:li:msg_conversation:(urn:li:fsd_profile:SELF,${conversationId})`,
            },
          ],
        },
      },
    },
  };
}

it('does not let an in-flight SSE handler write into the DB after an account switch', async () => {
  const { handleRealtimeEvent } = await import('../../entrypoints/background/realtime/event-handler');

  const promise = handleRealtimeEvent('event', messengerMessageEvent('conv-old-account'));
  activeDb = dbB;
  await promise;

  const newAccountMessages = await dbB.messages.toArray();

  expect(newAccountMessages).toHaveLength(0);
});

it('parses RealtimeConversation IDs containing slash characters and fetches the latest messages', async () => {
  const { handleRealtimeEvent } = await import('../../entrypoints/background/realtime/event-handler');
  const conversationId = '2-abc/def==';
  await activeDb.conversations.put(makeConversation({ id: conversationId, archived: 0 }));

  await handleRealtimeEvent('event', {
    'com.linkedin.realtimefrontend.DecoratedEvent': {
      topic: '/messaging',
      payload: {
        data: {
          included: [
            {
              $type: 'com.linkedin.voyager.messaging.realtime.RealtimeConversation',
              '*conversation': `urn:li:msg_conversation:(urn:li:fsd_profile:SELF,${conversationId})`,
            },
          ],
        },
      },
    },
  });

  expect(mockFetchMessages).toHaveBeenCalledWith(conversationId, 20, 0, { skipJitter: true });
});

it('redacts private message bodies from realtime debug logs', async () => {
  const { handleRealtimeEvent } = await import('../../entrypoints/background/realtime/event-handler');
  const secret = 'super secret payroll note';

  await handleRealtimeEvent('event', {
    'com.linkedin.realtimefrontend.DecoratedEvent': {
      topic: '/messaging',
      payload: {
        data: {
          value: {},
          included: [
            {
              $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
              entityUrn: 'urn:li:fs_miniProfile:OTHER',
              firstName: 'Other',
              lastName: 'Person',
            },
            {
              $type: 'com.linkedin.voyager.messaging.MessagingMember',
              entityUrn: 'urn:li:messagingMember:OTHER',
              '*miniProfile': 'urn:li:fs_miniProfile:OTHER',
            },
            {
              $type: 'com.linkedin.voyager.messaging.Event',
              entityUrn: 'urn:li:fs_event:(conv-log,event-1)',
              dashEntityUrn: 'urn:li:fsd_message:event-1',
              createdAt: 1234,
              '*from': 'urn:li:messagingMember:OTHER',
              eventContent: { body: secret },
            },
          ],
        },
      },
    },
  });

  const allLoggedText = mockDebugLog.mock.calls.map((call) => call.join(' ')).join('\n');
  expect(allLoggedText).not.toContain(secret);
});
