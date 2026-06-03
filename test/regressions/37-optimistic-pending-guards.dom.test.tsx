// @vitest-environment jsdom
import '../dom-setup';

import Dexie from 'dexie';
import { act, renderHook, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation, makeMessage } from '../fixtures/factories';

let testDb: any;
const mockSendBridgeMessage = vi.fn();
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

beforeEach(async () => {
  testDb = new Dexie(`OptimisticGuards_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.conversations.put(makeConversation({
    id: 'conv-guard',
    read: 0,
    starred: 0,
  }));
  await testDb.messages.put(makeMessage({
    id: 'msg-guard',
    conversationId: 'conv-guard',
    body: 'old body',
    isFromMe: true,
  }));

  bridgeResolvers = [];
  mockSendBridgeMessage.mockReset().mockImplementation(() =>
    new Promise((resolve) => {
      bridgeResolvers.push(resolve);
    })
  );
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  for (const resolve of bridgeResolvers) {
    resolve({ success: true });
  }
  await Promise.resolve();
  await Promise.resolve();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function pendingTypesForConversation(conversationId: string): Promise<string[]> {
  const actions = await testDb.pendingActions
    .filter((action: any) => action.conversationId === conversationId)
    .toArray();
  return actions.map((action: any) => `${action.type}:${action.status}`);
}

describe('online optimistic mutations', () => {
  it.each([
    ['markRead', 'markRead', async (actions: any) => actions.markRead('conv-guard')],
    ['star', 'star', async (actions: any) => actions.starConversation(await testDb.conversations.get('conv-guard'))],
    ['delete', 'delete', async (actions: any) => actions.deleteConversation(await testDb.conversations.get('conv-guard'))],
    ['edit_message', 'edit_message', async (actions: any) => {
      void actions.editMessage('conv-guard', 'msg-guard', 'new body');
      await waitFor(() => expect(mockSendBridgeMessage).toHaveBeenCalled());
    }],
    ['react_emoji', 'react_emoji', async (actions: any) => actions.reactToMessage('conv-guard', 'msg-guard', '👍')],
    ['recall_message', 'recall_message', async (actions: any) => actions.recallMessage('conv-guard', 'msg-guard')],
  ])('creates a pendingAction guard while %s is in flight', async (_label, expectedType, runAction) => {
    const { useOptimisticAction } = await import('@/hooks/useOptimisticAction');
    const { result } = renderHook(() => useOptimisticAction());

    await act(async () => {
      await runAction(result.current);
    });

    const pendingTypes = await pendingTypesForConversation('conv-guard');
    expect(pendingTypes).toContain(`${expectedType}:pending`);
  });
});
