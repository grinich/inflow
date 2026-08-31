/**
 * The external (externally_connectable) agent transport: web pages on allowed
 * origins call AGENT_LIST_TOOLS / AGENT_CALL_TOOL, answered by the gated
 * executor running IN the service worker — bridge calls are routed straight
 * into the internal router (handleMessage), and write visibility becomes a
 * Chrome notification since no page renders the toast store there.
 *
 * This transport exists because agent clients like Claude in Chrome cannot
 * coexist with the embedded app iframe, but can message us from plain pages.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import {
  AGENT_TOOLS_ENABLED_KEY,
  AGENT_WRITES_ENABLED_KEY,
} from '@/lib/agent-settings';
import { makeConversation, resetFactories } from '../fixtures/factories';
import { setLocalStore } from '../mocks/chrome';

let testDb: any;
const { mockHandleMessage } = vi.hoisted(() => ({ mockHandleMessage: vi.fn() }));

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('../../entrypoints/background/messages', () => ({
  handleMessage: mockHandleMessage,
}));

import { setupExternalMessageRouter } from '../../entrypoints/background/external-messages';

type ExternalListener = (
  message: any,
  sender: { origin?: string },
  sendResponse: (response?: any) => void
) => boolean | undefined | void;

function installedListener(): ExternalListener {
  setupExternalMessageRouter();
  return vi.mocked(chrome.runtime.onMessageExternal.addListener).mock
    .calls[0][0] as ExternalListener;
}

/** Invoke the listener; resolves with the async response (asserts channel held). */
function callAgent(listener: ExternalListener, message: any, origin = 'https://inflow.im') {
  return new Promise<any>((resolve, reject) => {
    const returned = listener(message, { origin }, resolve);
    if (returned !== true) reject(new Error('listener did not hold the channel open'));
  });
}

function enable(opts: { reads?: boolean; writes?: boolean } = {}) {
  setLocalStore(AGENT_TOOLS_ENABLED_KEY, opts.reads !== false);
  setLocalStore(AGENT_WRITES_ENABLED_KEY, opts.writes === true);
}

beforeEach(async () => {
  resetFactories();
  testDb = new Dexie(`TestDB_ext_agent_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockHandleMessage.mockReset().mockResolvedValue({ success: true });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('ignores agent messages from a non-allowed origin entirely', () => {
  const listener = installedListener();
  const sendResponse = vi.fn();
  const returned = listener(
    { type: 'AGENT_LIST_TOOLS' },
    { origin: 'https://evil.example' },
    sendResponse
  );
  expect(returned).not.toBe(true);
  expect(sendResponse).not.toHaveBeenCalled();
});

it('AGENT_LIST_TOOLS answers with the executor list (empty + flags while disabled)', async () => {
  const listener = installedListener();
  const disabled = await callAgent(listener, { type: 'AGENT_LIST_TOOLS' });
  expect(disabled).toEqual({ tools: [], readsEnabled: false, writesEnabled: false });

  enable({ writes: true });
  const enabled = await callAgent(listener, { type: 'AGENT_LIST_TOOLS' });
  expect(enabled.readsEnabled).toBe(true);
  expect(enabled.tools.map((t: any) => t.name)).toContain('send_message');
});

it('AGENT_CALL_TOOL while disabled answers the structured error, not silence', async () => {
  const listener = installedListener();
  const result = await callAgent(listener, {
    type: 'AGENT_CALL_TOOL',
    tool: 'get_unread_count',
    input: {},
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('Agent access is disabled');
});

it('read tools run in the worker against Dexie directly', async () => {
  enable();
  await testDb.conversations.bulkPut([
    makeConversation({ id: 'u1', read: 0 }),
    makeConversation({ id: 'r1', read: 1 }),
  ]);
  const listener = installedListener();
  const result = await callAgent(listener, {
    type: 'AGENT_CALL_TOOL',
    tool: 'list_conversations',
    input: { query: 'is:unread' },
  });
  expect(result.isError).toBeUndefined();
  const data = JSON.parse(result.content[0].text);
  expect(data.conversations.map((c: any) => c.id)).toEqual(['u1']);
});

it('write tools route bridge calls into handleMessage, echo locally, and notify via chrome.notifications', async () => {
  enable({ writes: true });
  await testDb.conversations.put(
    makeConversation({ id: 'c1', archived: 0, participantNames: ['Jane Doe'] })
  );
  const listener = installedListener();
  const result = await callAgent(listener, {
    type: 'AGENT_CALL_TOOL',
    tool: 'archive_conversation',
    input: { conversationId: 'c1' },
  });
  expect(result.isError).toBeUndefined();
  // The injected caller: the catalog's bridge() landed on the internal router
  // directly — a runtime sendMessage from the worker to itself goes nowhere.
  expect(mockHandleMessage).toHaveBeenCalledWith({ type: 'ARCHIVE', conversationId: 'c1' });
  expect((await testDb.conversations.get('c1')).archived).toBe(1);
  // No page renders the toast store in the worker — a notification instead.
  expect(chrome.notifications.create).toHaveBeenCalledWith(
    expect.stringContaining('agent-write-'),
    expect.objectContaining({ message: 'Agent archived conversation with Jane Doe' })
  );
});

it('internal bridge types are still not reachable from outside', () => {
  const listener = installedListener();
  const sendResponse = vi.fn();
  const returned = listener(
    { type: 'SEND_MESSAGE', conversationId: 'c1', body: 'raw bridge' },
    { origin: 'https://inflow.im' },
    sendResponse
  );
  expect(returned).not.toBe(true);
  expect(sendResponse).not.toHaveBeenCalled();
  expect(mockHandleMessage).not.toHaveBeenCalled();
});
