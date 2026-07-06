import Dexie from 'dexie';
import { applySchema, type SyncQueueItem } from '@/db/database';
import type { Message } from '@/types/message';
import type { VoyagerResponse } from '@/types/voyager';

// ── Test DB setup ────────────────────────────────────────────────────────────
let testDb: any;

// Controllable DB generation so tests can simulate an account switch
// (switchDatabase) completing while a network fetch is in flight.
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

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/sync/prefetch-posts', () => ({
  prefetchSharedPosts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
}));

// Use real normalizeMessages implementation
// vi.mock is not needed for voyager-normalizer — we let it resolve normally

beforeEach(async () => {
  genState.gen = 1;
  testDb = new Dexie(`TestDB_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

function makeSyncQueueItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    conversationId: 'conv-001',
    category: 'PRIMARY_INBOX',
    lastActivityAt: Date.now(),
    messagesSyncedAt: 0,
    status: 'pending',
    failCount: 0,
    lastFailedAt: 0,
    priority: Number.MAX_SAFE_INTEGER - Date.now(),
    ...overrides,
  };
}

/**
 * Build a Voyager response page containing Message entities.
 * Each message entry gets the correct $type and entityUrn.
 */
function buildMessagesPage(
  messages: Array<{
    id: string;
    body: string;
    senderProfileId: string;
    deliveredAt: number;
    attachments?: boolean;
  }>
): VoyagerResponse {
  const included: any[] = [];

  for (const msg of messages) {
    // Add a participant entity for the sender
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

    const renderContent = msg.attachments
      ? [{ file: { name: 'doc.pdf', url: 'https://example.com/doc.pdf', byteSize: 1234 } }]
      : undefined;

    included.push({
      $type: 'com.linkedin.messenger.Message',
      entityUrn: msg.id,
      body: { text: msg.body },
      deliveredAt: msg.deliveredAt,
      '*sender': participantUrn,
      ...(renderContent ? { renderContent } : {}),
    });
  }

  return { data: {}, included };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('sync-backfill', () => {
  describe('backfillBatch', () => {
    it('returns 0 when no pending items', async () => {
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      const result = await backfillBatch(5);
      expect(result).toBe(0);
    });

    it('fetches pending items ordered by priority (newest first)', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      const mockedFetch = vi.mocked(fetchAllMessages);

      // Insert items with different priorities (lower priority = newer conversation)
      const now = Date.now();
      await testDb.syncQueue.bulkPut([
        makeSyncQueueItem({
          conversationId: 'conv-old',
          priority: Number.MAX_SAFE_INTEGER - (now - 100_000), // older = higher priority value
        }),
        makeSyncQueueItem({
          conversationId: 'conv-new',
          priority: Number.MAX_SAFE_INTEGER - now, // newer = lower priority value
        }),
      ]);

      // Track the order of fetchAllMessages calls
      const fetchOrder: string[] = [];
      mockedFetch.mockImplementation(async (convId: string) => {
        fetchOrder.push(convId);
        return [buildMessagesPage([])];
      });

      await backfillBatch(10);

      // Lower priority number comes first in ascending order
      expect(fetchOrder[0]).toBe('conv-new');
      expect(fetchOrder[1]).toBe('conv-old');
    });

    it('marks items as syncing before API call (crash recovery marker)', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'conv-crash' }));

      let statusDuringFetch: string | undefined;
      vi.mocked(fetchAllMessages).mockImplementation(async () => {
        const item = await testDb.syncQueue.get('conv-crash');
        statusDuringFetch = item?.status;
        return [buildMessagesPage([])];
      });

      await backfillBatch(1);

      expect(statusDuringFetch).toBe('syncing');
    });

    it('fetches messages and stores to DB', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'conv-store' }));

      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          { id: 'urn:li:msg_message:001', body: 'Hello', senderProfileId: 'Alice', deliveredAt: 1000 },
          { id: 'urn:li:msg_message:002', body: 'World', senderProfileId: 'Bob', deliveredAt: 2000 },
        ]),
      ]);

      await backfillBatch(1);

      const storedMessages = await testDb.messages
        .where('conversationId')
        .equals('conv-store')
        .toArray();
      expect(storedMessages).toHaveLength(2);
      expect(storedMessages.map((m: Message) => m.body).sort()).toEqual(['Hello', 'World']);
    });

    // Regression: the bulkGet (SSE-field preservation) → bulkPut pair ran
    // outside a transaction, so an SSE edit landing between them was
    // overwritten with the stale preserved value. Both the preserve+put and
    // the dedup must each run in their own rw transaction on messages.
    it('runs preserve+put and dedup each inside a rw transaction', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'conv-tx' }));
      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          { id: 'urn:li:msg_message:tx1', body: 'Hello', senderProfileId: 'Alice', deliveredAt: 1000 },
        ]),
      ]);

      const txSpy = vi.spyOn(testDb, 'transaction');
      await backfillBatch(1);

      const rwMessageTxCount = txSpy.mock.calls.filter(
        (c: any[]) => c[0] === 'rw' && c[1] === testDb.messages
      ).length;
      expect(rwMessageTxCount).toBeGreaterThanOrEqual(2);
    });

    // Regression: `db` is a live binding rebound by switchDatabase. The
    // generation was only checked at the top of each loop iteration, but
    // fetchAllMessages is a long multi-page network await — if the account
    // switch completed mid-fetch, every subsequent write (messages bulkPut,
    // conversations/syncQueue updates) landed in the NEW account's database.
    it('does not write into the new account DB when the account switches mid-fetch', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'conv-switch' }));

      vi.mocked(fetchAllMessages).mockImplementation(async () => {
        genState.gen++; // switchDatabase completes while the fetch is in flight
        return [
          buildMessagesPage([
            { id: 'urn:li:msg_message:sw1', body: 'Old account msg', senderProfileId: 'Alice', deliveredAt: 1000 },
          ]),
        ];
      });

      await backfillBatch(1);

      // Nothing from the old account may be written through the rebound db
      expect(await testDb.messages.count()).toBe(0);
      const item = await testDb.syncQueue.get('conv-switch');
      expect(item.status).not.toBe('done');
    });

    it('sets isFromMe=true for messages from the authenticated user', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'conv-me' }));

      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          { id: 'urn:li:msg_message:from-me', body: 'I sent this', senderProfileId: 'SELF', deliveredAt: 1000 },
          { id: 'urn:li:msg_message:from-other', body: 'They sent this', senderProfileId: 'OTHER', deliveredAt: 2000 },
        ]),
      ]);

      await backfillBatch(1);

      const mine = await testDb.messages.get('urn:li:msg_message:from-me');
      const other = await testDb.messages.get('urn:li:msg_message:from-other');
      expect(mine.isFromMe).toBe(true);
      expect(other.isFromMe).toBe(false);
    });

    it('updates hasAttachments flag when messages have attachments', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      // Pre-insert a conversation record so the update works
      await testDb.conversations.put({
        id: 'conv-attach',
        participantUrns: [],
        participantNames: [],
        participantPictures: [],
        lastMessage: '',
        lastActivityAt: Date.now(),
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
        hasAttachments: 0,
      });
      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'conv-attach' }));

      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          { id: 'urn:li:msg_message:att1', body: 'See attached', senderProfileId: 'Alice', deliveredAt: 1000, attachments: true },
        ]),
      ]);

      await backfillBatch(1);

      const conv = await testDb.conversations.get('conv-attach');
      expect(conv.hasAttachments).toBe(1);
    });

    it('cleans up SSE duplicates when canonical replacement exists', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      const convId = 'conv-sse-dup';
      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: convId }));

      // Pre-insert an SSE message that should be replaced by the canonical version
      const sseMessage: Message = {
        id: 'urn:li:fsd_message:SSE_X',
        conversationId: convId,
        senderUrn: 'urn:li:fsd_profile:Alice',
        senderName: 'User Alice',
        senderPicture: '',
        body: 'Hello there',
        createdAt: 5000,
        isFromMe: false,
      };
      await testDb.messages.put(sseMessage);

      // The backfill fetches the canonical version with same body+sender+createdAt
      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          {
            id: 'urn:li:msg_message:CANONICAL_Y',
            body: 'Hello there',
            senderProfileId: 'Alice',
            deliveredAt: 5000,
          },
        ]),
      ]);

      await backfillBatch(1);

      // The SSE message should be deleted
      const sseMsg = await testDb.messages.get('urn:li:fsd_message:SSE_X');
      expect(sseMsg).toBeUndefined();

      // The canonical message should remain
      const canonicalMsg = await testDb.messages.get('urn:li:msg_message:CANONICAL_Y');
      expect(canonicalMsg).toBeDefined();
      expect(canonicalMsg.body).toBe('Hello there');
    });

    // Regression: an edited inbound message showed twice because dedup keyed on
    // body, which diverges after an edit. With the stable senderUrn|createdAt
    // key the SSE-edited row collapses onto the canonical row, and the edited
    // body is folded on so it isn't lost when the SSE row is deleted.
    it('collapses an edited SSE message onto its canonical twin and keeps the edited body', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      const convId = 'conv-sse-edit';
      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: convId }));

      // SSE delivered the edit: new body + editedAt, on the fsd_message row.
      await testDb.messages.put({
        id: 'urn:li:fsd_message:SSE_EDIT',
        conversationId: convId,
        senderUrn: 'urn:li:fsd_profile:Alice',
        senderName: 'User Alice',
        senderPicture: '',
        body: 'edited body',
        createdAt: 5000,
        isFromMe: false,
        editedAt: 9999,
      } as Message);

      // The canonical REST page still carries the pre-edit body.
      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          { id: 'urn:li:msg_message:CANON_EDIT', body: 'original body', senderProfileId: 'Alice', deliveredAt: 5000 },
        ]),
      ]);

      await backfillBatch(1);

      // SSE duplicate gone, canonical survives with the edited body + editedAt
      expect(await testDb.messages.get('urn:li:fsd_message:SSE_EDIT')).toBeUndefined();
      const canonical = await testDb.messages.get('urn:li:msg_message:CANON_EDIT');
      expect(canonical).toBeDefined();
      expect(canonical.body).toBe('edited body');
      expect(canonical.editedAt).toBe(9999);

      // Exactly one row remains for the conversation
      const all = await testDb.messages.where('conversationId').equals(convId).toArray();
      expect(all).toHaveLength(1);
    });

    it('keeps SSE messages that have no canonical match', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      const convId = 'conv-sse-keep';
      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: convId }));

      // Pre-insert an SSE message that has NO canonical counterpart
      const sseOnly: Message = {
        id: 'urn:li:fsd_message:SSE_UNIQUE',
        conversationId: convId,
        senderUrn: 'urn:li:fsd_profile:Bob',
        senderName: 'User Bob',
        senderPicture: '',
        body: 'Unique SSE message',
        createdAt: 9000,
        isFromMe: false,
      };
      await testDb.messages.put(sseOnly);

      // Backfill returns no matching canonical messages
      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          {
            id: 'urn:li:msg_message:DIFFERENT',
            body: 'Different message entirely',
            senderProfileId: 'Charlie',
            deliveredAt: 8000,
          },
        ]),
      ]);

      await backfillBatch(1);

      // The SSE-only message should be kept
      const sseMsg = await testDb.messages.get('urn:li:fsd_message:SSE_UNIQUE');
      expect(sseMsg).toBeDefined();
      expect(sseMsg.body).toBe('Unique SSE message');
    });

    it('also cleans up fs_event SSE messages with canonical match', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      const convId = 'conv-fs-event';
      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: convId }));

      // Pre-insert a fs_event SSE message
      await testDb.messages.put({
        id: 'urn:li:fs_event:EVT_1',
        conversationId: convId,
        senderUrn: 'urn:li:fsd_profile:Dave',
        senderName: 'User Dave',
        senderPicture: '',
        body: 'Event message',
        createdAt: 3000,
        isFromMe: false,
      });

      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          {
            id: 'urn:li:msg_message:CANON_EVT',
            body: 'Event message',
            senderProfileId: 'Dave',
            deliveredAt: 3000,
          },
        ]),
      ]);

      await backfillBatch(1);

      const fsEvt = await testDb.messages.get('urn:li:fs_event:EVT_1');
      expect(fsEvt).toBeUndefined();
    });

    it('marks completed items as done with a SERVER-clock messagesSyncedAt watermark', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      // Server timestamps deliberately far in the local clock's past — the
      // watermark must come from them, never from Date.now() (clock skew would
      // otherwise make newer server activity look already-synced).
      const activityAt = Date.now() - 10 * 60_000;
      await testDb.syncQueue.put(
        makeSyncQueueItem({ conversationId: 'conv-done', lastActivityAt: activityAt })
      );

      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          {
            id: 'urn:li:msg_message:WM_1',
            body: 'newest',
            senderProfileId: 'W',
            deliveredAt: activityAt + 500,
          },
        ]),
      ]);

      await backfillBatch(1);

      const item = await testDb.syncQueue.get('conv-done');
      expect(item.status).toBe('done');
      // max(item.lastActivityAt, newest fetched deliveredAt)
      expect(item.messagesSyncedAt).toBe(activityAt + 500);
    });

    it('calls onProgress callback after each completed item', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.bulkPut([
        makeSyncQueueItem({ conversationId: 'conv-p1', priority: 1 }),
        makeSyncQueueItem({ conversationId: 'conv-p2', priority: 2 }),
      ]);

      vi.mocked(fetchAllMessages).mockResolvedValue([buildMessagesPage([])]);

      const onProgress = vi.fn();
      await backfillBatch(10, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
    });

    it('returns count of completed items', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.bulkPut([
        makeSyncQueueItem({ conversationId: 'conv-c1', priority: 1 }),
        makeSyncQueueItem({ conversationId: 'conv-c2', priority: 2 }),
        makeSyncQueueItem({ conversationId: 'conv-c3', priority: 3 }),
      ]);

      vi.mocked(fetchAllMessages).mockResolvedValue([buildMessagesPage([])]);

      const count = await backfillBatch(10);
      expect(count).toBe(3);
    });

    it('respects batchSize parameter', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.bulkPut([
        makeSyncQueueItem({ conversationId: 'conv-b1', priority: 1 }),
        makeSyncQueueItem({ conversationId: 'conv-b2', priority: 2 }),
        makeSyncQueueItem({ conversationId: 'conv-b3', priority: 3 }),
      ]);

      vi.mocked(fetchAllMessages).mockResolvedValue([buildMessagesPage([])]);

      const count = await backfillBatch(2);
      expect(count).toBe(2);

      // Only 2 processed; third remains pending
      const remaining = await testDb.syncQueue
        .where('status')
        .equals('pending')
        .toArray();
      expect(remaining).toHaveLength(1);
    });

    it('increments failCount on error and keeps as pending when < MAX_RETRIES', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.put(
        makeSyncQueueItem({ conversationId: 'conv-fail', failCount: 0 })
      );

      vi.mocked(fetchAllMessages).mockRejectedValue(new Error('Network error'));

      const before = Date.now();
      const completed = await backfillBatch(1);
      const after = Date.now();

      expect(completed).toBe(0);

      const item = await testDb.syncQueue.get('conv-fail');
      expect(item.status).toBe('pending');
      expect(item.failCount).toBe(1);
      expect(item.lastFailedAt).toBeGreaterThanOrEqual(before);
      expect(item.lastFailedAt).toBeLessThanOrEqual(after);
    });

    it('marks as failed when failCount reaches MAX_RETRIES (3)', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      // Already failed 2 times — next failure will be attempt 3
      await testDb.syncQueue.put(
        makeSyncQueueItem({ conversationId: 'conv-maxfail', failCount: 2 })
      );

      vi.mocked(fetchAllMessages).mockRejectedValue(new Error('Still failing'));

      await backfillBatch(1);

      const item = await testDb.syncQueue.get('conv-maxfail');
      expect(item.status).toBe('failed');
      expect(item.failCount).toBe(3);
    });

    it('handles multiple pages of messages per conversation', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'conv-multi' }));

      // Return 2 pages of messages
      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          { id: 'urn:li:msg_message:p1m1', body: 'Page 1 Msg 1', senderProfileId: 'A', deliveredAt: 1000 },
          { id: 'urn:li:msg_message:p1m2', body: 'Page 1 Msg 2', senderProfileId: 'B', deliveredAt: 2000 },
        ]),
        buildMessagesPage([
          { id: 'urn:li:msg_message:p2m1', body: 'Page 2 Msg 1', senderProfileId: 'A', deliveredAt: 3000 },
        ]),
      ]);

      await backfillBatch(1);

      const messages = await testDb.messages
        .where('conversationId')
        .equals('conv-multi')
        .toArray();
      expect(messages).toHaveLength(3);
    });

    it('calls prefetchSharedPosts for each page', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { prefetchSharedPosts } = await import(
        '../../entrypoints/background/sync/prefetch-posts'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      // Clear any accumulated calls from previous tests
      vi.mocked(prefetchSharedPosts).mockClear();

      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'conv-prefetch' }));

      vi.mocked(fetchAllMessages).mockResolvedValue([
        buildMessagesPage([
          { id: 'urn:li:msg_message:pf1', body: 'Hi', senderProfileId: 'A', deliveredAt: 1000 },
        ]),
        buildMessagesPage([
          { id: 'urn:li:msg_message:pf2', body: 'Bye', senderProfileId: 'B', deliveredAt: 2000 },
        ]),
      ]);

      await backfillBatch(1);

      // prefetchSharedPosts should be called once per page
      expect(prefetchSharedPosts).toHaveBeenCalledTimes(2);
    });

    it('does not process items with status=done or status=failed', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      // Clear any accumulated calls from previous tests
      vi.mocked(fetchAllMessages).mockClear();

      await testDb.syncQueue.bulkPut([
        makeSyncQueueItem({ conversationId: 'conv-done', status: 'done', priority: 1 }),
        makeSyncQueueItem({ conversationId: 'conv-failed', status: 'failed', priority: 2 }),
        makeSyncQueueItem({ conversationId: 'conv-pending', status: 'pending', priority: 3 }),
      ]);

      vi.mocked(fetchAllMessages).mockResolvedValue([buildMessagesPage([])]);

      const count = await backfillBatch(10);
      expect(count).toBe(1);
      expect(fetchAllMessages).toHaveBeenCalledTimes(1);
      expect(fetchAllMessages).toHaveBeenCalledWith('conv-pending', 10, { skipJitter: true });
    });

    it('handles fetchAllMessages returning empty array (no pages)', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.put(makeSyncQueueItem({ conversationId: 'conv-empty-pages' }));

      // Return an empty array (no pages at all)
      vi.mocked(fetchAllMessages).mockResolvedValue([]);

      const count = await backfillBatch(1);
      expect(count).toBe(1);

      // Item should be marked as done even with zero pages
      const item = await testDb.syncQueue.get('conv-empty-pages');
      expect(item.status).toBe('done');
      expect(item.messagesSyncedAt).toBeGreaterThan(0);

      // No messages should be stored
      const msgs = await testDb.messages
        .where('conversationId')
        .equals('conv-empty-pages')
        .toArray();
      expect(msgs).toHaveLength(0);
    });

    it('does not process items with status done', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      vi.mocked(fetchAllMessages).mockClear();

      // Only insert a done item
      await testDb.syncQueue.put(
        makeSyncQueueItem({ conversationId: 'conv-only-done', status: 'done', priority: 1 })
      );

      const count = await backfillBatch(10);
      expect(count).toBe(0);
      expect(fetchAllMessages).not.toHaveBeenCalled();
    });

    it('does not process items with status failed', async () => {
      const { fetchAllMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { backfillBatch } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      vi.mocked(fetchAllMessages).mockClear();

      // Only insert a failed item
      await testDb.syncQueue.put(
        makeSyncQueueItem({ conversationId: 'conv-only-failed', status: 'failed', failCount: 3, priority: 1 })
      );

      const count = await backfillBatch(10);
      expect(count).toBe(0);
      expect(fetchAllMessages).not.toHaveBeenCalled();
    });
  });

  describe('recoverStuckItems', () => {
    it('resets items with status=syncing back to pending', async () => {
      const { recoverStuckItems } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.bulkPut([
        makeSyncQueueItem({ conversationId: 'conv-stuck1', status: 'syncing' }),
        makeSyncQueueItem({ conversationId: 'conv-stuck2', status: 'syncing' }),
        makeSyncQueueItem({ conversationId: 'conv-ok', status: 'pending' }),
      ]);

      const recovered = await recoverStuckItems();
      expect(recovered).toBe(2);

      const item1 = await testDb.syncQueue.get('conv-stuck1');
      const item2 = await testDb.syncQueue.get('conv-stuck2');
      const itemOk = await testDb.syncQueue.get('conv-ok');

      expect(item1.status).toBe('pending');
      expect(item2.status).toBe('pending');
      expect(itemOk.status).toBe('pending');
    });

    it('returns 0 when no stuck items', async () => {
      const { recoverStuckItems } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      await testDb.syncQueue.bulkPut([
        makeSyncQueueItem({ conversationId: 'conv-p', status: 'pending' }),
        makeSyncQueueItem({ conversationId: 'conv-d', status: 'done' }),
      ]);

      const recovered = await recoverStuckItems();
      expect(recovered).toBe(0);
    });

    it('returns 0 when queue is empty', async () => {
      const { recoverStuckItems } = await import(
        '../../entrypoints/background/sync/sync-backfill'
      );

      const recovered = await recoverStuckItems();
      expect(recovered).toBe(0);
    });
  });
});
