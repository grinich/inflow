/**
 * Regression: a stale server page must not clobber newer local flags.
 *
 * mergeConversation took Math.max for lastActivityAt (acknowledging that pages
 * can be stale) but overwrote read/category/archived unconditionally. Concrete
 * race: a discovery page is fetched, an SSE message lands and sets read=0, then
 * the (pre-message) page merge lands and sets read=1 — the unread indicator for
 * a genuinely new message is lost. Discovery paginates for minutes while SSE is
 * live, so this window was hit regularly.
 *
 * Fix: flags only apply when the server page is at least as fresh as local
 * state (conv.lastActivityAt >= existing.lastActivityAt). Equal timestamps must
 * still apply — cross-device read changes don't bump lastActivityAt.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

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

beforeEach(async () => {
  testDb = new Dexie(`TestDB_59_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('mergeConversation staleness guard', () => {
  it('keeps newer local flags when the server page is older', async () => {
    // SSE just delivered a new inbound message: unread, in Focused.
    await testDb.conversations.put(
      makeConversation({
        id: 'c-stale',
        read: 0,
        archived: 0,
        category: 'PRIMARY_INBOX',
        lastMessage: 'brand new inbound',
        lastActivityAt: 5000,
      })
    );

    // A page fetched BEFORE that message arrives late: read, archived, older preview.
    await mergeConversation(
      makeConversation({
        id: 'c-stale',
        read: 1,
        archived: 1,
        category: 'ARCHIVE',
        lastMessage: 'older preview',
        lastActivityAt: 3000,
      })
    );

    const row = await testDb.conversations.get('c-stale');
    expect(row.read).toBe(0);
    expect(row.archived).toBe(0);
    expect(row.category).toBe('PRIMARY_INBOX');
    expect(row.lastMessage).toBe('brand new inbound');
    expect(row.lastActivityAt).toBe(5000);
  });

  it('still applies flags from an equally-fresh page (cross-device read reconcile)', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'c-equal', read: 0, lastActivityAt: 5000 })
    );

    // Thread read on another device: same lastActivityAt, read flipped.
    await mergeConversation(
      makeConversation({ id: 'c-equal', read: 1, lastActivityAt: 5000 })
    );

    expect((await testDb.conversations.get('c-equal')).read).toBe(1);
  });

  it('applies flags from a strictly newer page', async () => {
    await testDb.conversations.put(
      makeConversation({ id: 'c-newer', read: 1, category: 'PRIMARY_INBOX', lastActivityAt: 3000 })
    );

    await mergeConversation(
      makeConversation({ id: 'c-newer', read: 0, category: 'SECONDARY_INBOX', lastActivityAt: 5000 })
    );

    const row = await testDb.conversations.get('c-newer');
    expect(row.read).toBe(0);
    expect(row.category).toBe('SECONDARY_INBOX');
  });
});
