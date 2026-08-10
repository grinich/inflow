// @vitest-environment jsdom
// useConversationSummary loads a thread's messages, summarizes them, and writes
// the recap (with the thread's lastActivityAt) back onto the connection row.
import '../dom-setup';
import { renderHook, act, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { switchDatabase, db } from '@/db/database';
import { useConversationSummary } from '@/hooks/useConversationSummary';
import type { Connection } from '@/types/connection';

const predict = vi.fn();
vi.mock('@/hooks/useAISession', () => ({
  useAISession: () => ({ available: true, predict: (...a: any[]) => predict(...a) }),
}));

function conn(over: Partial<Connection> = {}): Connection {
  return {
    profileUrn: 'p1', connectionUrn: 'c', connectedAt: 0, publicId: '',
    firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace',
    headline: '', pictureUrl: '', syncedAt: 0, ...over,
  };
}

afterEach(async () => {
  predict.mockReset();
  await Dexie.delete('InflowDB_MEMBER_CS').catch(() => {});
});

async function seed() {
  await switchDatabase('MEMBER_CS');
  await db!.connections.put(conn());
  await db!.conversations.put({
    id: 'conv1', participantUrns: ['p1'], participantNames: ['Ada'], participantPictures: [''],
    lastMessage: 'ok', lastActivityAt: 500, read: 1, archived: 0, category: 'PRIMARY_INBOX',
  } as any);
  await db!.messages.bulkPut([
    { id: 'm1', conversationId: 'conv1', senderUrn: 'me', senderName: 'Me', senderPicture: '', body: 'Hi Ada', createdAt: 100, isFromMe: true },
    { id: 'm2', conversationId: 'conv1', senderUrn: 'p1', senderName: 'Ada', senderPicture: '', body: 'Hello!', createdAt: 200, isFromMe: false },
  ] as any);
}

it('summarizes the thread and stamps the connection with the last activity', async () => {
  await seed();
  predict.mockResolvedValue('We reconnected and said hello.');

  const { result } = renderHook(() => useConversationSummary());
  const [connection, conversation] = [await db!.connections.get('p1'), await db!.conversations.get('conv1')];
  await act(async () => {
    await result.current.summarize(connection!, conversation! as any);
  });

  const updated = await db!.connections.get('p1');
  expect(updated?.conversationSummary).toBe('We reconnected and said hello.');
  expect(updated?.conversationSummaryLastMsgAt).toBe(500);
  expect(updated?.conversationSummaryAt).toBeGreaterThan(0);
  // The prompt included both sides of the conversation.
  expect(predict.mock.calls[0][0]).toContain('Me: Hi Ada');
  expect(predict.mock.calls[0][0]).toContain('Ada Lovelace: Hello!');
});

it('surfaces an error and writes nothing when the model returns null', async () => {
  await seed();
  predict.mockResolvedValue(null);

  const { result } = renderHook(() => useConversationSummary());
  const connection = await db!.connections.get('p1');
  const conversation = await db!.conversations.get('conv1');
  await act(async () => {
    await result.current.summarize(connection!, conversation! as any);
  });

  await waitFor(() => expect(result.current.error).toBeTruthy());
  const updated = await db!.connections.get('p1');
  expect(updated?.conversationSummary).toBeUndefined();
});
