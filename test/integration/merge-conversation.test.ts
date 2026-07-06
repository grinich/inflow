import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makeConversation, makePendingAction } from '../fixtures/factories';
import type { Conversation } from '@/types/conversation';

// ── Test DB setup (mirrors the other sync integration tests) ────────────────
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

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { mergeConversation } from '../../entrypoints/background/sync/merge-conversation';
import {
  recordMutation,
  recordMarkRead,
} from '../../entrypoints/background/realtime/mark-read-suppression';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_merge_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

const get = (id: string): Promise<Conversation | undefined> => testDb.conversations.get(id);

// ---------------------------------------------------------------------------
// `starred` is a LOCAL-ONLY field. A category-filtered server page can omit the
// STARRED overlay even for a starred thread, so a poll must never downgrade a
// star (only the optimistic STAR/UNSTAR action clears it). These tests lock in
// that contract — regressing it silently un-stars users' conversations.
// ---------------------------------------------------------------------------
describe('mergeConversation — starred is local-only (never downgraded by a poll)', () => {
  it('preserves an existing star when a server page omits STARRED (no silent un-star)', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'c-star-keep', starred: 1, lastActivityAt: 1000 }),
    );
    // Server poll returns the same conversation WITHOUT the STARRED overlay.
    await mergeConversation(
      makeConversation({ id: 'c-star-keep', starred: 0, lastActivityAt: 2000 }),
    );
    expect((await get('c-star-keep'))!.starred).toBe(1);
  });

  it('treats an undefined server starred as "no change" and keeps the local star', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c-star-undef', starred: 1 }));
    await mergeConversation(makeConversation({ id: 'c-star-undef', starred: undefined }));
    expect((await get('c-star-undef'))!.starred).toBe(1);
  });

  it('applies a star reported by the server (cross-client 0 → 1 upgrade)', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'c-star-add', starred: 0, lastActivityAt: 1000 }),
    );
    // Page at least as fresh as local state — flags apply.
    await mergeConversation(
      makeConversation({ id: 'c-star-add', starred: 1, lastActivityAt: 1000 }),
    );
    expect((await get('c-star-add'))!.starred).toBe(1);
  });

  it('keeps a conversation unstarred when neither local nor server is starred', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c-star-none', starred: 0 }));
    await mergeConversation(makeConversation({ id: 'c-star-none', starred: 0 }));
    expect((await get('c-star-none'))!.starred).toBe(0);
  });

  it('persists a star on first insert when the server reports it', async () => {
    await mergeConversation(makeConversation({ id: 'c-star-insert', starred: 1 }));
    expect((await get('c-star-insert'))!.starred).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// While an optimistic action is in flight, the whole category/archived/read/
// starred set is protected from stale server data.
// ---------------------------------------------------------------------------
describe('mergeConversation — pending-action guard', () => {
  it('skips category/archived/read/starred while an action is in-flight, but still advances the preview', async () => {
    await testDb.conversations.put(
      makeConversation({
        id: 'c-guard',
        category: 'PRIMARY_INBOX',
        archived: 0,
        read: 1,
        starred: 1,
        lastMessage: 'old',
        lastActivityAt: 1000,
      }),
    );
    await testDb.pendingActions.put(
      makePendingAction({ conversationId: 'c-guard', status: 'pending' }),
    );

    await mergeConversation(
      makeConversation({
        id: 'c-guard',
        category: 'ARCHIVE',
        archived: 1,
        read: 0,
        starred: 0,
        lastMessage: 'newer message',
        lastActivityAt: 5000,
      }),
    );

    const row = (await get('c-guard'))!;
    // Optimistic fields protected…
    expect(row.category).toBe('PRIMARY_INBOX');
    expect(row.archived).toBe(0);
    expect(row.read).toBe(1);
    expect(row.starred).toBe(1);
    // …but message preview / activity still advance.
    expect(row.lastMessage).toBe('newer message');
    expect(row.lastActivityAt).toBe(5000);
  });

  it('does not guard when the only matching action is already failed (rolled back)', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'c-failed', category: 'PRIMARY_INBOX', lastActivityAt: 1000 }),
    );
    await testDb.pendingActions.put(
      makePendingAction({ conversationId: 'c-failed', status: 'failed' }),
    );
    await mergeConversation(
      makeConversation({ id: 'c-failed', category: 'SECONDARY_INBOX', lastActivityAt: 1000 }),
    );
    // 'failed' actions are already rolled back, so the server value wins.
    expect((await get('c-failed'))!.category).toBe('SECONDARY_INBOX');
  });
});

// ---------------------------------------------------------------------------
// Suppression windows (the period after an action's API call completes but
// while the SSE echo / a stale poll may still arrive).
// ---------------------------------------------------------------------------
describe('mergeConversation — suppression windows', () => {
  it('skips category/archived overwrites during the mutation-suppression window', async () => {
    recordMutation('c-sup-mut');
    await testDb.conversations.put(
      makeConversation({ id: 'c-sup-mut', category: 'PRIMARY_INBOX', archived: 0 }),
    );
    await mergeConversation(
      makeConversation({ id: 'c-sup-mut', category: 'ARCHIVE', archived: 1 }),
    );
    const row = (await get('c-sup-mut'))!;
    expect(row.category).toBe('PRIMARY_INBOX');
    expect(row.archived).toBe(0);
  });

  it('skips the read overwrite during the mark-read-suppression window', async () => {
    recordMarkRead('c-sup-read');
    await testDb.conversations.put(makeConversation({ id: 'c-sup-read', read: 1 }));
    await mergeConversation(makeConversation({ id: 'c-sup-read', read: 0 }));
    expect((await get('c-sup-read'))!.read).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Normal merges (no in-flight action, no suppression).
// ---------------------------------------------------------------------------
describe('mergeConversation — normal (unguarded) field merges', () => {
  it('updates category/archived/read from the server when nothing is in-flight', async () => {
    await testDb.conversations.put(
      makeConversation({
        id: 'c-merge',
        category: 'PRIMARY_INBOX',
        archived: 0,
        read: 1,
        lastActivityAt: 1000,
      }),
    );
    // Page at least as fresh as local state — flags apply (an OLDER page must
    // not: see regression 59).
    await mergeConversation(
      makeConversation({
        id: 'c-merge',
        category: 'SECONDARY_INBOX',
        archived: 0,
        read: 0,
        lastActivityAt: 1000,
      }),
    );
    const row = (await get('c-merge'))!;
    expect(row.category).toBe('SECONDARY_INBOX');
    expect(row.read).toBe(0);
  });

  it('uses the max of server and local lastActivityAt', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c-act', lastActivityAt: 5000 }));
    await mergeConversation(makeConversation({ id: 'c-act', lastActivityAt: 3000 }));
    expect((await get('c-act'))!.lastActivityAt).toBe(5000);
    await mergeConversation(makeConversation({ id: 'c-act', lastActivityAt: 8000 }));
    expect((await get('c-act'))!.lastActivityAt).toBe(8000);
  });

  it('preserves local participant data when the server returns empty arrays', async () => {
    await testDb.conversations.put(
      makeConversation({
        id: 'c-parts',
        participantUrns: ['urn:li:fsd_profile:keep'],
        participantNames: ['Alice'],
        participantPictures: ['pic.jpg'],
      }),
    );
    await mergeConversation(
      makeConversation({
        id: 'c-parts',
        participantUrns: [],
        participantNames: [],
        participantPictures: [],
      }),
    );
    const row = (await get('c-parts'))!;
    expect(row.participantNames).toEqual(['Alice']);
    expect(row.participantUrns).toEqual(['urn:li:fsd_profile:keep']);
    expect(row.participantPictures).toEqual(['pic.jpg']);
  });

  it('preserves lastMessage when the server preview is empty', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c-lm', lastMessage: 'hello' }));
    await mergeConversation(makeConversation({ id: 'c-lm', lastMessage: '' }));
    expect((await get('c-lm'))!.lastMessage).toBe('hello');
  });

  it('inserts a brand-new conversation unchanged when none exists', async () => {
    await mergeConversation(
      makeConversation({ id: 'c-new', category: 'SECONDARY_INBOX', starred: 1 }),
    );
    const row = (await get('c-new'))!;
    expect(row.category).toBe('SECONDARY_INBOX');
    expect(row.starred).toBe(1);
  });
});
