// @vitest-environment jsdom
// The persistent, multi-conversation "Ask your network" chat: it saves each
// turn to IndexedDB, lists past chats, and can resume or delete them.
import '../dom-setup';
import { renderHook, act, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { switchDatabase, db } from '@/db/database';
import { useConnectionChat } from '@/hooks/useConnectionChat';
import { useInsightChatStore } from '@/store/insight-chat-store';

const predict = vi.fn();
vi.mock('@/hooks/useAISession', () => ({
  useAISession: () => ({ available: true, predict: (...a: any[]) => predict(...a) }),
}));
vi.mock('@/hooks/useConnections', () => ({
  useConnections: () => ({
    connections: [{ profileUrn: 'p', fullName: 'Ada', headline: 'GP', roleCategory: 'Investor' }],
    isLoading: false,
  }),
}));

beforeEach(() => {
  predict.mockReset();
  useInsightChatStore.getState().reset();
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_CHAT').catch(() => {});
});

it('persists a conversation and lists it in history', async () => {
  await switchDatabase('MEMBER_CHAT');
  predict.mockResolvedValue('Ada is an investor.');

  const { result } = renderHook(() => useConnectionChat());
  await act(async () => {
    await result.current.ask('Who are my investors?');
  });

  expect(result.current.messages).toHaveLength(2);
  expect(result.current.messages[1].content).toContain('Ada');
  await waitFor(() => expect(result.current.chats).toHaveLength(1));
  expect(result.current.chats[0].title).toContain('Who are my investors');
  expect(result.current.activeId).toBeTruthy();
});

it('new chat clears the thread; selecting a saved chat reloads it', async () => {
  await switchDatabase('MEMBER_CHAT');
  predict.mockResolvedValue('An answer.');

  const { result } = renderHook(() => useConnectionChat());
  await act(async () => {
    await result.current.ask('First question');
  });
  await waitFor(() => expect(result.current.chats).toHaveLength(1));
  const id = result.current.activeId!;

  act(() => result.current.newChat());
  expect(result.current.messages).toHaveLength(0);
  expect(result.current.activeId).toBeNull();

  await act(async () => {
    await result.current.selectChat(id);
  });
  await waitFor(() => expect(result.current.messages).toHaveLength(2));
  expect(result.current.activeId).toBe(id);
});

it('deletes a conversation from history', async () => {
  await switchDatabase('MEMBER_CHAT');
  predict.mockResolvedValue('An answer.');

  const { result } = renderHook(() => useConnectionChat());
  await act(async () => {
    await result.current.ask('A question');
  });
  await waitFor(() => expect(result.current.chats).toHaveLength(1));
  const id = result.current.chats[0].id;

  await act(async () => {
    await result.current.deleteChat(id);
  });
  await waitFor(() => expect(result.current.chats).toHaveLength(0));
});
