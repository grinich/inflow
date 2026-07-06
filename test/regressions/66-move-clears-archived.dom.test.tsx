// @vitest-environment jsdom
/**
 * Regression: moving an archived conversation to Other/Spam left it in BOTH
 * tabs.
 *
 * moveToFocused cleared the `archived` flag, but moveToOther/moveToSpam only
 * set `category` — an archived conversation moved to Other kept archived=1 and
 * appeared in both the Other tab (category index) and the Archived tab
 * (archived index) until a server merge happened to fix it.
 *
 * Fix: all category moves keep the flag/category pair consistent; undo restores
 * the prior archived state via rollbackData.
 */
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

beforeEach(async () => {
  testDb = new Dexie(`TestDB_66_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useUIStore.setState({ toast: null });
});

afterEach(() => {
  testDb.close();
});

function hook() {
  return renderHook(() => useOptimisticAction()).result;
}

describe('moveToOther on an archived conversation', () => {
  it('clears archived so the conversation is not in Other AND Archived', async () => {
    const conv = makeConversation({ id: 'c1', category: 'ARCHIVE', archived: 1 });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToOther(conv);
    });

    const stored = await testDb.conversations.get('c1');
    expect(stored.category).toBe('SECONDARY_INBOX');
    expect(stored.archived).toBe(0);
  });

  it('undo restores the prior archived state', async () => {
    const conv = makeConversation({ id: 'c1', category: 'ARCHIVE', archived: 1 });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToOther(conv);
    });

    const undo = useUIStore.getState().toast!.undoAction!;
    await act(async () => {
      await undo();
    });

    const stored = await testDb.conversations.get('c1');
    expect(stored.category).toBe('ARCHIVE');
    expect(stored.archived).toBe(1);
  });
});

describe('moveToSpam on an archived conversation', () => {
  it('clears archived so the conversation is not in Spam AND Archived', async () => {
    const conv = makeConversation({ id: 'c2', category: 'ARCHIVE', archived: 1 });
    await testDb.conversations.put(conv);
    const result = hook();

    await act(async () => {
      await result.current.moveToSpam(conv);
    });

    const stored = await testDb.conversations.get('c2');
    expect(stored.category).toBe('SPAM');
    expect(stored.archived).toBe(0);
  });
});
