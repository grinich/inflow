// @vitest-environment jsdom
// The whole accept-an-invitation flow, driven through the real App.
//
// The pieces were each unit-tested and the flow still did not work: pressing
// Enter advanced the list instead of switching views, the note still raised a
// notification, and when the thread finally synced nothing selected it. Those
// are seams between components, which per-component tests cannot see — so this
// renders App itself, presses real keys, and lets the store, the database and
// the components do their own work. Only the network is faked.
import '../dom-setup';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Invitation } from '@/types/network';
import type { Conversation } from '@/types/conversation';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
  mergeProfiles: vi.fn().mockResolvedValue(undefined),
}));

/** Every bridge call the app makes, so the test can assert on traffic. */
const calls: any[] = [];
let acceptSucceeds = true;
/** Set by a test to have the accepted thread appear after a delay, as sync does. */
let threadArrivesAfterMs: number | null = null;

const sendBridgeMessage = vi.fn(async (msg: any) => {
  calls.push(msg);
  switch (msg.type) {
    case 'CHECK_AUTH':
      return { success: true, data: { authenticated: true } };
    case 'ACCEPT_INVITATION': {
      if (!acceptSucceeds) return { success: false, error: 'nope' };
      if (threadArrivesAfterMs !== null) {
        // The real background creates the thread server-side; sync brings it
        // down a beat later. Reproduce that timing rather than pre-seeding it.
        setTimeout(() => { void testDb.conversations.put(acceptedThread()); }, threadArrivesAfterMs);
      }
      return { success: true };
    }
    case 'FETCH_INVITATIONS':
    case 'FETCH_SENT_INVITATIONS':
      return { success: true, data: { count: 1, total: 1 } };
    case 'FETCH_CONNECTIONS':
      return { success: true, data: { fetched: 0, hasMore: false } };
    // Shapes the chrome expects; a bare {} makes SyncStatusIndicator throw and
    // that noise would mask the failures this test is actually for.
    case 'GET_SYNC_PROGRESS':
      // Must be the full shape. A partial one throws inside
      // SyncStatusIndicator, and an uncaught render error unmounts the entire
      // App — which reads as "the flow did nothing" rather than as a broken
      // mock, and cost a while to track down.
      return { success: true, data: { categories: {}, queue: { pending: 0 } } };
    case 'GET_SSE_STATUS':
      return { success: true, data: { connected: true } };
    default:
      return { success: true, data: {} };
  }
});
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a),
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn(), getDebugLogs: vi.fn(async () => []), clearDebugLogs: vi.fn() }));

import { App } from '../../entrypoints/app/App';
import { useUIStore } from '@/store/ui-store';

const NOTE = 'Hi Michael, I will be in San Francisco next week.';

/**
 * A different sender each test.
 *
 * The flow keeps watching for the thread after the assertion returns, and the
 * placeholder id is derived from the sender — so a shared one lets a previous
 * test's watcher act on this test's state. Unique senders keep them apart
 * without weakening anything.
 */
let senderSeq = 0;
let SENDER = '';
let PLACEHOLDER = '';

function invitation(over: Partial<Invitation> = {}): Invitation {
  return {
    id: 'inv-1', sharedSecret: 'secret', fromUrn: SENDER, name: 'Angelika Hiebl',
    headline: 'Sales at DACH', pictureUrl: '', publicId: 'angelika',
    message: NOTE, sentAt: 1_750_000_000_000, status: 'pending',
    mutualCount: 0, mutualNames: [], mutualPictures: [],
    ...over,
  };
}

/** The thread LinkedIn creates when the invitation is accepted. */
function acceptedThread(): Conversation {
  return {
    id: 'conv-accepted',
    participantUrns: [SENDER],
    participantNames: ['Angelika Hiebl'],
    participantPictures: [''],
    lastMessage: NOTE,
    lastActivityAt: 1_750_000_100_000,
    read: 0,
    archived: 0,
    category: 'PRIMARY_INBOX',
  } as Conversation;
}

beforeEach(async () => {
  vi.clearAllMocks();
  calls.length = 0;
  acceptSucceeds = true;
  threadArrivesAfterMs = null;
  SENDER = `urn:li:fsd_profile:ACoAAAsender${++senderSeq}`;
  PLACEHOLDER = `draft-ACoAAAsender${senderSeq}`;
  testDb = new Dexie(`TestDB_acceptflow_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.invitations.put(invitation());
  useUIStore.setState({
    appView: 'network', networkTab: 'invitations', networkSelectedIndex: 0,
    inboxTab: 'focused', selectedConversationId: null, composeNewActive: false,
    searchQuery: '',
  });
  (globalThis as any).IntersectionObserver = class { observe() {} disconnect() {} };
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

/**
 * Render App and wait until the network view is genuinely interactive.
 *
 * Waiting for the row is not enough: NetworkView's key handler lists the
 * filtered invitations in its effect deps, so it re-subscribes when the live
 * query resolves, and a keypress landing in that gap closes over an empty list
 * and does nothing. The detail pane renders from the same data in the same
 * commit, so once its prompt is on screen that commit's effect has run.
 */
async function openNetworkView() {
  render(<App />);
  await waitFor(() => expect(screen.getByText(/Accept invitation from/)).toBeTruthy());
}

/**
 * Press Enter until the accept actually goes out.
 *
 * NetworkView's key handler re-subscribes whenever the live query resolves, so
 * a single press can fall into that gap and be dropped — which a real user
 * simply experiences as pressing the key again. Every assertion here is about
 * what follows the accept, not about one keystroke landing.
 */
async function pressEnter() {
  await waitFor(() => {
    fireEvent.keyDown(document.body, { key: 'Enter', bubbles: true, cancelable: true });
    expect(calls.some((c) => c.type === 'ACCEPT_INVITATION')).toBe(true);
  });
}

describe('accepting an invitation, end to end', () => {
  it('Enter accepts and leaves the network view — it does not just advance the list', async () => {
    // The reported bug: Enter moved the selection to the next request and
    // stayed put, because the row left the pending list and re-rendered.
    threadArrivesAfterMs = 300;
    await openNetworkView();

    await pressEnter();

    // The view switches BEFORE the accept is sent — waiting on a round trip to
    // LinkedIn first is the pause that made this feel broken — so the request
    // is asserted separately rather than as of the moment we switch.
    await waitFor(() => expect(useUIStore.getState().appView).toBe('inbox'));
    await waitFor(() =>
      expect(calls.some((c) => c.type === 'ACCEPT_INVITATION' && c.invitationId === 'inv-1')).toBe(true)
    );
  });

  it('shows a thread pane immediately, before the real thread syncs', async () => {
    threadArrivesAfterMs = 1200;
    await openNetworkView();

    await pressEnter();

    // A placeholder stands in so the switch is instant rather than a pause on
    // the network list.
    await waitFor(() => {
      expect(useUIStore.getState().appView).toBe('inbox');
      expect(useUIStore.getState().selectedConversationId).toBeTruthy();
    });
  });

  it('selects the accepted thread once it arrives', async () => {
    // The reported bug: the message landed and nothing selected it.
    threadArrivesAfterMs = 400;
    await openNetworkView();

    await pressEnter();

    await waitFor(
      () => expect(useUIStore.getState().selectedConversationId).toBe('conv-accepted'),
      { timeout: 15_000 }
    );
  }, 20_000);

  it('puts the cursor in the reply box', async () => {
    threadArrivesAfterMs = 300;
    await openNetworkView();

    await pressEnter();

    await waitFor(
      () => expect(document.activeElement?.hasAttribute('data-compose-input')).toBe(true),
      { timeout: 15_000 }
    );
  }, 20_000);

  it('does not leave a stray placeholder in the conversation list', async () => {
    threadArrivesAfterMs = 400;
    await openNetworkView();

    await pressEnter();

    await waitFor(
      () => expect(useUIStore.getState().selectedConversationId).toBe('conv-accepted'),
      { timeout: 15_000 }
    );
    expect(await testDb.conversations.get(PLACEHOLDER)).toBeUndefined();
  }, 20_000);

  it('never leaves a previous person selected', async () => {
    // The reported failure, and the worst one: the inbox came up with whoever
    // was showing before still selected, so the reply being typed became a
    // draft to them. The placeholder is written to the database a beat before
    // the live query lists it, and App's reconciliation read that gap as
    // "removed" and recovered onto the old row.
    await testDb.conversations.put({
      id: 'someone-else', participantUrns: ['urn:li:fsd_profile:ACoAAAother'],
      participantNames: ['Someone Else'], participantPictures: [''],
      lastMessage: 'earlier', lastActivityAt: 1_749_000_000_000,
      read: 1, archived: 0, category: 'PRIMARY_INBOX',
    } as Conversation);
    useUIStore.setState({ selectedConversationId: 'someone-else', selectedIndex: 0 });
    threadArrivesAfterMs = 700;
    await openNetworkView();

    await pressEnter();

    // Never the other person, at any point — not while waiting, not after.
    for (let i = 0; i < 12; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
      expect(useUIStore.getState().selectedConversationId).not.toBe('someone-else');
    }
    expect(useUIStore.getState().selectedConversationId).toBe('conv-accepted');
  }, 20_000);

  it('stays on the network list when the request had no note', async () => {
    await testDb.invitations.put(invitation({ message: '' }));
    await openNetworkView();

    await pressEnter();

    await waitFor(() =>
      expect(calls.some((c) => c.type === 'ACCEPT_INVITATION')).toBe(true)
    );
    // Nothing to reply to — keep triaging.
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(useUIStore.getState().appView).toBe('network');
  });

  it('stays on the network list when the accept fails', async () => {
    acceptSucceeds = false;
    await openNetworkView();

    await pressEnter();

    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(useUIStore.getState().appView).toBe('network');
    expect((await testDb.invitations.get('inv-1')).status).toBe('pending');
  });
});
