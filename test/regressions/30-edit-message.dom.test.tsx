// @vitest-environment jsdom
// Behavioral coverage for useOptimisticAction.editMessage: optimistic body/editedAt
// update, failure rollback, offline queueing, and the no-op for a missing message.
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
  testDb = new Dexie(`TestDB_edit_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true });
  setOnline(true);
  useUIStore.setState({ toast: null });
  await testDb.messages.put(makeMessage({ id: 'm1', conversationId: 'c1', body: 'original', editedAt: undefined }));
});

afterEach(() => testDb.close());

async function edit(messageId: string, body: string) {
  const { result } = renderHook(() => useOptimisticAction());
  let ok: boolean | undefined;
  await act(async () => {
    ok = await result.current.editMessage('c1', messageId, body);
  });
  return ok;
}

it('optimistically updates body and stamps editedAt', async () => {
  const ok = await edit('m1', 'edited text');
  expect(ok).toBe(true);
  const m = await testDb.messages.get('m1');
  expect(m.body).toBe('edited text');
  expect(typeof m.editedAt).toBe('number');
  expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'EDIT_MESSAGE', conversationId: 'c1', messageId: 'm1', body: 'edited text' });
});

it('rolls back body and editedAt when the server rejects', async () => {
  sendBridgeMessage.mockResolvedValue({ success: false });
  const ok = await edit('m1', 'edited text');
  expect(ok).toBe(false);
  const m = await testDb.messages.get('m1');
  expect(m.body).toBe('original');
  expect(m.editedAt).toBeUndefined();
});

it('queues the edit when offline and keeps the optimistic change', async () => {
  setOnline(false);
  const ok = await edit('m1', 'offline edit');
  expect(ok).toBe(true);
  expect(sendBridgeMessage).not.toHaveBeenCalled();
  expect((await testDb.messages.get('m1')).body).toBe('offline edit');
  const actions = await testDb.pendingActions.toArray();
  expect(actions).toHaveLength(1);
  expect(actions[0].type).toBe('edit_message');
  expect(actions[0].status).toBe('queued');
});

it('returns false for a missing message without calling the bridge', async () => {
  const ok = await edit('nope', 'x');
  expect(ok).toBe(false);
  expect(sendBridgeMessage).not.toHaveBeenCalled();
});
