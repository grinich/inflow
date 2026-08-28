// @vitest-environment jsdom
/**
 * Regression: a failed delete persisted UI-only display state into IndexedDB.
 *
 * deleteConversation restored with `db.conversations.put(conversation)` on
 * the caller's object — which comes from useConversations, where the 1:1
 * display merge mutates rows in place (primary.read = 0, primary.starred = 1,
 * primary.mergedIds = [...]). mergedIds is documented as "computed at query
 * time, not persisted". Deleting a display-merged conversation and having
 * the server reject it wrote the twin's read/starred values and a stale
 * mergedIds array into the stored row — the thread came back unread though
 * it was read.
 *
 * Fix: snapshot the STORED row before deleting and restore that.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { renderHook, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

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
  testDb = new Dexie(`TestDB_116_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();

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

it('restores the stored row, not the display-merged object, when a delete fails', async () => {
  const stored = makeConversation({ id: 'conv-116', read: 1, starred: 0 });
  await testDb.conversations.put(stored);

  // What useConversations hands the UI after an in-place display merge.
  const displayMerged = { ...stored, read: 0, starred: 1, mergedIds: ['2-twin'] };

  const { result } = renderHook(() => useOptimisticAction());
  const done = result.current.deleteConversation(displayMerged as any);

  await waitFor(() => expect(bridgeResolvers).toHaveLength(1));
  bridgeResolvers[0]({ success: false, error: 'server said no' });
  await done;

  await waitFor(async () => {
    expect(await testDb.conversations.get('conv-116')).toBeTruthy();
  });
  const restored = await testDb.conversations.get('conv-116');
  expect(restored.read).toBe(1);
  expect(restored.starred).toBe(0);
  expect('mergedIds' in restored).toBe(false);
});
