/**
 * Regression: the toolbar badge counted a different "Focused" set than the
 * list showed.
 *
 * The Focused list includes conversations with no category or legacy 'INBOX'
 * (useConversations) and excludes archived rows via its index, but the badge
 * only counted `category === 'PRIMARY_INBOX'` and ignored `archived` — so the
 * unread badge disagreed with what the user actually saw in the Focused tab.
 *
 * Fix: one shared predicate (isFocusedConversation) drives both, and the badge
 * count is computed by an exported, testable helper.
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

import { isFocusedConversation, countUnreadFocused } from '@/lib/inbox-filters';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_74_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('isFocusedConversation', () => {
  it('matches the Focused list rules: PRIMARY_INBOX, legacy INBOX, and no category', () => {
    expect(isFocusedConversation(makeConversation({ category: 'PRIMARY_INBOX', archived: 0 }))).toBe(true);
    expect(isFocusedConversation(makeConversation({ category: 'INBOX', archived: 0 }))).toBe(true);
    const noCat = makeConversation({ archived: 0 });
    delete (noCat as any).category;
    expect(isFocusedConversation(noCat)).toBe(true);
  });

  it('excludes archived rows, other categories, and drafts', () => {
    expect(isFocusedConversation(makeConversation({ category: 'PRIMARY_INBOX', archived: 1 }))).toBe(false);
    expect(isFocusedConversation(makeConversation({ category: 'SECONDARY_INBOX', archived: 0 }))).toBe(false);
    expect(isFocusedConversation(makeConversation({ category: 'SPAM', archived: 0 }))).toBe(false);
    expect(isFocusedConversation(makeConversation({ category: 'PRIMARY_INBOX', archived: 0, draft: 1 }))).toBe(false);
  });
});

describe('countUnreadFocused', () => {
  it('counts unread legacy-INBOX and no-category rows, and skips archived unreads', async () => {
    const noCat = makeConversation({ id: 'c-nocat', read: 0, archived: 0 });
    delete (noCat as any).category;
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'c-primary', read: 0, archived: 0, category: 'PRIMARY_INBOX' }),
      makeConversation({ id: 'c-legacy', read: 0, archived: 0, category: 'INBOX' }),
      noCat,
      // Not counted:
      makeConversation({ id: 'c-archived', read: 0, archived: 1, category: 'ARCHIVE' }),
      makeConversation({ id: 'c-other', read: 0, archived: 0, category: 'SECONDARY_INBOX' }),
      makeConversation({ id: 'c-read', read: 1, archived: 0, category: 'PRIMARY_INBOX' }),
      makeConversation({ id: 'c-draft', read: 0, archived: 0, category: 'PRIMARY_INBOX', draft: 1 }),
    ]);

    expect(await countUnreadFocused(testDb)).toBe(3);
  });
});
