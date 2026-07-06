// @vitest-environment jsdom
/**
 * Regression: an unread hidden behind a merged duplicate thread was
 * unclearable.
 *
 * useConversations merges duplicate 1:1 threads (InMail + regular thread with
 * the same person) into the most recent one and surfaces the hidden twin's
 * unread flag on the primary (`if (other.read === 0) primary.read = 0`). But
 * every markRead call site only marked the PRIMARY read — the twin isn't in
 * the list, so nothing could ever clear its unread flag: the conversation
 * showed as unread forever and inflated the toolbar badge.
 *
 * Fix: markRead accepts the display-merge's mergedIds and clears any unread
 * twins through the same optimistic + bridge path.
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
  testDb = new Dexie(`TestDB_71_${Date.now()}_${Math.random()}`);
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

describe('markRead with display-merged duplicate threads', () => {
  it('also clears an unread merged twin (optimistic + bridge)', async () => {
    const participant = ['urn:li:fsd_profile:SAME_PERSON'];
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'c-primary', read: 0, participantUrns: participant }),
      makeConversation({ id: 'c-twin', read: 0, participantUrns: participant }),
    ]);
    const result = hook();

    await act(async () => {
      await result.current.markRead('c-primary', ['c-twin']);
    });

    expect((await testDb.conversations.get('c-primary')).read).toBe(1);
    expect((await testDb.conversations.get('c-twin')).read).toBe(1);
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MARK_READ', conversationId: 'c-primary' });
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MARK_READ', conversationId: 'c-twin' });
  });

  it('skips merged twins that are already read (no redundant API call)', async () => {
    await testDb.conversations.bulkPut([
      makeConversation({ id: 'c-primary2', read: 0 }),
      makeConversation({ id: 'c-twin2', read: 1 }),
    ]);
    const result = hook();

    await act(async () => {
      await result.current.markRead('c-primary2', ['c-twin2']);
    });

    const calls = sendBridgeMessage.mock.calls.map((c) => c[0].conversationId);
    expect(calls).toEqual(['c-primary2']);
  });

  it('works unchanged with no mergedIds', async () => {
    await testDb.conversations.put(makeConversation({ id: 'c-solo', read: 0 }));
    const result = hook();

    await act(async () => {
      await result.current.markRead('c-solo');
    });

    expect((await testDb.conversations.get('c-solo')).read).toBe(1);
    expect(sendBridgeMessage).toHaveBeenCalledTimes(1);
  });
});
