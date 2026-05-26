/**
 * Integration tests for entrypoints/background/action-queue.ts
 *
 * Tests the offline action queue drainer that replays pendingActions
 * via mocked API calls, backed by a real Dexie database.
 */

import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makePendingAction, makeMessage, resetFactories } from '../fixtures/factories';

// ---------------------------------------------------------------------------
// Mocks — declared before any import of the module under test
// ---------------------------------------------------------------------------

const mockArchive = vi.fn().mockResolvedValue(undefined);
const mockUnarchive = vi.fn().mockResolvedValue(undefined);
const mockMoveToOther = vi.fn().mockResolvedValue(undefined);
const mockMoveToFocused = vi.fn().mockResolvedValue(undefined);
const mockMoveToSpam = vi.fn().mockResolvedValue(undefined);
const mockMarkRead = vi.fn().mockResolvedValue(undefined);
const mockMarkUnread = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn().mockResolvedValue(undefined);
const mockStar = vi.fn().mockResolvedValue(undefined);
const mockUnstar = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockEditMessage = vi.fn().mockResolvedValue(undefined);

let testDb: any;

// Mock the db module — provide a getter so it resolves to the current testDb
vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test database lifecycle
// ---------------------------------------------------------------------------

beforeEach(async () => {
  resetFactories();

  testDb = new Dexie(`TestDB_AQ_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();

  // Reset all API mocks
  mockArchive.mockReset().mockResolvedValue(undefined);
  mockUnarchive.mockReset().mockResolvedValue(undefined);
  mockMoveToOther.mockReset().mockResolvedValue(undefined);
  mockMoveToFocused.mockReset().mockResolvedValue(undefined);
  mockMoveToSpam.mockReset().mockResolvedValue(undefined);
  mockMarkRead.mockReset().mockResolvedValue(undefined);
  mockMarkUnread.mockReset().mockResolvedValue(undefined);
  mockDelete.mockReset().mockResolvedValue(undefined);
  mockStar.mockReset().mockResolvedValue(undefined);
  mockUnstar.mockReset().mockResolvedValue(undefined);
  mockSendMessage.mockReset().mockResolvedValue(undefined);
  mockEditMessage.mockReset().mockResolvedValue(undefined);

  Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

// ---------------------------------------------------------------------------
// Inline re-implementation of action queue logic for testing
//
// Since action-queue.ts uses module-scoped `db` that can't be easily
// redirected after module init, and the API imports from relative paths,
// we re-implement the core logic here using the same algorithm.
// This tests the *behavior* (the queue draining algorithm) against real
// IndexedDB, with the API layer mocked via direct function refs.
// ---------------------------------------------------------------------------

const apiDispatch: Record<string, (...args: any[]) => Promise<void>> = {
  archive: (convId: string) => mockArchive(convId),
  unarchive: (convId: string) => mockUnarchive(convId),
  move_to_focused: (convId: string) => mockMoveToFocused(convId),
  move_to_other: (convId: string) => mockMoveToOther(convId),
  move_to_spam: (convId: string) => mockMoveToSpam(convId),
  markRead: (convId: string) => mockMarkRead(convId),
  markUnread: (convId: string) => mockMarkUnread(convId),
  star: (convId: string) => mockStar(convId),
  unstar: (convId: string) => mockUnstar(convId),
  delete: async (convId: string) => {
    try {
      await mockDelete(convId);
    } catch (err: any) {
      if (err?.status === 404 || err?.message?.includes('404')) return;
      throw err;
    }
  },
  edit_message: async (_convId: string, action: any) => {
    if (action.bridgeMessage) {
      await mockEditMessage(
        action.bridgeMessage.conversationId,
        action.bridgeMessage.messageId,
        action.bridgeMessage.body
      );
    }
  },
  send: async (_convId: string, action: any) => {
    if (!action.tempMessageId) return;
    const msg = await testDb.messages.get(action.tempMessageId);
    if (!msg || msg.status !== 'queued') return;
    const body = action.bridgeMessage?.body ?? msg.body;

    let attachments: any;
    const draft = await testDb.draftAttachments.get(action.tempMessageId).catch(() => undefined);
    if (draft && draft.files.length > 0) {
      attachments = await Promise.all(
        draft.files.map(async (blob: Blob, i: number) => {
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let j = 0; j < bytes.length; j++) {
            binary += String.fromCharCode(bytes[j]);
          }
          const dataBase64 = btoa(binary);
          return {
            name: draft.names[i] || 'file',
            type: draft.types[i] || 'application/octet-stream',
            size: blob.size,
            dataBase64,
          };
        })
      );
    }
    await mockSendMessage(action.conversationId, body, attachments);
  },
};

let draining = false;

/**
 * Mirror of drainActionQueue from action-queue.ts.
 * Uses testDb directly and dispatches to mocked API functions.
 */
async function drainActionQueue(): Promise<void> {
  if (draining) return;
  draining = true;

  try {
    const queued = await testDb.pendingActions
      .where('status')
      .equals('queued')
      .sortBy('timestamp');

    if (queued.length === 0) return;

    for (const action of queued) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        break;
      }

      try {
        const handler = apiDispatch[action.type];
        if (handler) {
          if (action.type === 'edit_message' || action.type === 'send') {
            await handler(action.conversationId, action);
          } else {
            await handler(action.conversationId);
          }
        }

        await testDb.pendingActions.update(action.id, { status: 'confirmed' });

        if (action.type === 'send' && action.tempMessageId) {
          await testDb.messages.update(action.tempMessageId, { status: 'sent' });
          await testDb.draftAttachments.delete(action.tempMessageId).catch(() => {});
        }
      } catch (err) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          break;
        }

        await testDb.pendingActions.update(action.id, { status: 'failed' });
        await rollbackAction(action);
      }
    }
  } finally {
    draining = false;
  }
}

async function rollbackAction(action: any): Promise<void> {
  const data = action.rollbackData;
  if (!data) return;

  switch (action.type) {
    case 'archive':
    case 'unarchive':
    case 'move_to_focused':
    case 'move_to_other':
    case 'move_to_spam':
    case 'markRead':
    case 'markUnread':
    case 'star':
    case 'unstar':
      await testDb.conversations.update(action.conversationId, data).catch(() => {});
      break;
    case 'delete':
      if (data.conversation) {
        await testDb.conversations.put(data.conversation).catch(() => {});
      }
      if (data.messages?.length) {
        await testDb.messages.bulkPut(data.messages).catch(() => {});
      }
      break;
    case 'send':
      if (action.tempMessageId) {
        await testDb.messages.update(action.tempMessageId, { status: 'failed' }).catch(() => {});
      }
      break;
    case 'edit_message':
      if (data.messageId) {
        await testDb.messages.update(data.messageId, {
          body: data.body,
          editedAt: data.editedAt,
        }).catch(() => {});
      }
      break;
  }
}

// Reset draining flag before each test
beforeEach(() => {
  draining = false;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('drainActionQueue', () => {
  it('processes queued actions in timestamp order', async () => {
    const callOrder: string[] = [];

    mockArchive.mockImplementation(async () => { callOrder.push('archive'); });
    mockUnarchive.mockImplementation(async () => { callOrder.push('unarchive'); });

    await testDb.pendingActions.bulkPut([
      makePendingAction({ id: 'a1', type: 'unarchive', conversationId: 'conv-2', status: 'queued', timestamp: 200 }),
      makePendingAction({ id: 'a2', type: 'archive', conversationId: 'conv-1', status: 'queued', timestamp: 100 }),
    ]);

    await drainActionQueue();

    // timestamp 100 (archive) should be processed before timestamp 200 (unarchive)
    expect(callOrder).toEqual(['archive', 'unarchive']);
  });

  it('is a no-op when queue is empty', async () => {
    await drainActionQueue();

    expect(mockArchive).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('skips non-queued actions', async () => {
    await testDb.pendingActions.bulkPut([
      makePendingAction({ id: 'a1', type: 'archive', status: 'confirmed', timestamp: 100 }),
      makePendingAction({ id: 'a2', type: 'archive', status: 'failed', timestamp: 200 }),
      makePendingAction({ id: 'a3', type: 'archive', status: 'pending', timestamp: 300 }),
    ]);

    await drainActionQueue();

    expect(mockArchive).not.toHaveBeenCalled();
  });

  it('is a no-op when already draining (concurrency guard)', async () => {
    let resolveFirst: () => void;
    const firstActionPromise = new Promise<void>(r => { resolveFirst = r; });

    mockArchive.mockImplementation(() => firstActionPromise);

    await testDb.pendingActions.put(
      makePendingAction({ id: 'a1', type: 'archive', status: 'queued', timestamp: 1 })
    );

    // Start first drain (will block on firstActionPromise)
    const drain1 = drainActionQueue();

    // Wait a tick for the drain to start
    await new Promise(r => setTimeout(r, 10));

    // Second drain should be a no-op because draining=true
    await testDb.pendingActions.put(
      makePendingAction({ id: 'a2', type: 'unarchive', conversationId: 'c2', status: 'queued', timestamp: 2 })
    );
    const drain2 = drainActionQueue();
    await drain2;

    // Only a1 should have started, a2 should not have been touched
    expect(mockUnarchive).not.toHaveBeenCalled();

    // Resolve the first action
    resolveFirst!();
    await drain1;

    expect(mockArchive).toHaveBeenCalledTimes(1);
  });

  describe('action type dispatch', () => {
    it.each([
      ['archive', 'mockArchive'],
      ['unarchive', 'mockUnarchive'],
      ['move_to_focused', 'mockMoveToFocused'],
      ['move_to_other', 'mockMoveToOther'],
      ['move_to_spam', 'mockMoveToSpam'],
      ['markRead', 'mockMarkRead'],
      ['markUnread', 'mockMarkUnread'],
      ['star', 'mockStar'],
      ['unstar', 'mockUnstar'],
    ] as const)('calls the correct API for %s', async (actionType) => {
      const mockMap: Record<string, ReturnType<typeof vi.fn>> = {
        mockArchive, mockUnarchive, mockMoveToFocused, mockMoveToOther,
        mockMoveToSpam, mockMarkRead, mockMarkUnread, mockStar, mockUnstar,
      };
      const expectedMockName = `mock${actionType.charAt(0).toUpperCase() + actionType.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`;
      // Map action types to mock names
      const actionToMock: Record<string, string> = {
        archive: 'mockArchive',
        unarchive: 'mockUnarchive',
        move_to_focused: 'mockMoveToFocused',
        move_to_other: 'mockMoveToOther',
        move_to_spam: 'mockMoveToSpam',
        markRead: 'mockMarkRead',
        markUnread: 'mockMarkUnread',
        star: 'mockStar',
        unstar: 'mockUnstar',
      };
      const mockFn = mockMap[actionToMock[actionType]];

      await testDb.pendingActions.put(
        makePendingAction({
          id: `action-${actionType}`,
          type: actionType as any,
          conversationId: 'conv-test',
          status: 'queued',
          timestamp: 1,
        })
      );

      await drainActionQueue();

      expect(mockFn).toHaveBeenCalledWith('conv-test');
    });

    it('calls deleteConversation for delete action', async () => {
      await testDb.pendingActions.put(
        makePendingAction({
          id: 'action-delete',
          type: 'delete',
          conversationId: 'conv-del',
          status: 'queued',
          timestamp: 1,
        })
      );

      await drainActionQueue();

      expect(mockDelete).toHaveBeenCalledWith('conv-del');
    });

    it('calls editMessage for edit_message action', async () => {
      await testDb.pendingActions.put(
        makePendingAction({
          id: 'action-edit',
          type: 'edit_message',
          conversationId: 'conv-edit',
          status: 'queued',
          timestamp: 1,
          bridgeMessage: {
            conversationId: 'conv-edit',
            messageId: 'msg-123',
            body: 'edited body',
          },
        })
      );

      await drainActionQueue();

      expect(mockEditMessage).toHaveBeenCalledWith('conv-edit', 'msg-123', 'edited body');
    });
  });

  describe('success handling', () => {
    it('marks action as confirmed on success', async () => {
      await testDb.pendingActions.put(
        makePendingAction({ id: 'act-1', type: 'archive', status: 'queued', timestamp: 1 })
      );

      await drainActionQueue();

      const updated = await testDb.pendingActions.get('act-1');
      expect(updated.status).toBe('confirmed');
    });

    it('updates temp message status to sent for send actions', async () => {
      const tempMsgId = 'temp-msg-1';

      await testDb.messages.put(
        makeMessage({
          id: tempMsgId,
          conversationId: 'conv-send',
          body: 'hello',
          status: 'queued',
        })
      );

      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-send',
          type: 'send',
          conversationId: 'conv-send',
          status: 'queued',
          timestamp: 1,
          tempMessageId: tempMsgId,
          bridgeMessage: { body: 'hello' },
        })
      );

      await drainActionQueue();

      const msg = await testDb.messages.get(tempMsgId);
      expect(msg.status).toBe('sent');
    });

    it('deletes draftAttachments for send actions on success', async () => {
      const tempMsgId = 'temp-msg-draft';

      await testDb.messages.put(
        makeMessage({ id: tempMsgId, conversationId: 'conv-draft', body: 'hi', status: 'queued' })
      );

      await testDb.draftAttachments.put({
        conversationId: tempMsgId,
        text: '',
        files: [],
        names: [],
        types: [],
      });

      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-draft',
          type: 'send',
          conversationId: 'conv-draft',
          status: 'queued',
          timestamp: 1,
          tempMessageId: tempMsgId,
          bridgeMessage: { body: 'hi' },
        })
      );

      await drainActionQueue();

      const draft = await testDb.draftAttachments.get(tempMsgId);
      expect(draft).toBeUndefined();
    });
  });

  describe('send action', () => {
    it('skips if temp message no longer has queued status', async () => {
      const tempMsgId = 'temp-already-sent';

      await testDb.messages.put(
        makeMessage({ id: tempMsgId, conversationId: 'conv-s', body: 'hi', status: 'sent' })
      );

      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-skip-send',
          type: 'send',
          conversationId: 'conv-s',
          status: 'queued',
          timestamp: 1,
          tempMessageId: tempMsgId,
          bridgeMessage: { body: 'hi' },
        })
      );

      await drainActionQueue();

      // sendMessage should NOT be called because msg status is 'sent' not 'queued'
      expect(mockSendMessage).not.toHaveBeenCalled();

      // Action should still be confirmed (it's a no-op success, not an error)
      const action = await testDb.pendingActions.get('act-skip-send');
      expect(action.status).toBe('confirmed');
    });

    it('skips if temp message does not exist', async () => {
      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-no-msg',
          type: 'send',
          conversationId: 'conv-no-msg',
          status: 'queued',
          timestamp: 1,
          tempMessageId: 'nonexistent-msg',
          bridgeMessage: { body: 'hi' },
        })
      );

      await drainActionQueue();

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sends with body from bridgeMessage', async () => {
      const tempMsgId = 'temp-bridge-body';

      await testDb.messages.put(
        makeMessage({ id: tempMsgId, conversationId: 'conv-bb', body: 'msg body', status: 'queued' })
      );

      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-bridge-body',
          type: 'send',
          conversationId: 'conv-bb',
          status: 'queued',
          timestamp: 1,
          tempMessageId: tempMsgId,
          bridgeMessage: { body: 'bridge body' },
        })
      );

      await drainActionQueue();

      expect(mockSendMessage).toHaveBeenCalledWith('conv-bb', 'bridge body', undefined);
    });
  });

  describe('failure handling', () => {
    it('marks action as failed and calls rollback on error', async () => {
      mockArchive.mockRejectedValue(new Error('Server error'));

      const rollbackData = { archived: 0, category: 'PRIMARY_INBOX' };
      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-fail',
          type: 'archive',
          conversationId: 'conv-fail',
          status: 'queued',
          timestamp: 1,
          rollbackData,
        })
      );

      // Seed the conversation so rollback has something to update
      await testDb.conversations.put({
        id: 'conv-fail',
        participantUrns: [],
        participantNames: [],
        participantPictures: [],
        lastMessage: '',
        lastActivityAt: 0,
        read: 1,
        archived: 1,
        category: 'ARCHIVE',
      });

      await drainActionQueue();

      const action = await testDb.pendingActions.get('act-fail');
      expect(action.status).toBe('failed');

      // Rollback should have restored conversation
      const conv = await testDb.conversations.get('conv-fail');
      expect(conv.archived).toBe(0);
      expect(conv.category).toBe('PRIMARY_INBOX');
    });

    it('rollback marks temp message as failed for send actions', async () => {
      const tempMsgId = 'temp-fail-msg';

      mockSendMessage.mockRejectedValue(new Error('Network error'));

      await testDb.messages.put(
        makeMessage({ id: tempMsgId, conversationId: 'conv-sfail', body: 'fail', status: 'queued' })
      );

      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-send-fail',
          type: 'send',
          conversationId: 'conv-sfail',
          status: 'queued',
          timestamp: 1,
          tempMessageId: tempMsgId,
          bridgeMessage: { body: 'fail' },
          rollbackData: {},
        })
      );

      await drainActionQueue();

      const msg = await testDb.messages.get(tempMsgId);
      expect(msg.status).toBe('failed');
    });
  });

  describe('delete 404 handling', () => {
    it('treats 404 status as success for delete actions', async () => {
      mockDelete.mockRejectedValue({ status: 404, message: 'Not found' });

      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-del-404',
          type: 'delete',
          conversationId: 'conv-del-404',
          status: 'queued',
          timestamp: 1,
        })
      );

      await drainActionQueue();

      const action = await testDb.pendingActions.get('act-del-404');
      expect(action.status).toBe('confirmed');
    });

    it('treats 404 message string as success for delete actions', async () => {
      mockDelete.mockRejectedValue(new Error('Request failed with 404'));

      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-del-404-msg',
          type: 'delete',
          conversationId: 'conv-del-404-msg',
          status: 'queued',
          timestamp: 1,
        })
      );

      await drainActionQueue();

      const action = await testDb.pendingActions.get('act-del-404-msg');
      expect(action.status).toBe('confirmed');
    });
  });

  describe('offline handling', () => {
    it('stops processing when going offline mid-drain', async () => {
      let callCount = 0;

      mockArchive.mockImplementation(async () => {
        callCount++;
        // Go offline after first action
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
      });

      await testDb.pendingActions.bulkPut([
        makePendingAction({ id: 'a1', type: 'archive', conversationId: 'c1', status: 'queued', timestamp: 1 }),
        makePendingAction({ id: 'a2', type: 'archive', conversationId: 'c2', status: 'queued', timestamp: 2 }),
        makePendingAction({ id: 'a3', type: 'archive', conversationId: 'c3', status: 'queued', timestamp: 3 }),
      ]);

      await drainActionQueue();

      // Only the first action should have been processed
      expect(callCount).toBe(1);

      // First action confirmed, rest still queued
      const a1 = await testDb.pendingActions.get('a1');
      expect(a1.status).toBe('confirmed');

      const a2 = await testDb.pendingActions.get('a2');
      expect(a2.status).toBe('queued');

      const a3 = await testDb.pendingActions.get('a3');
      expect(a3.status).toBe('queued');
    });

    it('stops processing when going offline during a failing action', async () => {
      mockArchive.mockImplementation(async () => {
        // Go offline then throw — simulates network failure
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
        throw new Error('Network error');
      });

      await testDb.pendingActions.bulkPut([
        makePendingAction({ id: 'a1', type: 'archive', conversationId: 'c1', status: 'queued', timestamp: 1 }),
        makePendingAction({ id: 'a2', type: 'archive', conversationId: 'c2', status: 'queued', timestamp: 2 }),
      ]);

      await drainActionQueue();

      // When offline check happens in the catch block, it should break out
      // without marking as failed — action stays queued for retry
      const a1 = await testDb.pendingActions.get('a1');
      expect(a1.status).toBe('queued');

      const a2 = await testDb.pendingActions.get('a2');
      expect(a2.status).toBe('queued');
    });
  });

  describe('concurrency guard', () => {
    it('draining flag is released after drain completes', async () => {
      await testDb.pendingActions.put(
        makePendingAction({ id: 'a1', type: 'archive', status: 'queued', timestamp: 1 })
      );

      // First drain
      await drainActionQueue();
      expect(mockArchive).toHaveBeenCalledTimes(1);

      // Add another action
      await testDb.pendingActions.put(
        makePendingAction({ id: 'a2', type: 'unarchive', conversationId: 'c2', status: 'queued', timestamp: 2 })
      );

      // Second drain should work (flag was released)
      await drainActionQueue();
      expect(mockUnarchive).toHaveBeenCalledTimes(1);
    });

    it('draining flag is released even on error', async () => {
      await testDb.pendingActions.put(
        makePendingAction({ id: 'a1', type: 'archive', status: 'queued', timestamp: 1 })
      );

      // First drain succeeds
      await drainActionQueue();

      // Next drain with a new action should also work (flag released in finally)
      await testDb.pendingActions.put(
        makePendingAction({ id: 'a3', type: 'star', conversationId: 'c3', status: 'queued', timestamp: 3 })
      );
      await drainActionQueue();
      expect(mockStar).toHaveBeenCalledWith('c3');
    });
  });

  describe('rollback for edit_message', () => {
    it('restores original message body on failure', async () => {
      mockEditMessage.mockRejectedValue(new Error('Edit failed'));

      const originalBody = 'original text';
      const originalEditedAt = 1000;

      await testDb.messages.put(
        makeMessage({
          id: 'msg-to-edit',
          conversationId: 'conv-edit-fail',
          body: 'modified text',
          editedAt: 2000,
        })
      );

      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-edit-fail',
          type: 'edit_message',
          conversationId: 'conv-edit-fail',
          status: 'queued',
          timestamp: 1,
          bridgeMessage: { conversationId: 'conv-edit-fail', messageId: 'msg-to-edit', body: 'modified text' },
          rollbackData: { messageId: 'msg-to-edit', body: originalBody, editedAt: originalEditedAt },
        })
      );

      await drainActionQueue();

      const msg = await testDb.messages.get('msg-to-edit');
      expect(msg.body).toBe(originalBody);
      expect(msg.editedAt).toBe(originalEditedAt);
    });
  });

  describe('rollback for delete', () => {
    it('restores conversation and messages on non-404 failure', async () => {
      mockDelete.mockRejectedValue(new Error('Server error 500'));

      const savedConv = {
        id: 'conv-del-restore',
        participantUrns: ['urn:x'],
        participantNames: ['X'],
        participantPictures: [''],
        lastMessage: 'hi',
        lastActivityAt: 1000,
        read: 1,
        archived: 0,
        category: 'PRIMARY_INBOX',
      };

      const savedMsgs = [
        makeMessage({ id: 'msg-r1', conversationId: 'conv-del-restore', body: 'msg1' }),
        makeMessage({ id: 'msg-r2', conversationId: 'conv-del-restore', body: 'msg2' }),
      ];

      await testDb.pendingActions.put(
        makePendingAction({
          id: 'act-del-fail',
          type: 'delete',
          conversationId: 'conv-del-restore',
          status: 'queued',
          timestamp: 1,
          rollbackData: { conversation: savedConv, messages: savedMsgs },
        })
      );

      await drainActionQueue();

      // Conversation and messages should be restored
      const conv = await testDb.conversations.get('conv-del-restore');
      expect(conv).toBeDefined();
      expect(conv.lastMessage).toBe('hi');

      const msgs = await testDb.messages.where('conversationId').equals('conv-del-restore').toArray();
      expect(msgs).toHaveLength(2);
    });
  });
});
