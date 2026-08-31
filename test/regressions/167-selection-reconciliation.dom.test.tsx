// @vitest-environment jsdom
// App keeps the selected conversation and the rendered list in agreement. When
// the selected id is not in the list it recovers onto the row at the same
// position — which is right for a thread that was archived, deleted or moved,
// and wrong for one that simply is not listed YET.
//
// Rows are written to the database a beat before the live query reports them,
// and reading that gap as "removed" is how accepting an invitation could land
// the user on whoever was showing before, so the reply they were typing became
// a draft to that person.
//
// Both halves matter and they pull in opposite directions, so both are pinned
// here: recover when it is gone, wait when it is coming.
import '../dom-setup';
import { render, screen, waitFor, act } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Conversation } from '@/types/conversation';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
  mergeProfiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: vi.fn(async (msg: any) => {
    switch (msg.type) {
      case 'CHECK_AUTH':
        return { success: true, data: { authenticated: true } };
      case 'GET_SYNC_PROGRESS':
        return { success: true, data: { categories: {}, queue: { pending: 0 } } };
      case 'GET_SSE_STATUS':
        return { success: true, data: { connected: true } };
      default:
        return { success: true, data: {} };
    }
  }),
}));
vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(), getDebugLogs: vi.fn(async () => []), clearDebugLogs: vi.fn(),
}));

import { App } from '../../entrypoints/app/App';
import { useUIStore } from '@/store/ui-store';

function conv(id: string, over: Partial<Conversation> = {}): Conversation {
  return {
    id,
    participantUrns: [`urn:li:fsd_profile:${id}`],
    participantNames: [`Person ${id}`],
    participantPictures: [''],
    lastMessage: `message from ${id}`,
    lastActivityAt: 1_750_000_000_000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    ...over,
  } as Conversation;
}

const selected = () => useUIStore.getState().selectedConversationId;

/** Let effects, the live query and the database check all settle. */
async function settle(ms = 400) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_reconcile_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({
    appView: 'inbox', inboxTab: 'focused', selectedConversationId: null,
    selectedIndex: 0, composeNewActive: false, searchQuery: '',
  });
  (globalThis as any).IntersectionObserver = class { observe() {} disconnect() {} };
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

/** Render the inbox with two threads and the first one selected. */
async function openInbox() {
  await testDb.conversations.bulkPut([
    conv('first', { lastActivityAt: 2_000_000_000_000 }),
    conv('second', { lastActivityAt: 1_000_000_000_000 }),
  ]);
  render(<App />);
  await waitFor(() => expect(screen.getByText('Person second')).toBeTruthy());
  act(() => { useUIStore.getState().openThread('first', 0); });
  await settle(100);
}

describe('regression #167: gone vs not listed yet', () => {
  it('moves on when the selected thread is archived away', async () => {
    await openInbox();

    // What archiving does to the row the Focused list reads.
    await act(async () => { await testDb.conversations.update('first', { archived: 1 }); });
    await settle();

    // Leaving it selected would keep an archived thread on screen in Focused.
    expect(selected()).toBe('second');
  });

  it('moves on when the selected thread is deleted outright', async () => {
    await openInbox();

    await act(async () => { await testDb.conversations.delete('first'); });
    await settle();

    expect(selected()).toBe('second');
  });

  it('moves on when the selected thread is moved to another folder', async () => {
    await openInbox();

    await act(async () => {
      await testDb.conversations.update('first', { category: 'SECONDARY_INBOX' });
    });
    await settle();

    expect(selected()).toBe('second');
  });

  it('waits for a thread written a beat ago instead of recovering off it', async () => {
    // The accept-an-invitation case, reduced: the row is in the database and
    // headed for this tab, but the live query has not reported it yet.
    await openInbox();

    await act(async () => {
      await testDb.conversations.put(conv('brand-new', { lastActivityAt: 3_000_000_000_000 }));
      useUIStore.getState().openThread('brand-new', 0);
    });
    await settle();

    expect(selected()).toBe('brand-new');
  });

  it('never flickers through the previous thread while waiting', async () => {
    // A single flip is enough to misfile a reply: the composer is focused the
    // whole time, so whoever is selected during the gap is who gets typed to.
    await openInbox();

    await act(async () => {
      await testDb.conversations.put(conv('brand-new', { lastActivityAt: 3_000_000_000_000 }));
      useUIStore.getState().openThread('brand-new', 0);
    });
    for (let i = 0; i < 10; i++) {
      await settle(50);
      expect(selected()).toBe('brand-new');
    }
  });

  it('still recovers from a thread that never existed', async () => {
    // A stale id — from a restored tab, or a row deleted in another window.
    // Waiting forever would strand the user on an empty pane.
    await openInbox();

    act(() => { useUIStore.getState().openThread('no-such-thread', 0); });
    await settle();

    expect(selected()).not.toBe('no-such-thread');
    expect(['first', 'second']).toContain(selected());
  });
});
