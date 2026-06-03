// @vitest-environment jsdom
// Coverage for useConversations: tab routing, 1:1 dedup-merge, and the search
// filter parser (tokens + dates + free text + is:unread snapshot). This is the
// core inbox query and was previously untested.
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useConversations } from '@/hooks/useConversations';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_convs_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ searchQuery: '', inboxTab: 'focused' });
});

afterEach(() => testDb.close());

/** Render the hook and wait until the live query resolves. */
async function load() {
  const { result } = renderHook(() => useConversations());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  return result;
}

function ids(result: any) {
  return result.current.conversations.map((c: any) => c.id).sort();
}

describe('tab routing', () => {
  beforeEach(async () => {
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'focused-1', category: 'PRIMARY_INBOX', archived: 0 }),
      makeConversation({ id: 'inbox-1', category: 'INBOX', archived: 0 }),
      makeConversation({ id: 'other-1', category: 'SECONDARY_INBOX', archived: 0 }),
      makeConversation({ id: 'spam-1', category: 'SPAM', archived: 0 }),
      makeConversation({ id: 'arch-1', category: 'PRIMARY_INBOX', archived: 1 }),
    ]);
  });

  it('focused shows PRIMARY_INBOX/INBOX and excludes other/archived', async () => {
    useUIStore.setState({ inboxTab: 'focused' });
    expect(ids(await load())).toEqual(['focused-1', 'inbox-1']);
  });

  it('other shows only SECONDARY_INBOX', async () => {
    useUIStore.setState({ inboxTab: 'other' });
    expect(ids(await load())).toEqual(['other-1']);
  });

  it('spam shows only SPAM', async () => {
    useUIStore.setState({ inboxTab: 'spam' });
    expect(ids(await load())).toEqual(['spam-1']);
  });

  it('archived shows only archived=1', async () => {
    useUIStore.setState({ inboxTab: 'archived' });
    expect(ids(await load())).toEqual(['arch-1']);
  });
});

describe('1:1 dedup-merge', () => {
  it('merges threads sharing a participant, keeps the most recent, preserves unread/starred', async () => {
    await testDb.conversations.bulkPut([
      makeConversation({
        id: 'recent',
        participantUrns: ['urn:li:fsd_profile:DUP'],
        lastActivityAt: 2000,
        read: 1,
        starred: 0,
      }),
      makeConversation({
        id: 'older',
        participantUrns: ['urn:li:fsd_profile:DUP'],
        lastActivityAt: 1000,
        read: 0, // unread on the merged-away thread
        starred: 1,
      }),
    ]);
    const result = await load();
    expect(result.current.conversations).toHaveLength(1);
    const merged = result.current.conversations[0];
    expect(merged.id).toBe('recent');
    expect(merged.mergedIds).toEqual(['older']);
    expect(merged.read).toBe(0); // inherited from the unread merged thread
    expect(merged.starred).toBe(1); // inherited
  });

  it('does not merge group conversations (multiple participants)', async () => {
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'g1', participantUrns: ['urn:li:fsd_profile:A', 'urn:li:fsd_profile:B'] }),
      makeConversation({ id: 'g2', participantUrns: ['urn:li:fsd_profile:A', 'urn:li:fsd_profile:B'] }),
    ]);
    expect(ids(await load())).toEqual(['g1', 'g2']);
  });
});

describe('search filters', () => {
  beforeEach(async () => {
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'c-unread', participantNames: ['Ada Lovelace'], participantUrns: ['urn:li:fsd_profile:ADA'], read: 0, lastMessage: 'about the engine' }),
      makeConversation({ id: 'c-read', participantNames: ['Grace Hopper'], participantUrns: ['urn:li:fsd_profile:GRACE'], read: 1, lastMessage: 'compiler notes' }),
      makeConversation({ id: 'c-star', participantNames: ['Alan Turing'], participantUrns: ['urn:li:fsd_profile:ALAN'], read: 1, starred: 1, lastMessage: 'machine' }),
      makeConversation({ id: 'c-attach', participantNames: ['Edsger Dijkstra'], participantUrns: ['urn:li:fsd_profile:EWD'], read: 1, hasAttachments: 1, lastMessage: 'shortest path' }),
    ]);
  });

  it('is:unread returns only unread', async () => {
    useUIStore.setState({ searchQuery: 'is:unread' });
    expect(ids(await load())).toEqual(['c-unread']);
  });

  it('is:starred returns only starred', async () => {
    useUIStore.setState({ searchQuery: 'is:starred' });
    expect(ids(await load())).toEqual(['c-star']);
  });

  it('has:attachment returns only conversations with attachments', async () => {
    useUIStore.setState({ searchQuery: 'has:attachment' });
    expect(ids(await load())).toEqual(['c-attach']);
  });

  it('from:name matches a participant name (case-insensitive)', async () => {
    useUIStore.setState({ searchQuery: 'from:grace' });
    expect(ids(await load())).toEqual(['c-read']);
  });

  it('free text matches participant name OR last message', async () => {
    useUIStore.setState({ searchQuery: 'engine' });
    expect(ids(await load())).toEqual(['c-unread']);
    useUIStore.setState({ searchQuery: 'turing' });
    expect(ids(await load())).toEqual(['c-star']);
  });

  it('combines a token with free text', async () => {
    // is:unread + "engine" → only the unread conversation whose text matches.
    useUIStore.setState({ searchQuery: 'is:unread engine' });
    expect(ids(await load())).toEqual(['c-unread']);
    // is:unread + non-matching text → empty.
    useUIStore.setState({ searchQuery: 'is:unread compiler' });
    expect(ids(await load())).toEqual([]);
  });
});

describe('date filters', () => {
  beforeEach(async () => {
    // ISO date-only parses as UTC midnight, matching the filter's Date.parse, so
    // boundaries are unambiguous.
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'old', lastActivityAt: Date.parse('2026-03-05') }),
      makeConversation({ id: 'mid', lastActivityAt: Date.parse('2026-03-12') }),
      makeConversation({ id: 'new', lastActivityAt: Date.parse('2026-03-20') }),
    ]);
  });

  it('newer:Nd keeps only conversations within the window', async () => {
    // Huge window keeps everything (afterTs is far in the past).
    useUIStore.setState({ searchQuery: 'newer:100000d' });
    expect(ids(await load())).toEqual(['mid', 'new', 'old']);
  });

  it('after:DATE keeps conversations at/after the date; before:DATE keeps those before', async () => {
    useUIStore.setState({ searchQuery: 'after:2026-03-15' });
    expect(ids(await load())).toEqual(['new']);
    useUIStore.setState({ searchQuery: 'before:2026-03-15' });
    expect(ids(await load())).toEqual(['mid', 'old']);
  });

  it('ignores an impossible date (does not filter everything out)', async () => {
    useUIStore.setState({ searchQuery: 'after:2026-13-40' });
    expect(ids(await load())).toEqual(['mid', 'new', 'old']);
  });
});

describe('is:unread snapshot stability', () => {
  it('keeps a conversation visible after it is marked read while the query is active', async () => {
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'u1', read: 0 }),
      makeConversation({ id: 'u2', read: 0 }),
    ]);
    useUIStore.setState({ searchQuery: 'is:unread' });
    const result = await load();
    expect(ids(result)).toEqual(['u1', 'u2']);

    // Mark u1 read — the live query re-runs, but the snapshot should keep it.
    await testDb.conversations.update('u1', { read: 1 });
    await waitFor(() => {
      // still both present (stable list while browsing)
      expect(result.current.conversations.map((c: any) => c.id).sort()).toEqual(['u1', 'u2']);
    });
  });
});
