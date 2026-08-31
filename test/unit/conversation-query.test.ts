/**
 * Pins the conversation-list query pipeline extracted from useConversations
 * into src/lib/conversation-query.ts. These tests are the contract that the
 * extraction changed nothing: tab membership, dedup semantics, every search
 * token, and the unread-snapshot split between hook and lib.
 */
import Dexie from 'dexie';
import { applySchema, type InflowDatabase } from '@/db/database';
import {
  applySearchFilters,
  mergeDuplicateConversations,
  parseSearchQuery,
  queryTabConversations,
} from '@/lib/conversation-query';
import { belongsToTab } from '@/lib/inbox-filters';
import { makeConversation, resetFactories } from '../fixtures/factories';
import type { Conversation } from '@/types/conversation';

const DAY = 86400000;

function createDb(): InflowDatabase {
  const database = new Dexie(`TestDB_${Date.now()}_${Math.random()}`) as InflowDatabase;
  applySchema(database);
  return database;
}

describe('parseSearchQuery', () => {
  it('parses each token and strips it from the free text', () => {
    expect(parseSearchQuery('has:draft').filters.draft).toBe(true);
    expect(parseSearchQuery('has:attachment').filters.attachments).toBe(true);
    expect(parseSearchQuery('is:unread').filters.unread).toBe(true);
    expect(parseSearchQuery('is:starred').filters.starred).toBe(true);
    expect(parseSearchQuery('is:read').filters.read).toBe(true);
    expect(parseSearchQuery('is:group').filters.group).toBe(true);
    expect(parseSearchQuery('from:jane').filters.fromName).toBe('jane');
    for (const q of ['has:draft', 'is:unread', 'from:jane']) {
      expect(parseSearchQuery(q).text).toBe('');
    }
  });

  it('is case-insensitive', () => {
    const parsed = parseSearchQuery('IS:UNREAD From:Jane HAS:Attachment');
    expect(parsed.filters.unread).toBe(true);
    expect(parsed.filters.attachments).toBe(true);
    expect(parsed.filters.fromName).toBe('jane'); // lowercased for matching
    expect(parsed.text).toBe('');
  });

  it('parses after:/before: dates and ignores impossible ones', () => {
    const parsed = parseSearchQuery('after:2026-01-01 before:2026-02-01');
    expect(parsed.filters.afterTs).toBe(Date.parse('2026-01-01'));
    expect(parsed.filters.beforeTs).toBe(Date.parse('2026-02-01'));
    // Impossible date: token consumed, filter not set
    const bad = parseSearchQuery('after:2026-13-40 hello');
    expect(bad.filters.afterTs).toBeUndefined();
    expect(bad.text).toBe('hello');
  });

  it('parses newer:Nd / older:Nd against the injected now', () => {
    const now = Date.parse('2026-06-15T12:00:00Z');
    const parsed = parseSearchQuery('newer:7d older:30d', now);
    expect(parsed.filters.afterTs).toBe(now - 7 * DAY);
    expect(parsed.filters.beforeTs).toBe(now - 30 * DAY);
  });

  it('newer: overrides an earlier after: (last assignment wins, as always)', () => {
    const now = Date.parse('2026-06-15T00:00:00Z');
    const parsed = parseSearchQuery('after:2020-01-01 newer:1d', now);
    expect(parsed.filters.afterTs).toBe(now - DAY);
  });

  it('collapses doubled internal spaces left by mid-query tokens', () => {
    // Regression: "project is:unread update" must free-text match "project update"
    const parsed = parseSearchQuery('project is:unread update');
    expect(parsed.filters.unread).toBe(true);
    expect(parsed.text).toBe('project update');
  });

  it('handles token combinations with free text', () => {
    const parsed = parseSearchQuery('is:unread from:doe has:attachment budget review');
    expect(parsed.filters.unread).toBe(true);
    expect(parsed.filters.fromName).toBe('doe');
    expect(parsed.filters.attachments).toBe(true);
    expect(parsed.text).toBe('budget review');
  });
});

describe('mergeDuplicateConversations', () => {
  beforeEach(() => resetFactories());

  it('merges 1:1 duplicates into the most recent and records mergedIds', () => {
    const urn = 'urn:li:fsd_profile:same-person';
    const newer = makeConversation({ id: 'newer', participantUrns: [urn], lastActivityAt: 3000 });
    const older = makeConversation({ id: 'older', participantUrns: [urn], lastActivityAt: 1000 });
    const oldest = makeConversation({ id: 'oldest', participantUrns: [urn], lastActivityAt: 500 });
    const merged = mergeDuplicateConversations([newer, older, oldest]);
    expect(merged.map((c) => c.id)).toEqual(['newer']);
    expect(newer.mergedIds).toEqual(['older', 'oldest']);
  });

  it('propagates unread and starred from merged rows onto the survivor', () => {
    const urn = 'urn:li:fsd_profile:same-person';
    const newer = makeConversation({
      id: 'a', participantUrns: [urn], lastActivityAt: 2000, read: 1, starred: 0,
    });
    const older = makeConversation({
      id: 'b', participantUrns: [urn], lastActivityAt: 1000, read: 0, starred: 1,
    });
    mergeDuplicateConversations([newer, older]);
    expect(newer.read).toBe(0);
    expect(newer.starred).toBe(1);
  });

  it('skips group conversations and is a no-op without duplicates', () => {
    const group = makeConversation({
      id: 'g',
      participantUrns: ['urn:li:fsd_profile:x', 'urn:li:fsd_profile:y'],
    });
    const group2 = makeConversation({
      id: 'g2',
      participantUrns: ['urn:li:fsd_profile:x', 'urn:li:fsd_profile:y'],
    });
    const solo = makeConversation({ id: 's' });
    const input = [group, group2, solo];
    const out = mergeDuplicateConversations(input);
    expect(out).toBe(input); // no removals → same array back
    expect(group.mergedIds).toBeUndefined();
  });
});

describe('queryTabConversations', () => {
  let db: InflowDatabase;
  let seeded: Conversation[];

  beforeEach(async () => {
    resetFactories();
    db = createDb();
    await db.open();
    seeded = [
      makeConversation({ id: 'focused-1', archived: 0, category: 'PRIMARY_INBOX' }),
      makeConversation({ id: 'focused-legacy', archived: 0, category: 'INBOX' }),
      makeConversation({ id: 'focused-nocat', archived: 0, category: '' }),
      makeConversation({ id: 'other-1', archived: 0, category: 'SECONDARY_INBOX' }),
      makeConversation({ id: 'archived-1', archived: 1, category: 'ARCHIVE' }),
      makeConversation({ id: 'spam-1', archived: 0, category: 'SPAM' }),
    ];
    await db.conversations.bulkPut(seeded);
  });

  afterEach(async () => {
    db.close();
    await Dexie.delete(db.name);
  });

  const tabs = ['focused', 'other', 'archived', 'spam'] as const;

  it.each(tabs)('%s tab matches belongsToTab', async (tab) => {
    const results = await queryTabConversations(db, tab);
    const expected = seeded.filter((c) => belongsToTab(c, tab)).map((c) => c.id).sort();
    expect(results.map((c) => c.id).sort()).toEqual(expected);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns rows newest-first', async () => {
    await db.conversations.bulkPut([
      makeConversation({ id: 'f-old', archived: 0, category: 'PRIMARY_INBOX', lastActivityAt: 100 }),
      makeConversation({ id: 'f-new', archived: 0, category: 'PRIMARY_INBOX', lastActivityAt: 9e12 }),
    ]);
    const results = await queryTabConversations(db, 'focused');
    const times = results.map((c) => c.lastActivityAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(results[0].id).toBe('f-new');
    expect(results[results.length - 1].id).toBe('f-old');
  });
});

describe('applySearchFilters', () => {
  let db: InflowDatabase;

  beforeEach(async () => {
    resetFactories();
    db = createDb();
    await db.open();
  });

  afterEach(async () => {
    db.close();
    await Dexie.delete(db.name);
  });

  it('filters unread fresh and returns the ids for the caller to snapshot', async () => {
    const unread = makeConversation({ id: 'u', read: 0 });
    const read = makeConversation({ id: 'r', read: 1 });
    const { results, unreadIds } = await applySearchFilters(
      db, [unread, read], parseSearchQuery('is:unread')
    );
    expect(results.map((c) => c.id)).toEqual(['u']);
    expect(unreadIds).toEqual(new Set(['u']));
  });

  it('with a snapshot set, keeps showing the snapshotted rows even once read', async () => {
    const wasUnread = makeConversation({ id: 'u', read: 1 }); // read since snapshot
    const stillRead = makeConversation({ id: 'r', read: 1 });
    const { results, unreadIds } = await applySearchFilters(
      db, [wasUnread, stillRead], parseSearchQuery('is:unread'),
      { unreadIdSet: new Set(['u']) }
    );
    expect(results.map((c) => c.id)).toEqual(['u']);
    expect(unreadIds).toBeNull(); // no fresh set captured on the snapshot path
  });

  it('has:draft reads draftAttachments and requires text or files', async () => {
    await db.draftAttachments.bulkPut([
      { conversationId: 'with-text', text: 'hello', files: [], names: [], types: [] },
      { conversationId: 'empty', text: '', files: [], names: [], types: [] },
    ]);
    const a = makeConversation({ id: 'with-text' });
    const b = makeConversation({ id: 'empty' });
    const c = makeConversation({ id: 'no-draft' });
    const { results } = await applySearchFilters(db, [a, b, c], parseSearchQuery('has:draft'));
    expect(results.map((x) => x.id)).toEqual(['with-text']);
  });

  it('applies attachment/starred/read/group/from/date filters', async () => {
    const rows = [
      makeConversation({ id: 'att', hasAttachments: 1 }),
      makeConversation({ id: 'star', starred: 1 }),
      makeConversation({ id: 'grp', participantUrns: ['urn:a', 'urn:b'] }),
      makeConversation({ id: 'jane', participantNames: ['Jane Doe'] }),
      makeConversation({ id: 'early', lastActivityAt: Date.parse('2020-06-01') }),
    ];
    const run = async (q: string) =>
      (await applySearchFilters(db, [...rows], parseSearchQuery(q))).results.map((c) => c.id);

    expect(await run('has:attachment')).toEqual(['att']);
    expect(await run('is:starred')).toEqual(['star']);
    expect(await run('is:group')).toEqual(['grp']);
    expect(await run('from:jane')).toEqual(['jane']);
    expect(await run('before:2021-01-01')).toEqual(['early']);
    expect((await run('after:2021-01-01')).includes('early')).toBe(false);
  });

  it('free text matches participant names and last message, case-insensitive', async () => {
    const byName = makeConversation({ id: 'n', participantNames: ['Ada Lovelace'] });
    const byMsg = makeConversation({ id: 'm', lastMessage: 'about the LOVELACE deal' });
    const neither = makeConversation({ id: 'x' });
    const { results } = await applySearchFilters(
      db, [byName, byMsg, neither], parseSearchQuery('lovelace')
    );
    expect(results.map((c) => c.id).sort()).toEqual(['m', 'n']);
  });
});
