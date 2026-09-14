// @vitest-environment jsdom
import '../dom-setup';
import Dexie from 'dexie';
import { act, renderHook, waitFor } from '@testing-library/react';
import { applySchema, type InflowDatabase } from '@/db/database';
import { makeMessage } from '../fixtures/factories';

let testDb: InflowDatabase;
vi.mock('@/db/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/db/database')>(),
  get db() { return testDb; },
}));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn().mockResolvedValue({ success: true }) }));

import { useThread } from '@/hooks/useThread';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_thread_${Date.now()}_${Math.random()}`) as InflowDatabase;
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

it('never displays the previous recipient messages while the next thread is loading', async () => {
  await testDb.messages.bulkPut([
    makeMessage({ conversationId: 'alice', body: 'Private to Alice' }),
    makeMessage({ conversationId: 'bob', body: 'Private to Bob' }),
  ]);
  const renders: { conversationId: string | null; messageConversations: string[] }[] = [];
  const { result, rerender } = renderHook(({ conversationId }: { conversationId: string | null }) => {
    const messages = useThread(conversationId);
    renders.push({ conversationId, messageConversations: messages.map((m) => m.conversationId) });
    return messages;
  }, { initialProps: { conversationId: 'alice' as string | null } });

  await waitFor(() => expect(result.current.map((m) => m.body)).toEqual(['Private to Alice']));
  act(() => rerender({ conversationId: 'bob' }));
  await waitFor(() => expect(result.current.map((m) => m.body)).toEqual(['Private to Bob']));
  act(() => rerender({ conversationId: null }));

  expect(result.current).toEqual([]);
  expect(renders.filter((r) => r.conversationId === 'bob').every((r) =>
    r.messageConversations.every((id) => id === 'bob')
  )).toBe(true);
});
