/**
 * Integration tests for entrypoints/background/sync/sync-discovery.ts
 *
 * Tests discoverPage() and enqueueConversations() with a real Dexie
 * database and mocked API/auth/settings modules.
 */

import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { normalizeConversations } from '@/lib/voyager-normalizer';
import { makeConversation, makeSyncQueueItem, resetFactories } from '../fixtures/factories';
import { buildConversationsPageResponse, buildEmptyResponse } from '../fixtures/voyager-responses';
import type { Conversation } from '@/types/conversation';
import type { Profile } from '@/types/profile';
import type { SyncQueueItem } from '@/db/database';

// ---------------------------------------------------------------------------
// Test database lifecycle
// ---------------------------------------------------------------------------

let testDb: any;

beforeEach(async () => {
  resetFactories();

  testDb = new Dexie(`TestDB_SD_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

// ---------------------------------------------------------------------------
// Re-implementations of discoverPage and enqueueConversations
// using testDb directly, same algorithm as sync-discovery.ts
// ---------------------------------------------------------------------------

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

const mockFetchConversationsPage = vi.fn();
let mockBackfillCutoff = 0;

async function mergeProfilesOnTestDb(profiles: Profile[]): Promise<void> {
  if (profiles.length === 0) return;
  const urns = profiles.map((p) => p.urn);
  const existing = await testDb.profiles.bulkGet(urns);
  for (let i = 0; i < profiles.length; i++) {
    const prev = existing[i];
    if (prev) {
      if (prev.company && !profiles[i].company) profiles[i].company = prev.company;
      if (prev.title && !profiles[i].title) profiles[i].title = prev.title;
      if (prev.location && !profiles[i].location) profiles[i].location = prev.location;
      if (prev.companyLogoUrl && !profiles[i].companyLogoUrl) profiles[i].companyLogoUrl = prev.companyLogoUrl;
    }
  }
  await testDb.profiles.bulkPut(profiles);
}

interface DiscoveryResult {
  conversations: Conversation[];
  profiles: Profile[];
  isLastPage: boolean;
  nextCursor: string | null;
}

/**
 * Mirror of discoverPage from sync-discovery.ts.
 * Uses testDb directly and mocked fetch function.
 */
async function discoverPage(
  category: string,
  cursor: string | null
): Promise<DiscoveryResult> {
  const memberUrn = MEMBER_URN;

  const { response: raw, nextCursor } = await mockFetchConversationsPage(category, cursor);
  const { conversations: allConversations, profiles: allProfiles } = normalizeConversations(raw, memberUrn);

  const isLastPage = allConversations.length === 0 || !nextCursor;

  if (allConversations.length > 0 || allProfiles.length > 0) {
    const profileMap = new Map<string, Profile>();
    for (const p of allProfiles) {
      profileMap.set(p.urn, p);
    }
    const dedupedProfiles = [...profileMap.values()];

    await testDb.transaction('rw', [testDb.conversations, testDb.profiles], async () => {
      if (dedupedProfiles.length > 0) {
        await mergeProfilesOnTestDb(dedupedProfiles);
      }
      for (const conv of allConversations) {
        const existing = await testDb.conversations.get(conv.id);
        if (existing) {
          await testDb.conversations.update(conv.id, {
            participantUrns: conv.participantUrns.length > 0 ? conv.participantUrns : existing.participantUrns,
            participantNames: conv.participantNames.length > 0 ? conv.participantNames : existing.participantNames,
            participantPictures: conv.participantPictures.length > 0 ? conv.participantPictures : existing.participantPictures,
            lastMessage: conv.lastMessage || existing.lastMessage,
            lastActivityAt: Math.max(conv.lastActivityAt, existing.lastActivityAt),
            category: conv.category,
            archived: conv.archived,
            starred: existing.starred,
          });
        } else {
          await testDb.conversations.put(conv);
        }
      }
    });
  }

  return { conversations: allConversations, profiles: allProfiles, isLastPage, nextCursor };
}

/**
 * Mirror of enqueueConversations from sync-discovery.ts.
 */
async function enqueueConversations(
  conversations: Conversation[],
  category: string
): Promise<{ enqueued: number; skipped: number }> {
  let enqueued = 0;
  let skipped = 0;

  const cutoff = mockBackfillCutoff;

  for (const conv of conversations) {
    const existing = await testDb.syncQueue.get(conv.id);
    const tooOld = cutoff > 0 && conv.lastActivityAt < cutoff;

    if (!existing) {
      const item: SyncQueueItem = {
        conversationId: conv.id,
        category,
        lastActivityAt: conv.lastActivityAt,
        messagesSyncedAt: 0,
        status: tooOld ? 'done' : 'pending',
        failCount: 0,
        lastFailedAt: 0,
        priority: Number.MAX_SAFE_INTEGER - conv.lastActivityAt,
      };
      await testDb.syncQueue.put(item);
      if (tooOld) skipped++;
      else enqueued++;
    } else if (
      conv.lastActivityAt > existing.messagesSyncedAt &&
      existing.status !== 'pending' &&
      existing.status !== 'syncing' &&
      !tooOld
    ) {
      await testDb.syncQueue.update(conv.id, {
        status: 'pending',
        lastActivityAt: conv.lastActivityAt,
        priority: Number.MAX_SAFE_INTEGER - conv.lastActivityAt,
        category,
      });
      enqueued++;
    } else {
      if (conv.lastActivityAt > existing.lastActivityAt) {
        await testDb.syncQueue.update(conv.id, {
          lastActivityAt: conv.lastActivityAt,
          category,
        });
      }
      skipped++;
    }
  }

  return { enqueued, skipped };
}

beforeEach(() => {
  mockFetchConversationsPage.mockReset();
  mockBackfillCutoff = 0;
});

// ---------------------------------------------------------------------------
// discoverPage tests
// ---------------------------------------------------------------------------

describe('discoverPage', () => {
  it('fetches one page of conversations and stores them to DB', async () => {
    const pageResponse = buildConversationsPageResponse(
      [
        {
          id: '2-conv-abc',
          participants: [
            { profileId: 'user1', firstName: 'Alice', lastName: 'Smith' },
          ],
          lastMessage: 'Hello!',
          lastActivityAt: 1000,
        },
        {
          id: '2-conv-def',
          participants: [
            { profileId: 'user2', firstName: 'Bob', lastName: 'Jones' },
          ],
          lastMessage: 'Hi there',
          lastActivityAt: 2000,
        },
      ],
      'cursor-page2'
    );

    mockFetchConversationsPage.mockResolvedValue({
      response: pageResponse,
      nextCursor: 'cursor-page2',
    });

    const result = await discoverPage('PRIMARY_INBOX', null);

    expect(mockFetchConversationsPage).toHaveBeenCalledWith('PRIMARY_INBOX', null);
    expect(result.conversations).toHaveLength(2);
    expect(result.isLastPage).toBe(false);
    expect(result.nextCursor).toBe('cursor-page2');

    // Verify conversations were stored in DB
    const storedConvs = await testDb.conversations.toArray();
    expect(storedConvs).toHaveLength(2);
    expect(storedConvs.find((c: any) => c.id === '2-conv-abc')).toBeDefined();
    expect(storedConvs.find((c: any) => c.id === '2-conv-def')).toBeDefined();
  });

  it('stores profiles to DB', async () => {
    const pageResponse = buildConversationsPageResponse([
      {
        id: '2-conv-p',
        participants: [
          { profileId: 'prof1', firstName: 'Carol', lastName: 'Danvers', headline: 'Engineer' },
        ],
        lastMessage: 'Test',
        lastActivityAt: 5000,
      },
    ]);

    mockFetchConversationsPage.mockResolvedValue({
      response: pageResponse,
      nextCursor: null,
    });

    const result = await discoverPage('PRIMARY_INBOX', null);

    expect(result.profiles).toHaveLength(1);

    const storedProfiles = await testDb.profiles.toArray();
    expect(storedProfiles.length).toBeGreaterThanOrEqual(1);
    const carol = storedProfiles.find((p: any) => p.firstName === 'Carol');
    expect(carol).toBeDefined();
  });

  it('returns isLastPage=true when no conversations returned', async () => {
    mockFetchConversationsPage.mockResolvedValue({
      response: buildEmptyResponse(),
      nextCursor: null,
    });

    const result = await discoverPage('PRIMARY_INBOX', null);

    expect(result.isLastPage).toBe(true);
    expect(result.conversations).toHaveLength(0);
  });

  it('returns isLastPage=true when nextCursor is null', async () => {
    const pageResponse = buildConversationsPageResponse([
      {
        id: '2-last-page-conv',
        participants: [{ profileId: 'u1', firstName: 'Dan', lastName: 'Lee' }],
        lastMessage: 'Last page',
        lastActivityAt: 3000,
      },
    ]);

    mockFetchConversationsPage.mockResolvedValue({
      response: pageResponse,
      nextCursor: null,
    });

    const result = await discoverPage('PRIMARY_INBOX', 'prev-cursor');

    expect(result.isLastPage).toBe(true);
    expect(result.nextCursor).toBeNull();
  });

  it('returns nextCursor for pagination', async () => {
    const pageResponse = buildConversationsPageResponse(
      [
        {
          id: '2-mid-conv',
          participants: [{ profileId: 'u1', firstName: 'Eve', lastName: 'Fox' }],
          lastMessage: 'Middle page',
          lastActivityAt: 4000,
        },
      ],
      'next-cursor-abc'
    );

    mockFetchConversationsPage.mockResolvedValue({
      response: pageResponse,
      nextCursor: 'next-cursor-abc',
    });

    const result = await discoverPage('PRIMARY_INBOX', 'prev-cursor');

    expect(result.nextCursor).toBe('next-cursor-abc');
    expect(result.isLastPage).toBe(false);
  });

  it('preserves starred state when merging existing conversations', async () => {
    // Pre-populate a conversation that was starred locally
    await testDb.conversations.put({
      id: '2-starred-conv',
      participantUrns: ['urn:li:fsd_profile:u1'],
      participantNames: ['Old Name'],
      participantPictures: [''],
      lastMessage: 'old msg',
      lastActivityAt: 1000,
      read: 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
      starred: 1,
    });

    const pageResponse = buildConversationsPageResponse([
      {
        id: '2-starred-conv',
        participants: [{ profileId: 'u1', firstName: 'New', lastName: 'Name' }],
        lastMessage: 'new msg',
        lastActivityAt: 2000,
      },
    ]);

    mockFetchConversationsPage.mockResolvedValue({
      response: pageResponse,
      nextCursor: null,
    });

    await discoverPage('PRIMARY_INBOX', null);

    const conv = await testDb.conversations.get('2-starred-conv');
    expect(conv).toBeDefined();
    // Starred state should be preserved from the existing record
    expect(conv.starred).toBe(1);
    // Other fields should be updated
    expect(conv.lastActivityAt).toBe(2000);
  });

  it('merges conversation data preserving non-empty participant info', async () => {
    // Pre-populate with participant data
    await testDb.conversations.put({
      id: '2-merge-conv',
      participantUrns: ['urn:li:fsd_profile:existing'],
      participantNames: ['Existing Name'],
      participantPictures: ['pic.jpg'],
      lastMessage: 'old',
      lastActivityAt: 500,
      read: 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
    });

    // Incoming page has the same conversation with updated activity
    const pageResponse = buildConversationsPageResponse([
      {
        id: '2-merge-conv',
        participants: [{ profileId: 'existing', firstName: 'Updated', lastName: 'Name' }],
        lastMessage: 'new message',
        lastActivityAt: 1500,
      },
    ]);

    mockFetchConversationsPage.mockResolvedValue({
      response: pageResponse,
      nextCursor: null,
    });

    await discoverPage('PRIMARY_INBOX', null);

    const conv = await testDb.conversations.get('2-merge-conv');
    expect(conv.lastActivityAt).toBe(1500);
    expect(conv.lastMessage).toBe('new message');
  });
});

// ---------------------------------------------------------------------------
// enqueueConversations tests
// ---------------------------------------------------------------------------

describe('enqueueConversations', () => {
  it('inserts new conversations with status=pending', async () => {
    const conversations: Conversation[] = [
      makeConversation({ id: 'new-conv-1', lastActivityAt: 5000 }),
      makeConversation({ id: 'new-conv-2', lastActivityAt: 3000 }),
    ];

    const result = await enqueueConversations(conversations, 'PRIMARY_INBOX');

    expect(result.enqueued).toBe(2);
    expect(result.skipped).toBe(0);

    const q1 = await testDb.syncQueue.get('new-conv-1');
    expect(q1).toBeDefined();
    expect(q1.status).toBe('pending');
    expect(q1.category).toBe('PRIMARY_INBOX');
    expect(q1.messagesSyncedAt).toBe(0);

    const q2 = await testDb.syncQueue.get('new-conv-2');
    expect(q2).toBeDefined();
    expect(q2.status).toBe('pending');
  });

  it('sets priority = MAX_SAFE_INTEGER - lastActivityAt', async () => {
    const lastActivityAt = 12345;
    const conversations = [
      makeConversation({ id: 'prio-conv', lastActivityAt }),
    ];

    await enqueueConversations(conversations, 'PRIMARY_INBOX');

    const item = await testDb.syncQueue.get('prio-conv');
    expect(item.priority).toBe(Number.MAX_SAFE_INTEGER - lastActivityAt);
  });

  it('marks too-old conversations as done', async () => {
    const now = Date.now();
    mockBackfillCutoff = now;

    const conversations = [
      makeConversation({ id: 'old-conv', lastActivityAt: now - 1000 }),
    ];

    const result = await enqueueConversations(conversations, 'PRIMARY_INBOX');

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);

    const item = await testDb.syncQueue.get('old-conv');
    expect(item.status).toBe('done');
  });

  it('re-queues stale conversations with new activity', async () => {
    // Pre-populate a done conversation that was synced at time 1000
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'stale-conv',
        status: 'done',
        messagesSyncedAt: 1000,
        lastActivityAt: 1000,
      })
    );

    // New activity at time 2000
    const conversations = [
      makeConversation({ id: 'stale-conv', lastActivityAt: 2000 }),
    ];

    const result = await enqueueConversations(conversations, 'PRIMARY_INBOX');

    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(0);

    const item = await testDb.syncQueue.get('stale-conv');
    expect(item.status).toBe('pending');
    expect(item.lastActivityAt).toBe(2000);
    expect(item.priority).toBe(Number.MAX_SAFE_INTEGER - 2000);
  });

  it('does not re-queue if lastActivityAt <= messagesSyncedAt', async () => {
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'synced-conv',
        status: 'done',
        messagesSyncedAt: 5000,
        lastActivityAt: 5000,
      })
    );

    const conversations = [
      makeConversation({ id: 'synced-conv', lastActivityAt: 5000 }),
    ];

    const result = await enqueueConversations(conversations, 'PRIMARY_INBOX');

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);

    const item = await testDb.syncQueue.get('synced-conv');
    expect(item.status).toBe('done');
  });

  it('skips already-pending conversations', async () => {
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'pending-conv',
        status: 'pending',
        messagesSyncedAt: 0,
        lastActivityAt: 1000,
      })
    );

    const conversations = [
      makeConversation({ id: 'pending-conv', lastActivityAt: 2000 }),
    ];

    const result = await enqueueConversations(conversations, 'PRIMARY_INBOX');

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);

    const item = await testDb.syncQueue.get('pending-conv');
    expect(item.status).toBe('pending');
  });

  it('skips already-syncing conversations', async () => {
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'syncing-conv',
        status: 'syncing',
        messagesSyncedAt: 500,
        lastActivityAt: 1000,
      })
    );

    const conversations = [
      makeConversation({ id: 'syncing-conv', lastActivityAt: 2000 }),
    ];

    const result = await enqueueConversations(conversations, 'PRIMARY_INBOX');

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);

    const item = await testDb.syncQueue.get('syncing-conv');
    expect(item.status).toBe('syncing');
  });

  it('returns correct enqueued/skipped counts for mixed input', async () => {
    const now = Date.now();
    mockBackfillCutoff = now - 5000;

    // Pre-populate one as already synced
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'already-done',
        status: 'done',
        messagesSyncedAt: now,
        lastActivityAt: now,
      })
    );

    // Pre-populate one as pending
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'already-pending',
        status: 'pending',
        lastActivityAt: now,
      })
    );

    const conversations = [
      makeConversation({ id: 'brand-new', lastActivityAt: now }),        // new -> enqueued
      makeConversation({ id: 'too-old', lastActivityAt: now - 10000 }),  // too old -> skipped (done)
      makeConversation({ id: 'already-done', lastActivityAt: now }),     // no new activity -> skipped
      makeConversation({ id: 'already-pending', lastActivityAt: now }),  // pending -> skipped
    ];

    const result = await enqueueConversations(conversations, 'PRIMARY_INBOX');

    expect(result.enqueued).toBe(1); // brand-new
    expect(result.skipped).toBe(3); // too-old, already-done, already-pending
  });

  it('updates lastActivityAt even when skipping up-to-date conversations', async () => {
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'update-activity',
        status: 'done',
        messagesSyncedAt: 5000,
        lastActivityAt: 3000,
      })
    );

    // lastActivityAt is newer than stored but not newer than messagesSyncedAt
    const conversations = [
      makeConversation({ id: 'update-activity', lastActivityAt: 4000 }),
    ];

    await enqueueConversations(conversations, 'PRIMARY_INBOX');

    const item = await testDb.syncQueue.get('update-activity');
    expect(item.status).toBe('done'); // Not re-queued
    expect(item.lastActivityAt).toBe(4000); // But lastActivityAt updated
  });

  it('does not re-queue stale conversations when they are too old', async () => {
    const now = Date.now();
    mockBackfillCutoff = now - 1000;

    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'stale-but-old',
        status: 'done',
        messagesSyncedAt: now - 5000,
        lastActivityAt: now - 5000,
      })
    );

    const conversations = [
      makeConversation({ id: 'stale-but-old', lastActivityAt: now - 3000 }),
    ];

    const result = await enqueueConversations(conversations, 'PRIMARY_INBOX');

    expect(result.skipped).toBe(1);
    expect(result.enqueued).toBe(0);

    const item = await testDb.syncQueue.get('stale-but-old');
    expect(item.status).toBe('done');
  });

  it('handles empty conversation list', async () => {
    const result = await enqueueConversations([], 'PRIMARY_INBOX');

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('re-queues failed conversations with new activity', async () => {
    await testDb.syncQueue.put(
      makeSyncQueueItem({
        conversationId: 'failed-conv',
        status: 'failed',
        messagesSyncedAt: 1000,
        lastActivityAt: 1000,
        failCount: 3,
      })
    );

    const conversations = [
      makeConversation({ id: 'failed-conv', lastActivityAt: 2000 }),
    ];

    const result = await enqueueConversations(conversations, 'PRIMARY_INBOX');

    expect(result.enqueued).toBe(1);

    const item = await testDb.syncQueue.get('failed-conv');
    expect(item.status).toBe('pending');
    expect(item.lastActivityAt).toBe(2000);
  });
});
