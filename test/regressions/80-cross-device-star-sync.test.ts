/**
 * Cross-device star/unstar sync via RealtimeConversation events.
 *
 * Captured live: starring/unstarring a conversation on the LinkedIn website
 * delivers an old-format RealtimeConversation entity with a top-level boolean:
 *
 *   entity={"*conversation":"urn:li:fs_conversation:2-...","starred":true,
 *           "unreadConversationsCount":3,"action":"UPDATE",...}
 *
 * Unlike category-filtered pages (which unreliably omit the STARRED overlay —
 * hence the merge's never-downgrade rule), this is an authoritative
 * per-conversation signal, so BOTH directions apply: star and unstar.
 * Our own optimistic star actions are protected by the usual pending-action
 * and mutation-suppression guards.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makeConversation, makePendingAction } from '../fixtures/factories';

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

vi.mock('@/lib/voyager-normalizer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/voyager-normalizer')>()),
  normalizeMessages: vi.fn().mockReturnValue([]),
}));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  shouldSuppressConversationUpdate: vi.fn().mockReturnValue(false),
  isMutationSuppressed: vi.fn().mockReturnValue(false),
  recordMutation: vi.fn(),
  recordMarkRead: vi.fn(),
}));

import { handleRealtimeEvent } from '../../entrypoints/background/realtime/event-handler';
import { isMutationSuppressed } from '../../entrypoints/background/realtime/mark-read-suppression';

const CONV_ID = '2-star-conv';

/** RealtimeConversation event shaped like the captured live payload. */
function buildStarEvent(starred: boolean) {
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: 'urn:li-realtime:conversationsTopic:urn:li-realtime:myself',
        payload: {
          data: {
            included: [
              {
                $type: 'com.linkedin.voyager.messaging.realtime.RealtimeConversation',
                '*conversation': `urn:li:fs_conversation:${CONV_ID}`,
                entityUrn: `urn:li:fs_conversation:${CONV_ID}`,
                starred,
                unreadConversationsCount: 3,
                action: 'UPDATE',
              },
            ],
          },
        },
      },
    },
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_80_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  vi.mocked(isMutationSuppressed).mockReturnValue(false);
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('cross-device star sync', () => {
  it('applies a star from another client', async () => {
    await testDb.conversations.put(makeConversation({ id: CONV_ID, starred: 0 }));

    const ev = buildStarEvent(true);
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).starred).toBe(1);
  });

  it('applies an UNSTAR from another client (the one-way merge rule does not apply here)', async () => {
    await testDb.conversations.put(makeConversation({ id: CONV_ID, starred: 1 }));

    const ev = buildStarEvent(false);
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).starred).toBe(0);
  });

  it('applies star changes to archived conversations too', async () => {
    await testDb.conversations.put(
      makeConversation({ id: CONV_ID, starred: 0, archived: 1, category: 'ARCHIVE' })
    );

    const ev = buildStarEvent(true);
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).starred).toBe(1);
  });

  it('does not fight our own optimistic star during the suppression window', async () => {
    vi.mocked(isMutationSuppressed).mockReturnValue(true);
    await testDb.conversations.put(makeConversation({ id: CONV_ID, starred: 1 }));

    // Stale echo of our own toggle says unstarred.
    const ev = buildStarEvent(false);
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).starred).toBe(1);
  });

  it('does not fight an in-flight optimistic star action', async () => {
    await testDb.conversations.put(makeConversation({ id: CONV_ID, starred: 1 }));
    await testDb.pendingActions.put(
      makePendingAction({ conversationId: CONV_ID, type: 'star', status: 'pending' })
    );

    const ev = buildStarEvent(false);
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).starred).toBe(1);
  });

  it('is a no-op for unknown conversations', async () => {
    const ev = buildStarEvent(true);
    await handleRealtimeEvent(ev.eventType, ev.data);
    expect(await testDb.conversations.count()).toBe(0);
  });
});
