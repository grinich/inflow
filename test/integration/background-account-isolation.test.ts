import Dexie from 'dexie';
import { applySchema, type InflowDatabase } from '@/db/database';
import { makeConversation, makeMessage, makePendingAction } from '../fixtures/factories';
import { buildConversationsPageResponse } from '../fixtures/voyager-responses';

let activeDb: InflowDatabase;
let generation = 0;
let accounts: InflowDatabase[];

const api = vi.hoisted(() => ({
  fetchConversationsPage: vi.fn(),
  archiveConversation: vi.fn(),
  sendMessage: vi.fn(),
  recallMessage: vi.fn(),
  getMemberUrn: vi.fn(),
  getBackfillCutoff: vi.fn(),
}));

vi.mock('@/db/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/db/database')>(),
  get db() { return activeDb; },
  getDbGeneration: () => generation,
}));
vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: api.getMemberUrn,
}));
vi.mock('@/lib/sync-settings', () => ({ getBackfillCutoff: api.getBackfillCutoff }));
vi.mock('../../entrypoints/background/api/conversations', () => ({
  ...api,
  unarchiveConversation: vi.fn(), moveToOther: vi.fn(), moveToFocused: vi.fn(),
  moveToSpam: vi.fn(), markConversationRead: vi.fn(), markConversationUnread: vi.fn(),
  deleteConversation: vi.fn(), starConversation: vi.fn(), unstarConversation: vi.fn(),
}));
vi.mock('../../entrypoints/background/api/messages', () => ({
  sendMessage: api.sendMessage, recallMessage: api.recallMessage,
  editMessage: vi.fn(), reactWithEmoji: vi.fn(),
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { discoverPage, enqueueConversations } from '../../entrypoints/background/sync/sync-discovery';
import { syncConversations, syncCategory } from '../../entrypoints/background/sync/sync-engine';
import { drainActionQueue } from '../../entrypoints/background/action-queue';
import * as sendQueue from '../../entrypoints/background/send-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(async () => {
  vi.clearAllMocks();
  api.archiveConversation.mockReset();
  api.fetchConversationsPage.mockReset();
  api.sendMessage.mockReset();
  api.getMemberUrn.mockReset().mockResolvedValue('urn:li:fsd_profile:SELF');
  api.getBackfillCutoff.mockReset().mockResolvedValue(0);
  generation = 0;
  accounts = [];
  for (let i = 0; i < 2; i++) {
    const database = new Dexie(`AccountIsolation_${Date.now()}_${Math.random()}`) as InflowDatabase;
    applySchema(database);
    await database.open();
    accounts.push(database);
  }
  activeDb = accounts[0];
});

afterEach(async () => {
  vi.restoreAllMocks();
  sendQueue.clearSendQueue();
  for (const database of accounts) {
    database.close();
    await Dexie.delete(database.name);
  }
});

function switchAccount() {
  activeDb = accounts[1];
  generation++;
}

const page = {
  response: buildConversationsPageResponse([{
    id: 'account-a-conversation',
    participants: [{ profileId: 'account-a-person', firstName: 'Alice', lastName: 'A' }],
    lastMessage: 'Private to account A', lastActivityAt: 1000,
  }]),
  nextCursor: null,
};

it('discards discovery results fetched before an account switch', async () => {
  const response = deferred<typeof page>();
  api.fetchConversationsPage.mockReturnValue(response.promise);
  const discovery = discoverPage('PRIMARY_INBOX', null);
  await vi.waitFor(() => expect(api.fetchConversationsPage).toHaveBeenCalled());
  switchAccount();
  response.resolve(page);
  await expect(discovery).rejects.toThrow('Account changed');
  expect(await accounts[1].conversations.count()).toBe(0);
  expect(await accounts[1].profiles.count()).toBe(0);
});

it.each(['discovery', 'PRIMARY_INBOX', 'ARCHIVE'] as const)(
  'does not continue %s when authentication switches accounts', async (operation) => {
    const identity = deferred<string>();
    api.getMemberUrn.mockReturnValue(identity.promise);
    const work = operation === 'discovery'
      ? discoverPage('PRIMARY_INBOX', 'old-account-cursor')
      : syncCategory(operation);
    switchAccount();
    identity.resolve('urn:li:fsd_profile:OTHER');
    if (operation === 'discovery') await expect(work).rejects.toThrow('Account changed');
    else await work;
    expect(api.fetchConversationsPage).not.toHaveBeenCalled();
    expect(await activeDb.conversations.count()).toBe(0);
  },
);

it('does not enqueue old-account conversations after an async settings read', async () => {
  const cutoff = deferred<number>();
  api.getBackfillCutoff.mockReturnValue(cutoff.promise);
  const enqueue = enqueueConversations([makeConversation({ id: 'old-account-thread' })], 'PRIMARY_INBOX');
  switchAccount();
  cutoff.resolve(0);
  await expect(enqueue).rejects.toThrow('Account changed');
  expect(await activeDb.syncQueue.count()).toBe(0);
});

it.each(['PRIMARY_INBOX', 'ARCHIVE'] as const)(
  'discards an in-flight %s quick poll after an account switch', async (category) => {
    const response = deferred<typeof page>();
    api.fetchConversationsPage.mockReturnValue(response.promise);
    const sync = category === 'PRIMARY_INBOX' ? syncConversations() : syncCategory(category);
    await vi.waitFor(() => expect(api.fetchConversationsPage).toHaveBeenCalled());
    switchAccount();
    response.resolve(page);
    await sync;
    expect(await accounts[1].conversations.count()).toBe(0);
    expect(await accounts[1].profiles.count()).toBe(0);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'SYNC_COMPLETE' });
  },
);

it.each(['success', 'failure'] as const)(
  'does not apply queued-action %s bookkeeping to another account', async (outcome) => {
    const response = deferred<void>();
    api.archiveConversation.mockReturnValue(response.promise);
    const action = makePendingAction({
      id: 'shared-action-id', type: 'archive', status: 'queued', conversationId: 'shared-conversation-id',
      rollbackData: { category: 'PRIMARY_INBOX', archived: 0 },
    });
    await accounts[0].pendingActions.put(action);
    await accounts[1].pendingActions.put(action);
    const otherConversation = makeConversation({ id: action.conversationId, category: 'SECONDARY_INBOX' });
    await accounts[1].conversations.put(otherConversation);

    const drain = drainActionQueue();
    await vi.waitFor(() => expect(api.archiveConversation).toHaveBeenCalled());
    switchAccount();
    if (outcome === 'success') response.resolve();
    else response.reject(new Error('API failed'));
    await drain;

    expect(await accounts[1].pendingActions.get(action.id)).toEqual(action);
    expect(await accounts[1].conversations.get(action.conversationId)).toEqual(otherConversation);
  },
);

it('does not replay an old-account action waiting behind a live send', async () => {
  const blocked = deferred<void>();
  const liveSend = sendQueue.enqueueSend('conversation', () => blocked.promise);
  const queueSpy = vi.spyOn(sendQueue, 'enqueueSend');
  const action = makePendingAction({ type: 'archive', status: 'queued', conversationId: 'conversation' });
  await activeDb.pendingActions.put(action);

  const drain = drainActionQueue();
  await vi.waitFor(() => expect(queueSpy).toHaveBeenCalledWith('conversation', expect.any(Function)));
  switchAccount();
  blocked.resolve();
  await Promise.all([liveSend, drain]);

  expect(api.archiveConversation).not.toHaveBeenCalled();
  expect((await accounts[0].pendingActions.get(action.id))?.status).toBe('queued');
});

it('leaves a skipped queued send and its saved attachment intact', async () => {
  const message = makeMessage({ id: 'temp-cancelled', conversationId: 'conversation', status: 'failed' });
  const action = makePendingAction({
    type: 'send', status: 'queued', conversationId: message.conversationId, tempMessageId: message.id,
  });
  const draft = { conversationId: message.id, files: [], names: ['retry.txt'], types: ['text/plain'] };
  await activeDb.messages.put(message);
  await activeDb.pendingActions.put(action);
  await activeDb.draftAttachments.put(draft);

  await drainActionQueue();

  expect(api.sendMessage).not.toHaveBeenCalled();
  expect(await activeDb.messages.get(message.id)).toEqual(message);
  expect(await activeDb.draftAttachments.get(message.id)).toEqual(draft);
  expect((await activeDb.pendingActions.get(action.id))?.status).toBe('confirmed');
});
