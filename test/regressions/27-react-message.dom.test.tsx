// @vitest-environment jsdom
// Behavioral coverage for useOptimisticAction.reactToMessage — the optimistic
// emoji toggle/increment/decrement/remove logic and failure rollback.
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

const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...args: any[]) => sendBridgeMessage(...args),
}));

import { renderHook, act } from '@testing-library/react';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useUIStore } from '@/store/ui-store';
import { makeMessage } from '../fixtures/factories';

function setOnline(v: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_react_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true });
  setOnline(true);
  useUIStore.setState({ toast: null });
});

afterEach(() => testDb.close());

async function react(messageId: string, emoji: string) {
  const { result } = renderHook(() => useOptimisticAction());
  await act(async () => {
    await result.current.reactToMessage('c1', messageId, emoji);
  });
}

async function seed(reactions?: any[]) {
  await testDb.messages.put(makeMessage({ id: 'm1', conversationId: 'c1', reactions }));
}

it('adds a new reaction (count 1, viewerReacted)', async () => {
  await seed(undefined);
  await react('m1', '👍');
  const m = await testDb.messages.get('m1');
  expect(m.reactions).toEqual([{ emoji: '👍', count: 1, firstReactedAt: expect.any(Number), viewerReacted: true }]);
  expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'REACT_EMOJI', conversationId: 'c1', messageId: 'm1', emoji: '👍' });
});

it('increments an existing reaction the viewer had not reacted to', async () => {
  await seed([{ emoji: '👍', count: 1, firstReactedAt: 5, viewerReacted: false }]);
  await react('m1', '👍');
  const m = await testDb.messages.get('m1');
  expect(m.reactions).toEqual([{ emoji: '👍', count: 2, firstReactedAt: 5, viewerReacted: true }]);
});

it('removes the pill when toggling off the viewer\'s only reaction (count 1)', async () => {
  await seed([{ emoji: '👍', count: 1, firstReactedAt: 5, viewerReacted: true }]);
  await react('m1', '👍');
  const m = await testDb.messages.get('m1');
  expect(m.reactions).toBeUndefined();
});

it('decrements (keeps pill) when toggling off but others still reacted (count 2)', async () => {
  await seed([{ emoji: '👍', count: 2, firstReactedAt: 5, viewerReacted: true }]);
  await react('m1', '👍');
  const m = await testDb.messages.get('m1');
  expect(m.reactions).toEqual([{ emoji: '👍', count: 1, firstReactedAt: 5, viewerReacted: false }]);
});

it('leaves other emoji untouched when reacting with a new one', async () => {
  await seed([{ emoji: '❤️', count: 1, firstReactedAt: 5, viewerReacted: true }]);
  await react('m1', '👍');
  const m = await testDb.messages.get('m1');
  expect(m.reactions).toHaveLength(2);
  expect(m.reactions.find((r: any) => r.emoji === '❤️')).toEqual({ emoji: '❤️', count: 1, firstReactedAt: 5, viewerReacted: true });
});

it('rolls back to the previous reactions when the server rejects', async () => {
  sendBridgeMessage.mockResolvedValue({ success: false });
  await seed([{ emoji: '👍', count: 1, firstReactedAt: 5, viewerReacted: false }]);
  await react('m1', '👍'); // would optimistically increment to 2
  const m = await testDb.messages.get('m1');
  expect(m.reactions).toEqual([{ emoji: '👍', count: 1, firstReactedAt: 5, viewerReacted: false }]);
});

it('does nothing for a missing message', async () => {
  await react('nope', '👍');
  expect(sendBridgeMessage).not.toHaveBeenCalled();
});
