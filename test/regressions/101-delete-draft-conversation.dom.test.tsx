// @vitest-environment jsdom
/**
 * Regression: a draft conversation could not be deleted — ever.
 *
 * Editing an Outbox draft converts it into a local conversation with draft: 1
 * (and deletes the scheduledMessages row, so it also leaves the Outbox).
 * deleteConversation then sent DELETE_CONVERSATION to LinkedIn like any other
 * thread — but LinkedIn has no such conversation, so the call failed, the
 * optimistic delete rolled back, and the user got "Failed to delete —
 * restored". There was no other route to remove it, so the row was stuck in
 * Primary permanently.
 *
 * Fix: a draft conversation is local-only, so delete it locally and never
 * touch the bridge. Its draftAttachments row goes too, rather than orphaning.
 */
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { settleOptimistic } from '../helpers/settle';

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

import { renderHook, act, waitFor } from '@testing-library/react';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_101_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  // LinkedIn rejects a conversation it has never seen — what made this stick.
  sendBridgeMessage.mockResolvedValue({ success: false, error: 'Failed to delete conversation: 404' });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useUIStore.setState({ toast: null });
});

afterEach(async () => {
  await settleOptimistic(testDb);
  testDb.close();
});

function hook() {
  return renderHook(() => useOptimisticAction()).result;
}

it('deletes a draft conversation locally, without asking LinkedIn', async () => {
  const conv = makeConversation({ id: 'draft-1', draft: 1 });
  await testDb.conversations.put(conv);
  await testDb.draftAttachments.put({
    conversationId: 'draft-1',
    text: 'unsent body',
    files: [],
    names: [],
    types: [],
  });
  const result = hook();

  await act(async () => {
    await result.current.deleteConversation(conv);
  });

  expect(await testDb.conversations.get('draft-1')).toBeUndefined();
  // The unsent body went with it instead of orphaning.
  expect(await testDb.draftAttachments.get('draft-1')).toBeUndefined();
  // The bridge was never involved, so there is nothing to fail and roll back.
  expect(sendBridgeMessage).not.toHaveBeenCalled();
  expect(useUIStore.getState().toast?.message).toBe('Draft deleted');
});

it('still sends a real conversation to LinkedIn, and still rolls back on failure', async () => {
  const conv = makeConversation({ id: 'c1' });
  await testDb.conversations.put(conv);
  const result = hook();

  await act(async () => {
    await result.current.deleteConversation(conv);
  });

  expect(sendBridgeMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'DELETE_CONVERSATION', conversationId: 'c1' }),
  );
  // The rollback path is what the draft fix must not disturb. It runs off an
  // un-awaited promise chain, so wait for it rather than asserting straight
  // after act() — and so it finishes before teardown closes the database.
  await waitFor(async () => {
    expect(await testDb.conversations.get('c1')).toBeTruthy();
  });
  expect(useUIStore.getState().toast?.message).toBe('Failed to delete — restored');
});
