// @vitest-environment jsdom
/**
 * Regression 175 — with LinkedIn's Focused/Other split turned off, opening a
 * conversation that LinkedIn had filed as SECONDARY_INBOX threw the selection
 * away.
 *
 * The combined inbox lists those rows (that is the whole point of combining),
 * but App's "is the selected row still headed for this tab?" check called
 * belongsToTab WITHOUT the combine flag. So the row it had just rendered was
 * judged to belong elsewhere, the guard decided the selection was stale, and
 * it jumped to a fallback conversation — the thread the user opened closed
 * itself a moment later.
 *
 * Runs the real App so the store, the list and the effect argue it out the way
 * they do in the product.
 */
import '../dom-setup';
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Conversation } from '@/types/conversation';
import { FOCUSED_INBOX_KEY } from '@/lib/focused-inbox';
import { setLocalStore } from '../mocks/chrome';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
  mergeProfiles: vi.fn().mockResolvedValue(undefined),
}));

const sendBridgeMessage = vi.fn(async (msg: any) => {
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
});
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a),
}));
vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(), getDebugLogs: vi.fn(async () => []), clearDebugLogs: vi.fn(),
}));

import { App } from '../../entrypoints/app/App';
import { useUIStore } from '@/store/ui-store';

function conv(over: Partial<Conversation>): Conversation {
  return {
    id: 'c', participantUrns: ['urn:li:fsd_profile:x'], participantNames: ['Someone'],
    participantPictures: [''], lastMessage: 'hello', lastActivityAt: 1_750_000_000_000,
    read: 1, archived: 0, category: 'PRIMARY_INBOX', ...over,
  } as Conversation;
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_175_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.conversations.put(
    conv({ id: 'primary', category: 'PRIMARY_INBOX', participantNames: ['Ada Primary'], lastActivityAt: 2000 })
  );
  // The account turned the Focused/Other split off.
  setLocalStore(FOCUSED_INBOX_KEY, false);
  useUIStore.setState({
    appView: 'inbox', inboxTab: 'focused', selectedConversationId: null,
    composeNewActive: false, searchQuery: '', focusedInboxEnabled: false,
  });
  (globalThis as any).IntersectionObserver = class { observe() {} disconnect() {} };
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
  cleanup();
  testDb.close();
  await Dexie.delete(testDb.name);
});

it('keeps a just-arrived SECONDARY_INBOX conversation selected in the combined inbox', async () => {
  render(<App />);
  await waitFor(() => expect(screen.getByText('Ada Primary')).toBeInTheDocument());

  // The race the guard exists for: the row is in the database but the live
  // query has not listed it yet, so App must decide whether the selection is
  // stale or merely early. With the split off this row belongs to the combined
  // inbox — it is early, not stale.
  await act(async () => {
    await testDb.conversations.put(
      conv({
        id: 'secondary', category: 'SECONDARY_INBOX', participantNames: ['Bob Secondary'],
        participantUrns: ['urn:li:fsd_profile:bob'], lastActivityAt: 3000,
      })
    );
    useUIStore.getState().openThread('secondary', 0);
  });

  // The bug: judged to belong to another tab, so the selection was thrown away
  // and the user bounced to whoever was showing before.
  await new Promise((r) => setTimeout(r, 200));
  expect(useUIStore.getState().selectedConversationId).toBe('secondary');
});

it('still moves on when the row genuinely left the tab', async () => {
  // The guard must keep working: a row archived out from under the selection
  // is stale, and staying on it would strand the user on an empty thread.
  render(<App />);
  await waitFor(() => expect(screen.getByText('Ada Primary')).toBeInTheDocument());

  await act(async () => {
    await testDb.conversations.put(
      conv({ id: 'gone', category: 'ARCHIVE', archived: 1, participantNames: ['Archived Row'] })
    );
    useUIStore.getState().openThread('gone', 0);
  });

  await new Promise((r) => setTimeout(r, 200));
  expect(useUIStore.getState().selectedConversationId).toBe('primary');
});
