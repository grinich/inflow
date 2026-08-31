/**
 * The extension side of the Inflow.mcpb bridge
 * (entrypoints/background/agent-bridge.ts): connects only when enabled AND
 * paired, verifies the server's HELLO token before authing, serves
 * LIST_TOOLS / CALL_TOOL through the gated executor, pushes TOOLS_CHANGED,
 * publishes status transitions, and reconnects with backoff + alarm.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import {
  AGENT_BRIDGE_STATUS_KEY,
  AGENT_BRIDGE_TOKEN_KEY,
  AGENT_TOOLS_ENABLED_KEY,
  AGENT_WRITES_ENABLED_KEY,
} from '@/lib/agent-settings';
import { makeConversation, resetFactories } from '../fixtures/factories';
import { fireStorageChanged, getAlarms, setLocalStore } from '../mocks/chrome';
import { MockWebSocket, installWebSocketMock, latestSocket } from '../mocks/websocket';

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

const TOKEN = 'INF-ABC234';
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Flush until the reply with this id lands (Dexie work needs several ticks). */
async function replyFor(ws: MockWebSocket, id: string) {
  for (let i = 0; i < 50 && !ws.sent.some((m) => m.id === id); i++) await flush();
  return ws.sent.find((m) => m.id === id);
}

async function boot(opts: { enabled?: boolean; token?: string | null } = {}) {
  setLocalStore(AGENT_TOOLS_ENABLED_KEY, opts.enabled !== false);
  if (opts.token !== null) setLocalStore(AGENT_BRIDGE_TOKEN_KEY, opts.token ?? TOKEN);
  // Fresh module per test: the bridge holds socket/backoff state at module scope.
  vi.resetModules();
  const { setupAgentBridge } = await import('../../entrypoints/background/agent-bridge');
  setupAgentBridge();
  await flush();
}

async function status(): Promise<string | undefined> {
  const r = await chrome.storage.local.get(AGENT_BRIDGE_STATUS_KEY);
  return r[AGENT_BRIDGE_STATUS_KEY]?.state;
}

/** Boot + complete the handshake; returns the live socket. */
async function bootConnected(): Promise<MockWebSocket> {
  await boot();
  const ws = latestSocket()!;
  ws.emitMessage({ type: 'HELLO', v: 1, token: TOKEN });
  ws.emitMessage({ type: 'READY' });
  await flush();
  return ws;
}

beforeEach(async () => {
  resetFactories();
  installWebSocketMock();
  testDb = new Dexie(`TestDB_bridge_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockHandleMessage.mockReset().mockResolvedValue({ success: true });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('does not connect while disabled or unpaired, and says which', async () => {
  await boot({ enabled: false, token: null });
  expect(MockWebSocket.instances).toHaveLength(0);
  expect(await status()).toBe('disabled');

  await boot({ token: null }); // enabled, but never paired
  expect(MockWebSocket.instances).toHaveLength(0);
  expect(await status()).toBe('unpaired');
  expect(getAlarms()['agent-bridge-reconnect']).toBeUndefined();
});

it('connects when enabled + paired, registers the reconnect alarm', async () => {
  await boot();
  expect(MockWebSocket.instances).toHaveLength(1);
  expect(latestSocket()!.url).toBe('ws://127.0.0.1:48632');
  expect(getAlarms()['agent-bridge-reconnect']).toEqual({ periodInMinutes: 0.5 });
  expect(await status()).toBe('disconnected'); // until READY
});

it("rejects a server whose HELLO token doesn't match the pairing code", async () => {
  await boot();
  const ws = latestSocket()!;
  ws.emitMessage({ type: 'HELLO', v: 1, token: 'INF-EVIL22' });
  await flush();
  expect(ws.sentOfType('AUTH')).toHaveLength(0); // never reveal our token
  expect(ws.closed).toBe(true);
  expect(await status()).toBe('unpaired');
});

it('completes the handshake: AUTH with the token, connected on READY', async () => {
  const ws = await bootConnected();
  expect(ws.sentOfType('AUTH')).toEqual([{ type: 'AUTH', v: 1, token: TOKEN }]);
  expect(await status()).toBe('connected');
});

it('serves LIST_TOOLS and CALL_TOOL through the gated executor', async () => {
  await testDb.conversations.put(makeConversation({ id: 'c1', read: 0 }));
  const ws = await bootConnected();

  ws.emitMessage({ id: 'srv-1', type: 'LIST_TOOLS' });
  const listReply = await replyFor(ws, 'srv-1');
  expect(listReply.ok).toBe(true);
  expect(listReply.result.readsEnabled).toBe(true);
  expect(listReply.result.tools.map((t: any) => t.name)).toContain('list_conversations');
  expect(listReply.result.tools.map((t: any) => t.name)).not.toContain('send_message'); // writes off

  ws.emitMessage({ id: 'srv-2', type: 'CALL_TOOL', tool: 'get_unread_count', input: {} });
  const callReply = await replyFor(ws, 'srv-2');
  expect(callReply.ok).toBe(true);
  expect(JSON.parse(callReply.result.content[0].text)).toEqual({ focusedUnread: 1 });
});

it('answers PING with PONG and pushes TOOLS_CHANGED when the writes toggle flips', async () => {
  const ws = await bootConnected();
  ws.emitMessage({ type: 'PING' });
  expect(ws.sentOfType('PONG')).toHaveLength(1);

  setLocalStore(AGENT_WRITES_ENABLED_KEY, true);
  fireStorageChanged({ [AGENT_WRITES_ENABLED_KEY]: { newValue: true } });
  await flush();
  expect(ws.sentOfType('TOOLS_CHANGED')).toHaveLength(1);
});

it('a token change drops the session and reconnects with the new code', async () => {
  const ws = await bootConnected();
  setLocalStore(AGENT_BRIDGE_TOKEN_KEY, 'INF-NEW234');
  fireStorageChanged({ [AGENT_BRIDGE_TOKEN_KEY]: { newValue: 'INF-NEW234' } });
  await flush();
  expect(ws.closed).toBe(true);
  const fresh = latestSocket()!;
  expect(fresh).not.toBe(ws);
  fresh.emitMessage({ type: 'HELLO', v: 1, token: 'INF-NEW234' });
  expect(fresh.sentOfType('AUTH')).toEqual([{ type: 'AUTH', v: 1, token: 'INF-NEW234' }]);
});

it('reconnects with backoff after the server dies', async () => {
  vi.useFakeTimers();
  try {
    setLocalStore(AGENT_TOOLS_ENABLED_KEY, true);
    setLocalStore(AGENT_BRIDGE_TOKEN_KEY, TOKEN);
    vi.resetModules();
    const { setupAgentBridge } = await import('../../entrypoints/background/agent-bridge');
    setupAgentBridge();
    await vi.advanceTimersByTimeAsync(0);
    const first = latestSocket()!;

    first.emitClose(); // server went away
    await vi.advanceTimersByTimeAsync(0);
    expect(await status()).toBe('disconnected');

    await vi.advanceTimersByTimeAsync(1000); // first backoff step
    expect(MockWebSocket.instances).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});

it('disabling agent access closes the socket and clears the alarm', async () => {
  const ws = await bootConnected();
  setLocalStore(AGENT_TOOLS_ENABLED_KEY, false);
  fireStorageChanged({ [AGENT_TOOLS_ENABLED_KEY]: { newValue: false } });
  await flush();
  expect(ws.closed).toBe(true);
  expect(await status()).toBe('disabled');
  expect(getAlarms()['agent-bridge-reconnect']).toBeUndefined();
});
