// @vitest-environment jsdom
// Behavioral coverage for useRemoteSearch: debounce, cursor pagination
// (append + dedup), no-op without a cursor, reading conversations from the DB by
// id, and reset/cancel on query change. Uses real timers (the debounce is 400ms);
// fake timers deadlock against Dexie's live query + RTL waitFor.
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

import { renderHook, act, waitFor } from '@testing-library/react';
import { useRemoteSearch } from '@/hooks/useRemoteSearch';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_remote_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockReset();
  useUIStore.setState({ searchQuery: '' });
});

afterEach(() => testDb.close());

const ids = (r: any) => r.current.remoteResults.map((c: any) => c.id);

it('debounces, fires SEARCH_CONVERSATIONS, reads results from the DB, exposes hasMore', async () => {
  await testDb.conversations.bulkPut([makeConversation({ id: 'r1' }), makeConversation({ id: 'r2' })]);
  sendBridgeMessage.mockResolvedValue({ success: true, data: { conversationIds: ['r1', 'r2'], nextCursor: 'CUR1' } });

  const { result } = renderHook(() => useRemoteSearch());
  act(() => useUIStore.setState({ searchQuery: 'ada' }));

  await waitFor(() => expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'SEARCH_CONVERSATIONS', query: 'ada' }), { timeout: 2000 });
  await waitFor(() => expect(ids(result)).toEqual(['r1', 'r2']));
  expect(result.current.hasMore).toBe(true);
});

it('loadMore appends the next page and de-dupes overlapping ids', async () => {
  await testDb.conversations.bulkPut([
    makeConversation({ id: 'p1' }), makeConversation({ id: 'p2' }), makeConversation({ id: 'p3' }),
  ]);
  sendBridgeMessage
    .mockResolvedValueOnce({ success: true, data: { conversationIds: ['p1', 'p2'], nextCursor: 'CUR2' } })
    .mockResolvedValueOnce({ success: true, data: { conversationIds: ['p2', 'p3', 'p3'], nextCursor: null } });

  const { result } = renderHook(() => useRemoteSearch());
  act(() => useUIStore.setState({ searchQuery: 'x' }));
  await waitFor(() => expect(ids(result)).toEqual(['p1', 'p2']), { timeout: 2000 });
  expect(result.current.hasMore).toBe(true);

  await act(async () => { await result.current.loadMore(); });

  expect(sendBridgeMessage).toHaveBeenLastCalledWith({ type: 'SEARCH_CONVERSATIONS', query: 'x', cursor: 'CUR2' });
  await waitFor(() => expect(ids(result)).toEqual(['p1', 'p2', 'p3']));
  expect(result.current.hasMore).toBe(false);
});

it('loadMore is a no-op when there is no cursor', async () => {
  await testDb.conversations.bulkPut([makeConversation({ id: 'p1' })]);
  sendBridgeMessage.mockResolvedValue({ success: true, data: { conversationIds: ['p1'], nextCursor: null } });

  const { result } = renderHook(() => useRemoteSearch());
  act(() => useUIStore.setState({ searchQuery: 'x' }));
  await waitFor(() => expect(ids(result)).toEqual(['p1']), { timeout: 2000 });

  sendBridgeMessage.mockClear();
  await act(async () => { await result.current.loadMore(); });
  expect(sendBridgeMessage).not.toHaveBeenCalled();
});

it('reflects the latest query after a rapid change (debounce cancel)', async () => {
  await testDb.conversations.bulkPut([makeConversation({ id: 'old1' }), makeConversation({ id: 'new1' })]);
  sendBridgeMessage.mockImplementation(async (m: any) =>
    m.query === 'new'
      ? { success: true, data: { conversationIds: ['new1'], nextCursor: null } }
      : { success: true, data: { conversationIds: ['old1'], nextCursor: null } },
  );

  const { result } = renderHook(() => useRemoteSearch());
  act(() => useUIStore.setState({ searchQuery: 'old' }));
  act(() => useUIStore.setState({ searchQuery: 'new' }));

  await waitFor(() => expect(ids(result)).toEqual(['new1']), { timeout: 2000 });
});

it('clearing the query resets results and hasMore', async () => {
  await testDb.conversations.bulkPut([makeConversation({ id: 'p1' })]);
  sendBridgeMessage.mockResolvedValue({ success: true, data: { conversationIds: ['p1'], nextCursor: 'C' } });

  const { result } = renderHook(() => useRemoteSearch());
  act(() => useUIStore.setState({ searchQuery: 'x' }));
  await waitFor(() => expect(ids(result)).toEqual(['p1']), { timeout: 2000 });

  act(() => useUIStore.setState({ searchQuery: '' }));
  await waitFor(() => expect(ids(result)).toEqual([]));
  expect(result.current.hasMore).toBe(false);
});

it('discards an in-flight response after search is cleared', async () => {
  await testDb.conversations.put(makeConversation({ id: 'late' }));
  let resolveSearch!: (response: unknown) => void;
  sendBridgeMessage.mockReturnValue(new Promise((resolve) => { resolveSearch = resolve; }));

  const { result } = renderHook(() => useRemoteSearch());
  act(() => useUIStore.setState({ searchQuery: 'old' }));
  await waitFor(() => expect(sendBridgeMessage).toHaveBeenCalledTimes(1));

  act(() => useUIStore.setState({ searchQuery: '' }));
  await act(async () => {
    resolveSearch({ success: true, data: { conversationIds: ['late'], nextCursor: 'STALE' } });
  });

  expect(ids(result)).toEqual([]);
  expect(result.current.hasMore).toBe(false);
  expect(result.current.isSearching).toBe(false);
});

it('lets a new search paginate while the previous search page is still pending', async () => {
  await testDb.conversations.bulkPut(['old', 'new', 'new-page'].map((id) => makeConversation({ id })));
  let resolveOldPage!: (response: unknown) => void;
  let resolveNewPage!: (response: unknown) => void;
  sendBridgeMessage
    .mockResolvedValueOnce({ success: true, data: { conversationIds: ['old'], nextCursor: 'OLD' } })
    .mockReturnValueOnce(new Promise((resolve) => { resolveOldPage = resolve; }))
    .mockResolvedValueOnce({ success: true, data: { conversationIds: ['new'], nextCursor: 'NEW' } })
    .mockReturnValueOnce(new Promise((resolve) => { resolveNewPage = resolve; }));

  const { result } = renderHook(() => useRemoteSearch());
  act(() => useUIStore.setState({ searchQuery: 'old query' }));
  await waitFor(() => expect(ids(result)).toEqual(['old']));
  let oldPage!: Promise<void>;
  act(() => { oldPage = result.current.loadMore(); });

  act(() => useUIStore.setState({ searchQuery: 'new query' }));
  await waitFor(() => expect(ids(result)).toEqual(['new']));
  let newPage!: Promise<void>;
  act(() => { newPage = result.current.loadMore(); });
  expect(sendBridgeMessage).toHaveBeenLastCalledWith({ type: 'SEARCH_CONVERSATIONS', query: 'new query', cursor: 'NEW' });

  await act(async () => {
    resolveOldPage({ success: true, data: { conversationIds: ['old'], nextCursor: null } });
    await oldPage;
    // The old request must not unlock the new search's pending pagination.
    await result.current.loadMore();
  });
  expect(sendBridgeMessage).toHaveBeenCalledTimes(4);
  expect(result.current.isSearching).toBe(true);
  expect(ids(result)).toEqual(['new']);

  await act(async () => {
    resolveNewPage({ success: true, data: { conversationIds: ['new-page'], nextCursor: null } });
    await newPage;
  });
  await waitFor(() => expect(ids(result)).toEqual(['new', 'new-page']));
  expect(result.current.isSearching).toBe(false);
});
