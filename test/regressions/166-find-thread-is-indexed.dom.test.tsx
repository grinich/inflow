// @vitest-environment jsdom
// Finding "the 1:1 thread with this person" loaded every conversation and
// filtered in memory. The accept flow calls it every 400ms while it waits for
// a newly accepted thread to sync — up to ~37 times — so an inbox of a few
// thousand threads meant tens of full table loads for one accept.
//
// v15 indexes participantUrns (multiEntry), turning it into a lookup. These
// pin both halves: that the index exists, and that narrowing to it did not
// quietly change which thread gets picked.
import '../dom-setup';
import { renderHook, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Conversation } from '@/types/conversation';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

const sendBridgeMessage = vi.fn(async () => ({ success: true }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a) }));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { useNetworkActions } from '@/hooks/useNetworkActions';
import { useUIStore } from '@/store/ui-store';

const PERSON = 'urn:li:fsd_profile:ACoAAAtarget';

function conv(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id, participantUrns: [PERSON], participantNames: ['Target Person'],
    participantPictures: [''], lastMessage: 'hi', lastActivityAt: 1_000,
    read: 1, archived: 0, category: 'PRIMARY_INBOX', ...over,
  } as Conversation;
}

beforeEach(async () => {
  vi.clearAllMocks();
  sendBridgeMessage.mockImplementation(async () => ({ success: true }));
  testDb = new Dexie(`TestDB_findthread_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ appView: 'network', selectedConversationId: null, inboxTab: 'focused' });
  document.body.innerHTML = '<textarea data-compose-input></textarea>';
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
  document.body.innerHTML = '';
});

const actions = () => renderHook(() => useNetworkActions()).result.current;

const connection = {
  profileUrn: PERSON, name: 'Target Person', headline: '', pictureUrl: '',
  publicId: 'target', connectedAt: 1,
};

describe('regression #166: the 1:1 lookup is indexed', () => {
  it('indexes participantUrns as a multiEntry key', () => {
    const idx = testDb.conversations.schema.indexes.find((i: any) => i.name === 'participantUrns');

    expect(idx).toBeTruthy();
    // Without multiEntry the key would be the whole array, and equals(urn)
    // would never match.
    expect(idx.multi).toBe(true);
  });

  it('finds the thread among thousands without loading them', async () => {
    // The scale that motivated this. If the lookup regressed to a scan the
    // result would still be right, so this is about the query, not the answer.
    const bulk = Array.from({ length: 3000 }, (_, i) =>
      conv(`other-${i}`, { participantUrns: [`urn:li:fsd_profile:other${i}`] })
    );
    await testDb.conversations.bulkPut([...bulk, conv('wanted')]);

    const matched = await testDb.conversations.where('participantUrns').equals(PERSON).toArray();

    expect(matched.map((c: any) => c.id)).toEqual(['wanted']);
  });

  it('back-fills the index for conversations already stored', async () => {
    // An existing user upgrades with thousands of rows written before the
    // index existed. If Dexie did not re-index them the lookup would come back
    // empty and every accept would fall through to a placeholder forever.
    const name = `TestDB_upgrade_${Date.now()}_${Math.random()}`;
    const old = new Dexie(name);
    old.version(14).stores({
      conversations: 'id, lastActivityAt, archived, read, category, hasAttachments, starred, [archived+lastActivityAt], [category+lastActivityAt]',
    });
    await old.open();
    await (old as any).conversations.put(conv('written-before-the-index'));
    old.close();

    const upgraded = new Dexie(name);
    applySchema(upgraded);
    await upgraded.open();
    const found = await (upgraded as any).conversations
      .where('participantUrns').equals(PERSON).toArray();
    upgraded.close();
    await Dexie.delete(name);

    expect(found.map((c: any) => c.id)).toEqual(['written-before-the-index']);
  });

  it('still prefers the most recent of duplicate threads', async () => {
    // LinkedIn can keep more than one 1:1 thread for a person; the newest is
    // the one useConversations shows once it merges them.
    await testDb.conversations.bulkPut([
      conv('older', { lastActivityAt: 1_000 }),
      conv('newest', { lastActivityAt: 9_000 }),
    ]);

    await actions().messageConnection(connection as any);

    await waitFor(() => expect(useUIStore.getState().selectedConversationId).toBe('newest'));
  });

  it('still refuses a group thread containing the person', async () => {
    await testDb.conversations.put(
      conv('group', { participantUrns: [PERSON, 'urn:li:fsd_profile:someone'] })
    );

    await actions().messageConnection(connection as any);

    // A group match would send the reply to an extra person; a draft is right.
    await waitFor(() =>
      expect(useUIStore.getState().selectedConversationId).toBe('draft-ACoAAAtarget')
    );
  });

  it('still ignores a draft stand-in when looking for the real thread', async () => {
    await testDb.conversations.bulkPut([
      conv('draft-ACoAAAtarget', { draft: 1, lastActivityAt: 9_999 }),
      conv('real', { lastActivityAt: 1_000 }),
    ]);

    await actions().messageConnection(connection as any);

    await waitFor(() => expect(useUIStore.getState().selectedConversationId).toBe('real'));
  });
});
