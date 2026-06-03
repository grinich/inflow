// @vitest-environment jsdom
// Behavioral coverage for useOptimisticAction.recallMessage, including the
// rollback path: a failed recall must restore BOTH the message and the
// conversation preview it optimistically rewound.
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
  testDb = new Dexie(`TestDB_recall_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true });
  setOnline(true);
  useUIStore.setState({ toast: null });

  await testDb.conversations.put(makeConversation({ id: 'c1', lastMessage: 'latest', lastActivityAt: 2000 }));
  await testDb.messages.bulkPut([
    makeMessage({ id: 'm-old', conversationId: 'c1', body: 'old', createdAt: 1000 }),
    makeMessage({ id: 'm-latest', conversationId: 'c1', body: 'latest', createdAt: 2000 }),
  ]);
});

afterEach(() => testDb.close());

async function recall(messageId: string) {
  const { result } = renderHook(() => useOptimisticAction());
  await act(async () => {
    await result.current.recallMessage('c1', messageId);
  });
}

it('optimistically deletes the message and rewinds the preview to the previous one', async () => {
  await recall('m-latest');
  expect(await testDb.messages.get('m-latest')).toBeUndefined();
  const conv = await testDb.conversations.get('c1');
  expect(conv.lastMessage).toBe('old');
  expect(conv.lastActivityAt).toBe(1000);
});

it('on failure restores the message AND the conversation preview', async () => {
  sendBridgeMessage.mockResolvedValue({ success: false });
  await recall('m-latest');

  // message restored
  expect(await testDb.messages.get('m-latest')).toBeDefined();

  // preview restored to the latest message (not left rewound to "old")
  const conv = await testDb.conversations.get('c1');
  expect(conv.lastMessage).toBe('latest');
  expect(conv.lastActivityAt).toBe(2000);
});
