// @vitest-environment jsdom
/**
 * Regression: the conversation list sometimes loaded blank until a reload.
 *
 * On page load, the UI-side `db` is null until the async session-storage
 * restore (or AuthGate's switchDatabase) completes — and React's first render
 * races it. A live query that executed while db was null returned [] WITHOUT
 * subscribing to any Dexie table, so nothing ever re-ran it once the database
 * opened: the list stayed blank until a lucky Cmd+R won the race.
 *
 * Fix: switchDatabase / the session-storage restore emit a db-changed signal;
 * UI live queries include useDbGeneration() in their deps so they re-subscribe
 * the moment the database becomes ready.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { applySchema, switchDatabase } from '@/db/database';
import { makeConversation, makeMessage, resetFactories } from '../fixtures/factories';

// db starts NULL to simulate losing the boot race.
let testDb: any = null;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...args: any[]) => sendBridgeMessage(...args),
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import { useConversations } from '@/hooks/useConversations';
import { useThread } from '@/hooks/useThread';
import { useUIStore } from '@/store/ui-store';

beforeEach(async () => {
  resetFactories();
  testDb = null;
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true });
  useUIStore.setState({ inboxTab: 'focused', searchQuery: '', selectedConversationId: null });
});

afterEach(async () => {
  if (testDb) {
    const name = testDb.name;
    testDb.close();
    await Dexie.delete(name);
    testDb = null;
  }
});

/** Open the test DB and fire the real db-changed signal, like switchDatabase does. */
async function openDbAfterMount(seed: (db: any) => Promise<void>) {
  const dexie = new Dexie(`TestDB_83_${Date.now()}_${Math.random()}`);
  applySchema(dexie);
  await dexie.open();
  await seed(dexie);
  testDb = dexie;
  // The real switchDatabase bumps the generation and notifies subscribers —
  // invoke it (mocked module spreads the original) so the signal path is real.
  await act(async () => {
    await switchDatabase(`boot-race-${Date.now()}`);
  });
}

describe('live queries recover when the database opens after first render', () => {
  it('useConversations goes from blank to populated without a reload', async () => {
    const { result } = renderHook(() => useConversations());
    expect(result.current.conversations).toEqual([]); // lost the race — db null

    await openDbAfterMount(async (dexie) => {
      await dexie.conversations.bulkPut([
        makeConversation({ id: '2-boot-1', category: 'PRIMARY_INBOX', archived: 0 }),
        makeConversation({ id: '2-boot-2', category: 'PRIMARY_INBOX', archived: 0 }),
      ]);
    });

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(2);
    });
  });

  it('useThread goes from blank to populated without a reload', async () => {
    const { result } = renderHook(() => useThread('2-boot-conv'));
    expect(result.current).toEqual([]);

    await openDbAfterMount(async (dexie) => {
      await dexie.messages.put(
        makeMessage({ id: 'urn:li:msg_message:boot-m1', conversationId: '2-boot-conv' })
      );
    });

    await waitFor(() => {
      expect(result.current).toHaveLength(1);
    });
  });
});
