// @vitest-environment jsdom
/**
 * Regression: a failed send in sendAndArchive left the conversation archived
 * with no rollback.
 *
 * The conversation is archived optimistically BEFORE the send. When the send
 * failed, the function only toasted and returned — never un-archived, never
 * marked the pending action failed. Net effect: message not sent, thread
 * gone from the inbox locally, server never told to archive, and the
 * stranded 'pending' row guarded the conversation from server merges
 * indefinitely. Every other failure branch in the file rolls back.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { renderHook, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

let testDb: any;
const { mockSendBridgeMessage } = vi.hoisted(() => ({ mockSendBridgeMessage: vi.fn() }));
let bridgeCalls: any[] = [];
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
  testDb = new Dexie(`TestDB_115_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.conversations.put(makeConversation({
    id: 'conv-115',
    category: 'PRIMARY_INBOX',
    archived: 0,
  }));

  bridgeCalls = [];
  bridgeResolvers = [];
  mockSendBridgeMessage.mockReset().mockImplementation((msg: any) => {
    bridgeCalls.push(msg);
    return new Promise((resolve) => bridgeResolvers.push(resolve));
  });
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

it('rolls back the optimistic archive when the send fails', async () => {
  const { result } = renderHook(() => useOptimisticAction());

  const done = result.current.sendAndArchive('conv-115', 'hello there');
  await waitFor(() => expect(bridgeCalls.some((m) => m.type === 'SEND_MESSAGE')).toBe(true));

  // The send fails.
  bridgeResolvers[bridgeCalls.findIndex((m) => m.type === 'SEND_MESSAGE')]({ success: false, error: 'nope' });
  await done;

  const conv = await testDb.conversations.get('conv-115');
  expect(conv.archived).toBe(0);
  expect(conv.category).toBe('PRIMARY_INBOX');

  // The archive action is not left stranded at 'pending' (which would guard
  // the conversation from server merges forever).
  const actions = (await testDb.pendingActions.toArray()).filter((a: any) => a.conversationId === 'conv-115');
  const archiveAction = actions.find((a: any) => a.type === 'archive');
  expect(archiveAction?.status).toBe('failed');

  // And the archive bridge call never fired.
  expect(bridgeCalls.some((m) => m.type === 'ARCHIVE')).toBe(false);
});
