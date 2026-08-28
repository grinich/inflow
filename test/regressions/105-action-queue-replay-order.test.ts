/**
 * Regression: the offline queue's replay ordering could run a category
 * mutation before that conversation's queued send.
 *
 * orderQueuedActions was an Array.sort comparator that applied the
 * send-before-category-move priority only when both actions shared a
 * conversation, falling back to timestamps otherwise. That relation is not
 * transitive — with interleaved conversations it forms comparison cycles
 * (send₁ < archive₁ by priority, archive₁ < send₂ by time, send₂ < send₁ by
 * time) — and JS sort gives no ordering guarantees for an inconsistent
 * comparator. Concretely, [archive(c1,t1), send(c2,t2), send(c1,t3)] replayed
 * c1's archive BEFORE c1's send, so LinkedIn's implicit move-back-to-Focused
 * on the send clobbered the user's final folder state — the exact case the
 * priority rule exists to prevent.
 *
 * Fix: order per conversation (stable partition: sends first, then original
 * timestamp order) and reassemble into the global timestamp sequence, instead
 * of one intransitive comparator.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makePendingAction, resetFactories } from '../fixtures/factories';
import type { Message } from '@/types/message';

const calls: string[] = [];

const mockArchive = vi.fn(async (convId: string) => { calls.push(`archive:${convId}`); });
const mockSendMessage = vi.fn(async (convId: string) => { calls.push(`send:${convId}`); });

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('../../entrypoints/background/api/conversations', () => ({
  archiveConversation: (...args: any[]) => mockArchive(args[0]),
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
  sendMessage: (...args: any[]) => mockSendMessage(args[0]),
  editMessage: vi.fn(),
  reactWithEmoji: vi.fn(),
  recallMessage: vi.fn(),
}));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  recordMarkRead: vi.fn(),
  recordMutation: vi.fn(),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { drainActionQueue } from '../../entrypoints/background/action-queue';

function makeQueuedTemp(id: string, conversationId: string): Message {
  return {
    id,
    conversationId,
    senderUrn: 'urn:li:fsd_profile:SELF',
    senderName: 'You',
    senderPicture: '',
    body: `body of ${id}`,
    createdAt: 1000,
    isFromMe: true,
    status: 'queued',
  };
}

beforeEach(async () => {
  resetFactories();
  calls.length = 0;
  mockArchive.mockClear();
  mockSendMessage.mockClear();

  testDb = new Dexie(`TestDB_105_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();

  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('offline queue replay ordering', () => {
  it('replays a send before a category mutation of the same conversation even with interleaved conversations', async () => {
    // The cycle-triggering shape: archive(c1) is oldest, a send to ANOTHER
    // conversation sits between it and c1's send.
    await testDb.messages.bulkPut([makeQueuedTemp('temp-c1', '2-c1'), makeQueuedTemp('temp-c2', '2-c2')]);
    await testDb.pendingActions.bulkPut([
      makePendingAction({ id: 'a-archive-c1', type: 'archive', conversationId: '2-c1', timestamp: 1000 }),
      makePendingAction({
        id: 'a-send-c2',
        type: 'send',
        conversationId: '2-c2',
        timestamp: 2000,
        tempMessageId: 'temp-c2',
        bridgeMessage: { type: 'SEND_MESSAGE', conversationId: '2-c2', body: 'hi c2' },
      }),
      makePendingAction({
        id: 'a-send-c1',
        type: 'send',
        conversationId: '2-c1',
        timestamp: 3000,
        tempMessageId: 'temp-c1',
        bridgeMessage: { type: 'SEND_MESSAGE', conversationId: '2-c1', body: 'hi c1' },
      }),
    ]);

    await drainActionQueue();

    expect(calls).toContain('send:2-c1');
    expect(calls).toContain('archive:2-c1');
    expect(calls.indexOf('send:2-c1')).toBeLessThan(calls.indexOf('archive:2-c1'));
    // All three actions confirmed
    const statuses = (await testDb.pendingActions.toArray()).map((a: any) => a.status);
    expect(statuses).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });

  it('keeps plain timestamp order for actions in different conversations', async () => {
    await testDb.messages.put(makeQueuedTemp('temp-c4', '2-c4'));
    await testDb.pendingActions.bulkPut([
      makePendingAction({ id: 'b-archive-c3', type: 'archive', conversationId: '2-c3', timestamp: 1000 }),
      makePendingAction({
        id: 'b-send-c4',
        type: 'send',
        conversationId: '2-c4',
        timestamp: 2000,
        tempMessageId: 'temp-c4',
        bridgeMessage: { type: 'SEND_MESSAGE', conversationId: '2-c4', body: 'hi c4' },
      }),
    ]);

    await drainActionQueue();

    expect(calls.indexOf('archive:2-c3')).toBeLessThan(calls.indexOf('send:2-c4'));
  });
});
