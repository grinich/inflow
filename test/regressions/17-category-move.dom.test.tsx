// @vitest-environment jsdom
// Characterization tests for the optimistic category-move actions
// (moveToFocused / moveToOther / moveToSpam) in useOptimisticAction, locking in
// behavior before they are refactored onto a shared helper: optimistic DB patch,
// pendingAction creation, success-confirm, failure-rollback, offline queueing,
// and undo (restore + inverse bridge based on previousCategory).
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
import { makeConversation } from '../fixtures/factories';

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_catmove_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true });
  setOnline(true);
  useUIStore.setState({ toast: null });
});

afterEach(() => {
  testDb.close();
});

function hook() {
  return renderHook(() => useOptimisticAction()).result;
}

describe('moveToOther', () => {
  it('optimistically sets SECONDARY_INBOX, records a pending action, then confirms', async () => {
    const conv = makeConversation({ id: 'c1', category: 'PRIMARY_INBOX' });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToOther(conv);
    });

    expect((await testDb.conversations.get('c1')).category).toBe('SECONDARY_INBOX');
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MOVE_TO_OTHER', conversationId: 'c1' });
    const actions = await testDb.pendingActions.toArray();
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('move_to_other');
    expect(actions[0].status).toBe('confirmed');
    // moveToOther now clears `archived` (see regression 66), so the rollback
    // snapshot includes the prior archived state.
    expect(actions[0].rollbackData).toEqual({ archived: 0, category: 'PRIMARY_INBOX' });
  });

  it('rolls back to the previous category when the server rejects', async () => {
    sendBridgeMessage.mockResolvedValue({ success: false });
    const conv = makeConversation({ id: 'c1', category: 'PRIMARY_INBOX' });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToOther(conv);
    });

    expect((await testDb.conversations.get('c1')).category).toBe('PRIMARY_INBOX');
    expect((await testDb.pendingActions.toArray())[0].status).toBe('failed');
  });

  it('queues for replay (no bridge call) when offline', async () => {
    setOnline(false);
    const conv = makeConversation({ id: 'c1', category: 'PRIMARY_INBOX' });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToOther(conv);
    });

    expect(sendBridgeMessage).not.toHaveBeenCalled();
    const action = (await testDb.pendingActions.toArray())[0];
    expect(action.status).toBe('queued');
    expect(action.bridgeMessage).toEqual({ type: 'MOVE_TO_OTHER', conversationId: 'c1' });
  });

  it('undo restores the previous category and sends the inverse bridge', async () => {
    const conv = makeConversation({ id: 'c1', category: 'SPAM' });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToOther(conv);
    });
    sendBridgeMessage.mockClear();

    const undo = useUIStore.getState().toast!.undoAction!;
    await act(async () => {
      await undo();
    });

    expect((await testDb.conversations.get('c1')).category).toBe('SPAM');
    // Previous category was SPAM → inverse bridge re-applies it.
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MOVE_TO_SPAM', conversationId: 'c1' });
    expect(await testDb.pendingActions.count()).toBe(0);
  });
});

describe('moveToFocused', () => {
  it('sets PRIMARY_INBOX + archived=0 and preserves prior archived state in rollbackData', async () => {
    const conv = makeConversation({ id: 'c1', category: 'ARCHIVE', archived: 1 });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToFocused(conv);
    });

    const stored = await testDb.conversations.get('c1');
    expect(stored.category).toBe('PRIMARY_INBOX');
    expect(stored.archived).toBe(0);
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MOVE_TO_FOCUSED', conversationId: 'c1' });
    const action = (await testDb.pendingActions.toArray())[0];
    expect(action.type).toBe('move_to_focused');
    expect(action.rollbackData).toEqual({ archived: 1, category: 'ARCHIVE' });
  });

  it('undo of a previously-archived conversation re-archives it', async () => {
    const conv = makeConversation({ id: 'c1', category: 'ARCHIVE', archived: 1 });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToFocused(conv);
    });
    sendBridgeMessage.mockClear();

    const undo = useUIStore.getState().toast!.undoAction!;
    await act(async () => {
      await undo();
    });

    const stored = await testDb.conversations.get('c1');
    expect(stored.category).toBe('ARCHIVE');
    expect(stored.archived).toBe(1);
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'ARCHIVE', conversationId: 'c1' });
  });
});

describe('moveToSpam', () => {
  it('sets SPAM, records move_to_spam, confirms', async () => {
    const conv = makeConversation({ id: 'c1', category: 'SECONDARY_INBOX' });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToSpam(conv);
    });

    expect((await testDb.conversations.get('c1')).category).toBe('SPAM');
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MOVE_TO_SPAM', conversationId: 'c1' });
    const action = (await testDb.pendingActions.toArray())[0];
    expect(action.type).toBe('move_to_spam');
    expect(action.status).toBe('confirmed');
  });

  it('undo restores SECONDARY_INBOX and sends MOVE_TO_OTHER', async () => {
    const conv = makeConversation({ id: 'c1', category: 'SECONDARY_INBOX' });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToSpam(conv);
    });
    sendBridgeMessage.mockClear();

    const undo = useUIStore.getState().toast!.undoAction!;
    await act(async () => {
      await undo();
    });

    expect((await testDb.conversations.get('c1')).category).toBe('SECONDARY_INBOX');
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MOVE_TO_OTHER', conversationId: 'c1' });
  });
});
