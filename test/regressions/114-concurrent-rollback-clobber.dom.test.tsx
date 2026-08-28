// @vitest-environment jsdom
/**
 * Regression: a failed reaction/edit rolled back by writing its own
 * pre-action snapshot wholesale, clobbering a CONCURRENT successful change.
 *
 * reactToMessage serialized the optimistic read-modify-write in a
 * transaction, but the failure path wrote back `oldReactions` — the state
 * before ITS OWN change. React 👍 then ❤️ in quick succession: if the 👍
 * call fails after the ❤️ call succeeded, the rollback wrote the pre-👍
 * state ([]) and wiped the ❤️ that succeeded. editMessage had the identical
 * shape: two rapid edits, the first fails, and the rollback reverted the
 * message to the ORIGINAL body, losing the second successful edit.
 *
 * Fix: rollbacks are now conditional deltas against current state — undo
 * only your own change, and only if it is still in place.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { renderHook, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation, makeMessage } from '../fixtures/factories';

let testDb: any;
const { mockSendBridgeMessage } = vi.hoisted(() => ({ mockSendBridgeMessage: vi.fn() }));
let bridgeResolvers: Array<(value: any) => void> = [];

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
  testDb = new Dexie(`TestDB_114_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.conversations.put(makeConversation({ id: 'conv-114' }));
  await testDb.messages.put(makeMessage({
    id: 'msg-114',
    conversationId: 'conv-114',
    body: 'original body',
    isFromMe: true,
    createdAt: Date.now(),
  }));

  bridgeResolvers = [];
  mockSendBridgeMessage.mockReset().mockImplementation(
    () => new Promise((resolve) => bridgeResolvers.push(resolve))
  );
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  for (const resolve of bridgeResolvers) resolve({ success: true });
  await Promise.resolve();
  await Promise.resolve();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('a failed reaction does not wipe a concurrent successful reaction', async () => {
  const { result } = renderHook(() => useOptimisticAction());

  await result.current.reactToMessage('conv-114', 'msg-114', '👍'); // bridge 0, pending
  await result.current.reactToMessage('conv-114', 'msg-114', '❤️'); // bridge 1, pending
  expect(bridgeResolvers).toHaveLength(2);

  bridgeResolvers[1]({ success: true });   // ❤️ succeeds
  bridgeResolvers[0]({ success: false });  // 👍 fails → rollback

  await waitFor(async () => {
    const actions = await testDb.pendingActions.toArray();
    expect(actions.map((a: any) => a.status).sort()).toEqual(['confirmed', 'failed']);
  });

  const msg = await testDb.messages.get('msg-114');
  const emojis = (msg.reactions ?? []).map((r: any) => r.emoji);
  expect(emojis).toContain('❤️');
  expect(emojis).not.toContain('👍');
});

it('a failed edit does not revert a concurrent successful edit', async () => {
  const { result } = renderHook(() => useOptimisticAction());

  const edit1 = result.current.editMessage('conv-114', 'msg-114', 'first edit');
  await waitFor(() => expect(bridgeResolvers).toHaveLength(1));
  const edit2 = result.current.editMessage('conv-114', 'msg-114', 'second edit');
  await waitFor(() => expect(bridgeResolvers).toHaveLength(2));

  bridgeResolvers[1]({ success: true });   // second edit lands
  bridgeResolvers[0]({ success: false });  // first edit fails → rollback
  await Promise.all([edit1, edit2]);

  const msg = await testDb.messages.get('msg-114');
  expect(msg.body).toBe('second edit');
});
