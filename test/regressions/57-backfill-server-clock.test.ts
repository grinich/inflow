/**
 * Regression: backfill freshness must compare server time to server time.
 *
 * `messagesSyncedAt` was recorded as local `Date.now()` when a backfill
 * completed, but the re-queue check in enqueueConversations compares it against
 * LinkedIn's server-side `lastActivityAt`. Any skew between the local clock and
 * LinkedIn's clock (or simply time passing between sync and the next discovery)
 * made new server activity look "already synced", so the conversation was never
 * re-queued and its new messages were silently skipped by backfill.
 *
 * The fix records messagesSyncedAt in server-clock terms: the max of the queue
 * item's lastActivityAt and the newest fetched message's deliveredAt.
 */
import type { VoyagerResponse } from '@/types/voyager';

import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makeConversation, makeSyncQueueItem, resetFactories } from '../fixtures/factories';

let testDb: any;
const genState = vi.hoisted(() => ({ gen: 1 }));

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
    getDbGeneration: () => genState.gen,
  };
});

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchAllMessages: vi.fn(),
}));

vi.mock('../../entrypoints/background/api/conversations', () => ({
  fetchConversationsPage: vi.fn(),
}));

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/sync/prefetch-posts', () => ({
  prefetchSharedPosts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

vi.mock('@/lib/sync-settings', () => ({
  getBackfillCutoff: vi.fn().mockResolvedValue(0),
}));

import { backfillBatch } from '../../entrypoints/background/sync/sync-backfill';
import { enqueueConversations } from '../../entrypoints/background/sync/sync-discovery';
import { fetchAllMessages } from '../../entrypoints/background/api/messages';

function buildMessagesPage(
  messages: Array<{ id: string; body: string; senderProfileId: string; deliveredAt: number }>
): VoyagerResponse {
  const included: any[] = [];
  for (const msg of messages) {
    const participantUrn = `urn:li:msg_messagingParticipant:urn:li:fsd_profile:${msg.senderProfileId}`;
    included.push({
      $type: 'com.linkedin.messenger.MessagingParticipant',
      entityUrn: participantUrn,
      hostIdentityUrn: `urn:li:fsd_profile:${msg.senderProfileId}`,
      participantType: {
        member: {
          firstName: { text: 'User' },
          lastName: { text: msg.senderProfileId },
        },
      },
    });
    included.push({
      $type: 'com.linkedin.messenger.Message',
      entityUrn: msg.id,
      body: { text: msg.body },
      deliveredAt: msg.deliveredAt,
      '*sender': participantUrn,
    });
  }
  return { data: {}, included };
}

beforeEach(async () => {
  resetFactories();
  genState.gen = 1;
  testDb = new Dexie(`TestDB_57_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('backfill records messagesSyncedAt in server-clock terms', () => {
  // Server timestamps: conversation last active 10 minutes ago (by server clock).
  const T0 = Date.now() - 10 * 60_000;

  it('sets messagesSyncedAt from server message timestamps, not the local wall clock', async () => {
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'conv-skew',
        status: 'pending',
        lastActivityAt: T0,
        priority: Number.MAX_SAFE_INTEGER - T0,
      })
    );

    vi.mocked(fetchAllMessages).mockResolvedValue([
      buildMessagesPage([
        { id: 'urn:li:msg_message:m1', body: 'hi', senderProfileId: 'OTHER', deliveredAt: T0 },
      ]),
    ]);

    await backfillBatch(5);

    const item = await testDb.syncQueue.get('conv-skew');
    expect(item.status).toBe('done');
    // Server-clock semantics: synced through T0, NOT "synced at Date.now()".
    // Allow a small margin over T0 but nothing near the 10-minute wall-clock gap.
    expect(item.messagesSyncedAt).toBeGreaterThanOrEqual(T0);
    expect(item.messagesSyncedAt).toBeLessThan(T0 + 60_000);
  });

  it('re-queues a conversation whose new server activity is older than the local clock', async () => {
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'conv-requeue',
        status: 'pending',
        lastActivityAt: T0,
        priority: Number.MAX_SAFE_INTEGER - T0,
      })
    );
    vi.mocked(fetchAllMessages).mockResolvedValue([
      buildMessagesPage([
        { id: 'urn:li:msg_message:m2', body: 'hi', senderProfileId: 'OTHER', deliveredAt: T0 },
      ]),
    ]);
    await backfillBatch(5);
    expect((await testDb.syncQueue.get('conv-requeue')).status).toBe('done');

    // A new message lands on the server one minute after T0 — which is still
    // ~9 minutes in the local clock's past. Discovery must re-queue it.
    await enqueueConversations(
      [makeConversation({ id: 'conv-requeue', lastActivityAt: T0 + 60_000 })],
      'PRIMARY_INBOX'
    );

    const item = await testDb.syncQueue.get('conv-requeue');
    expect(item.status).toBe('pending');
    expect(item.lastActivityAt).toBe(T0 + 60_000);
  });
});
