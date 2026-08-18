// @vitest-environment jsdom
// Regression: "Message" on a connection matched an existing thread with
// `participantUrns.includes(target) && others.length <= 1`. Since
// participantUrns EXCLUDES the viewer, a 2-person GROUP thread containing the
// target also passed — so Message could open a group and address the intended
// private message to an extra recipient.
//
// Second bug: the destination tab was hardcoded to 'focused'. A matched thread
// living in Other/Archived/Spam isn't in useConversations' focused result, so
// App's selection reconciliation immediately replaced it and Message silently
// failed to open non-focused threads.
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import '../dom-setup';
import { renderHook } from '@testing-library/react';
import type { Conversation } from '@/types/conversation';
import type { Connection } from '@/types/network';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn().mockResolvedValue({ success: true }) }));

import { useNetworkActions } from '@/hooks/useNetworkActions';
import { useUIStore } from '@/store/ui-store';

const TARGET = 'urn:li:fsd_profile:ACoAAAtarget';
const OTHER = 'urn:li:fsd_profile:ACoAAAother';

const conn: Connection = {
  profileUrn: TARGET,
  name: 'Ada Lovelace',
  headline: 'Engineer',
  pictureUrl: '',
  publicId: 'ada-lovelace',
  connectedAt: 1750000000000,
};

function conv(over: Partial<Conversation> & { id: string }): Conversation {
  return {
    participantUrns: [TARGET],
    participantNames: ['Ada Lovelace'],
    participantPictures: [''],
    lastMessage: 'hi',
    lastActivityAt: 1750000000000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    ...over,
  } as Conversation;
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_net_msg_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({
    appView: 'network',
    inboxTab: 'focused',
    selectedConversationId: null,
    viewMode: 'list',
    tabMemory: {},
  });
});
afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

function actions() {
  return renderHook(() => useNetworkActions()).result.current;
}

describe('messageConnection thread matching', () => {
  it('does not match a group thread that merely contains the connection', async () => {
    // Group of viewer + target + one more: participantUrns has 2 entries.
    await testDb.conversations.put(
      conv({ id: 'group-1', participantUrns: [TARGET, OTHER], participantNames: ['Ada', 'Bob'] })
    );

    await actions().messageConnection(conn);

    const s = useUIStore.getState();
    expect(s.selectedConversationId).toBe(`draft-ACoAAAtarget`);
    expect(s.composeNewActive).toBe(true);
    expect(s.viewMode).not.toBe('thread');
    // The group was left alone.
    expect(await testDb.conversations.get('group-1')).toBeTruthy();
  });

  it('matches a true 1:1 thread and opens it', async () => {
    await testDb.conversations.put(conv({ id: 'direct-1' }));

    await actions().messageConnection(conn);

    const s = useUIStore.getState();
    expect(s.selectedConversationId).toBe('direct-1');
    expect(s.viewMode).toBe('thread');
    expect(s.appView).toBe('inbox');
  });

  it.each([
    ['other', { category: 'SECONDARY_INBOX' }],
    ['archived', { archived: 1 }],
    ['spam', { category: 'SPAM' }],
  ])('switches to the %s tab when the match lives there', async (tab, over) => {
    await testDb.conversations.put(conv({ id: 'direct-1', ...(over as Partial<Conversation>) }));

    await actions().messageConnection(conn);

    const s = useUIStore.getState();
    expect(s.inboxTab).toBe(tab);
    expect(s.selectedConversationId).toBe('direct-1');
  });

  it('prefers the most recent of duplicate 1:1 threads', async () => {
    // Ids ordered so the DB's own (primary-key) order returns the STALE one
    // first — a plain .find() would have picked it.
    await testDb.conversations.bulkPut([
      conv({ id: 'a-stale', lastActivityAt: 1000 }),
      conv({ id: 'z-recent', lastActivityAt: 9000 }),
    ]);

    await actions().messageConnection(conn);

    expect(useUIStore.getState().selectedConversationId).toBe('z-recent');
  });

  it('ignores draft conversations when matching', async () => {
    await testDb.conversations.put(conv({ id: 'draft-ACoAAAtarget', draft: 1 }));

    await actions().messageConnection(conn);

    const s = useUIStore.getState();
    expect(s.composeNewActive).toBe(true);
    expect(s.viewMode).not.toBe('thread');
  });
});
