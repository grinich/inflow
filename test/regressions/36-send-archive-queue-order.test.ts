import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makeMessage, makePendingAction } from '../fixtures/factories';

let testDb: any;
const calls: string[] = [];

const mockArchiveConversation = vi.fn(async () => {
  calls.push('archive');
});
const mockSendMessage = vi.fn(async () => {
  calls.push('send');
});

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
    getDbGeneration: vi.fn(() => 0),
  };
});

vi.mock('../../entrypoints/background/api/conversations', () => ({
  archiveConversation: mockArchiveConversation,
  unarchiveConversation: vi.fn(),
  moveToOther: vi.fn(),
  moveToFocused: vi.fn(),
  moveToSpam: vi.fn(),
  markConversationRead: vi.fn(),
  markConversationUnread: vi.fn(),
  deleteConversation: vi.fn(),
  starConversation: vi.fn(),
  unstarConversation: vi.fn(),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  sendMessage: mockSendMessage,
  editMessage: vi.fn(),
  reactWithEmoji: vi.fn(),
  recallMessage: vi.fn(),
}));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  recordMarkRead: vi.fn(),
  recordMutation: vi.fn(),
}));

vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
}));

beforeEach(async () => {
  testDb = new Dexie(`SendArchiveQueue_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  calls.length = 0;
  mockArchiveConversation.mockClear();
  mockSendMessage.mockClear();
  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('replays offline send+archive as send first, then archive', async () => {
  const { drainActionQueue } = await import('../../entrypoints/background/action-queue');
  const conversationId = 'conv-send-archive';
  const tempMessageId = 'temp-send-archive';

  await testDb.messages.put(makeMessage({
    id: tempMessageId,
    conversationId,
    body: 'queued body',
    status: 'queued',
    isFromMe: true,
  }));

  await testDb.pendingActions.bulkPut([
    makePendingAction({
      id: 'archive-first-timestamp',
      type: 'archive',
      conversationId,
      status: 'queued',
      timestamp: 100,
      bridgeMessage: { type: 'ARCHIVE', conversationId },
    }),
    makePendingAction({
      id: 'send-second-timestamp',
      type: 'send',
      conversationId,
      status: 'queued',
      timestamp: 200,
      tempMessageId,
      bridgeMessage: { type: 'SEND_MESSAGE', conversationId, body: 'queued body' },
    }),
  ]);

  await drainActionQueue();

  expect(calls).toEqual(['send', 'archive']);
});
