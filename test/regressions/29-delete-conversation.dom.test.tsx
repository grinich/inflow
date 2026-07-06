// @vitest-environment jsdom
// Behavioral coverage for useOptimisticAction.deleteConversation: atomic
// optimistic delete (conversation + its messages + syncQueue row), full restore
// on failure, and offline queueing.
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
import { makeConversation, makeMessage } from '../fixtures/factories';

function setOnline(v: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_del_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true });
  setOnline(true);
  useUIStore.setState({ toast: null });

  await testDb.conversations.bulkPut([
    makeConversation({ id: 'c1' }),
    makeConversation({ id: 'c2' }),
  ]);
  await testDb.messages.bulkPut([
    makeMessage({ id: 'm1', conversationId: 'c1', body: 'a' }),
    makeMessage({ id: 'm2', conversationId: 'c1', body: 'b' }),
    makeMessage({ id: 'm3', conversationId: 'c2', body: 'other' }),
  ]);
  await testDb.syncQueue.put({ conversationId: 'c1', status: 'done', failCount: 0 });
});

afterEach(() => testDb.close());

async function del(id: string) {
  const conv = await testDb.conversations.get(id);
  const { result } = renderHook(() => useOptimisticAction());
  await act(async () => {
    await result.current.deleteConversation(conv);
  });
}

it('optimistically removes the conversation, its messages, and its syncQueue row only', async () => {
  await del('c1');
  expect(await testDb.conversations.get('c1')).toBeUndefined();
  expect(await testDb.messages.where('conversationId').equals('c1').count()).toBe(0);
  expect(await testDb.syncQueue.get('c1')).toBeUndefined();
  // c2 and its message are untouched
  expect(await testDb.conversations.get('c2')).toBeDefined();
  expect(await testDb.messages.get('m3')).toBeDefined();
});

it('restores conversation, messages, and syncQueue row on failure', async () => {
  sendBridgeMessage.mockResolvedValue({ success: false });
  await del('c1');

  // The bridge reconciliation (and therefore the restore) is fire-and-forget —
  // wait for it to land rather than racing its microtask chain.
  await vi.waitFor(async () => {
    expect(await testDb.conversations.get('c1')).toBeDefined();
  });
  const msgs = await testDb.messages.where('conversationId').equals('c1').toArray();
  expect(msgs.map((m: any) => m.id).sort()).toEqual(['m1', 'm2']);
  expect(await testDb.syncQueue.get('c1')).toBeDefined();
  // The delete tombstone must be gone, or sync would refuse to re-merge the
  // restored conversation.
  expect(await testDb.tombstones.get('c1')).toBeUndefined();
});

it('queues a delete action when offline (no bridge call)', async () => {
  setOnline(false);
  await del('c1');

  expect(sendBridgeMessage).not.toHaveBeenCalled();
  expect(await testDb.conversations.get('c1')).toBeUndefined(); // optimistic delete stands
  const actions = await testDb.pendingActions.toArray();
  expect(actions).toHaveLength(1);
  expect(actions[0].type).toBe('delete');
  expect(actions[0].status).toBe('queued');
});
