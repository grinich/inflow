// @vitest-environment jsdom
/**
 * Regression 176 — "Message" on a connection opened the new-message composer.
 *
 * The recipient is already decided by pressing the button, so being asked
 * again for one is a step backwards; worse, the composer lets you add MORE
 * people, so a reply could quietly become a group message to someone you
 * never meant to include. It should land in the 1:1 thread with that person —
 * the existing one if there is one — with the cursor in the reply box.
 */
import '../dom-setup';
import Dexie from 'dexie';
import { renderHook } from '@testing-library/react';
import { applySchema } from '@/db/database';
import type { Connection } from '@/types/network';
import type { Conversation } from '@/types/conversation';

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

const BRIE: Connection = {
  profileUrn: 'urn:li:fsd_profile:ACoAAABrie',
  name: 'Brie Wolfson',
  headline: 'Marketing',
  pictureUrl: 'https://example.test/brie.jpg',
  publicId: 'briewolfson',
  connectedAt: 1_750_000_000_000,
};

function conv(over: Partial<Conversation>): Conversation {
  return {
    id: 'c', participantUrns: [BRIE.profileUrn], participantNames: [BRIE.name],
    participantPictures: [''], lastMessage: 'hi', lastActivityAt: 1_750_000_000_000,
    read: 1, archived: 0, category: 'PRIMARY_INBOX', ...over,
  } as Conversation;
}

const actions = () => renderHook(() => useNetworkActions()).result.current;
const state = () => useUIStore.getState();

beforeEach(async () => {
  testDb = new Dexie(`TestDB_176_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({
    appView: 'network', inboxTab: 'focused', selectedConversationId: null,
    composeNewActive: false, searchQuery: '', composerFocusFor: null,
    focusedInboxEnabled: true,
  });
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

it('opens the existing 1:1 thread and puts the cursor in the reply box', async () => {
  await testDb.conversations.put(conv({ id: 'real-thread' }));

  await actions().messageConnection(BRIE);

  expect(state().appView).toBe('inbox');
  expect(state().selectedConversationId).toBe('real-thread');
  expect(state().composerFocusFor).toBe('real-thread');
  // The whole point: no recipient picker between the button and typing.
  expect(state().composeNewActive).toBe(false);
});

it('with no thread yet, opens a stand-in to type into — not the composer', async () => {
  await actions().messageConnection(BRIE);

  const placeholderId = 'draft-ACoAAABrie';
  expect(state().selectedConversationId).toBe(placeholderId);
  expect(state().composerFocusFor).toBe(placeholderId);
  expect(state().composeNewActive).toBe(false);

  // The stand-in carries the person, so the thread header reads right and
  // sending from it creates the real conversation (see ComposeBox).
  const row = await testDb.conversations.get(placeholderId);
  expect(row).toMatchObject({
    participantUrns: [BRIE.profileUrn],
    participantNames: [BRIE.name],
    draft: 1,
  });
});

it('never picks a group thread that merely contains the person', async () => {
  // Sending into a group would message people the user did not choose.
  await testDb.conversations.put(
    conv({ id: 'group', participantUrns: [BRIE.profileUrn, 'urn:li:fsd_profile:someone'] })
  );

  await actions().messageConnection(BRIE);

  expect(state().selectedConversationId).toBe('draft-ACoAAABrie');
});

it('prefers the most recent thread when LinkedIn kept several', async () => {
  await testDb.conversations.bulkPut([
    conv({ id: 'older', lastActivityAt: 1000 }),
    conv({ id: 'newer', lastActivityAt: 9000 }),
  ]);

  await actions().messageConnection(BRIE);

  // The same one the conversation list shows after it merges duplicates.
  expect(state().selectedConversationId).toBe('newer');
});

it('clears a search that would hide the thread it just opened', async () => {
  await testDb.conversations.put(conv({ id: 'real-thread' }));
  useUIStore.setState({ searchQuery: 'something else' });

  await actions().messageConnection(BRIE);

  expect(state().searchQuery).toBe('');
});
