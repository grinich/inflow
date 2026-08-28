// @vitest-environment jsdom
/**
 * Regression: starConversation branched on the React render snapshot instead
 * of the stored row.
 *
 * `if (conversation.starred)` reads a value refreshed only after the Dexie
 * live query round-trips and React re-renders. Pressing `s` twice quickly
 * (star, then unstar) handed BOTH invocations starred: 0 — both took the
 * star branch, fired two STAR calls, and the conversation ended up starred
 * though the user toggled it off. reactToMessage solves exactly this with a
 * transactional re-read; star now re-reads the stored row too.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { renderHook, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

let testDb: any;
const { mockSendBridgeMessage } = vi.hoisted(() => ({ mockSendBridgeMessage: vi.fn() }));
let bridgeCalls: any[] = [];

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: mockSendBridgeMessage,
}));

import { useOptimisticAction } from '@/hooks/useOptimisticAction';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_117_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();

  bridgeCalls = [];
  mockSendBridgeMessage.mockReset().mockImplementation(async (msg: any) => {
    bridgeCalls.push(msg.type);
    return { success: true };
  });
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('two CONCURRENT presses serialize through a transaction (read+write atomic)', async () => {
  const snapshot = makeConversation({ id: 'conv-117c', starred: 0 });
  await testDb.conversations.put(snapshot);

  const { result } = renderHook(() => useOptimisticAction());

  // Fire both presses without awaiting the first — both `get`s would resolve
  // before either `update` commits if the read-modify-write isn't atomic.
  await Promise.all([
    result.current.starConversation(snapshot),
    result.current.starConversation(snapshot),
  ]);

  await waitFor(() => expect(bridgeCalls).toHaveLength(2));
  expect(bridgeCalls).toEqual(['STAR', 'UNSTAR']);
  expect((await testDb.conversations.get('conv-117c')).starred).toBe(0);
});

it('two rapid presses with a stale snapshot toggle star on then off', async () => {
  const snapshot = makeConversation({ id: 'conv-117', starred: 0 });
  await testDb.conversations.put(snapshot);

  const { result } = renderHook(() => useOptimisticAction());

  // Both calls receive the SAME stale render snapshot (starred: 0) — React
  // hasn't re-rendered between two rapid keypresses.
  await result.current.starConversation(snapshot);
  await result.current.starConversation(snapshot);

  await waitFor(() => expect(bridgeCalls).toHaveLength(2));
  expect(bridgeCalls).toEqual(['STAR', 'UNSTAR']);

  const conv = await testDb.conversations.get('conv-117');
  expect(conv.starred).toBe(0);
});
