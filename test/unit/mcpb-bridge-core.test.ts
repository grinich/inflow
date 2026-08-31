/**
 * The Inflow.mcpb bridge protocol core (mcpb/server/bridge-core.mjs) — pure,
 * driven here without ws or the MCP SDK: origin gate, mutual-auth handshake,
 * newest-connection-wins, request correlation/timeouts, keepalive.
 */
// @ts-expect-error — plain ESM without types, deliberately dependency-free
import {
  BridgeCore,
  TOKEN_RE,
  generatePairingToken,
  isAllowedOrigin,
} from '../../mcpb/server/bridge-core.mjs';

const TOKEN = 'INF-ABC234';

function makeCore(overrides: Record<string, unknown> = {}) {
  const sent: { connId: string; msg: any }[] = [];
  const closed: { connId: string; reason: string }[] = [];
  const changes: number[] = [];
  const core = new BridgeCore({
    token: TOKEN,
    send: (connId: string, msg: any) => sent.push({ connId, msg }),
    close: (connId: string, reason: string) => closed.push({ connId, reason }),
    onExtensionChange: () => changes.push(Date.now()),
    ...overrides,
  });
  return { core, sent, closed, changes };
}

function connectAndAuth(h: ReturnType<typeof makeCore>, connId = 'c1') {
  h.core.handleConnection(connId, 'chrome-extension://abc');
  h.core.handleMessage(connId, JSON.stringify({ type: 'AUTH', v: 1, token: TOKEN }));
}

describe('token + origin helpers', () => {
  it('generates INF-XXXXXX tokens deterministically from bytes', () => {
    const token = generatePairingToken(new Uint8Array([0, 1, 2, 3, 4, 5]));
    expect(token).toMatch(TOKEN_RE);
    expect(generatePairingToken(new Uint8Array([0, 1, 2, 3, 4, 5]))).toBe(token);
    expect(() => generatePairingToken(new Uint8Array([1]))).toThrow();
  });

  it('allows only chrome-extension origins', () => {
    expect(isAllowedOrigin('chrome-extension://abcdef')).toBe(true);
    expect(isAllowedOrigin('https://inflow.im')).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
  });
});

describe('handshake', () => {
  it('sends HELLO with the token to allowed origins, closes others', () => {
    const h = makeCore();
    h.core.handleConnection('bad', 'https://evil.example');
    expect(h.closed).toEqual([{ connId: 'bad', reason: 'origin-not-allowed' }]);

    h.core.handleConnection('c1', 'chrome-extension://abc');
    expect(h.sent).toEqual([{ connId: 'c1', msg: { type: 'HELLO', v: 1, token: TOKEN } }]);
  });

  it('READY on correct AUTH; close on anything else pre-READY', () => {
    const h = makeCore();
    connectAndAuth(h);
    expect(h.sent[1]).toEqual({ connId: 'c1', msg: { type: 'READY' } });
    expect(h.core.connected).toBe(true);
    expect(h.changes).toHaveLength(1);

    h.core.handleConnection('c2', 'chrome-extension://abc');
    h.core.handleMessage('c2', JSON.stringify({ type: 'AUTH', v: 1, token: 'INF-WRONG2' }));
    expect(h.closed).toContainEqual({ connId: 'c2', reason: 'bad-auth' });

    h.core.handleConnection('c3', 'chrome-extension://abc');
    h.core.handleMessage('c3', JSON.stringify({ type: 'PING' })); // not AUTH
    expect(h.closed).toContainEqual({ connId: 'c3', reason: 'bad-auth' });
  });

  it('newest AUTHed connection replaces the previous one', () => {
    const h = makeCore();
    connectAndAuth(h, 'old');
    connectAndAuth(h, 'new');
    expect(h.closed).toContainEqual({ connId: 'old', reason: 'replaced' });
    expect(h.core.activeConn).toBe('new');
    expect(h.core.connected).toBe(true);
  });

  it('ignores garbage frames', () => {
    const h = makeCore();
    connectAndAuth(h);
    expect(() => {
      h.core.handleMessage('c1', 'not json {');
      h.core.handleMessage('c1', JSON.stringify(null));
      h.core.handleMessage('unknown-conn', JSON.stringify({ type: 'PING' }));
    }).not.toThrow();
  });
});

describe('requests', () => {
  it('rejects immediately when no extension is connected', async () => {
    const h = makeCore();
    await expect(h.core.request({ type: 'LIST_TOOLS' })).rejects.toThrow('not connected');
  });

  it('correlates out-of-order responses by id', async () => {
    const h = makeCore();
    connectAndAuth(h);
    const first = h.core.request({ type: 'CALL_TOOL', tool: 'a' });
    const second = h.core.request({ type: 'CALL_TOOL', tool: 'b' });
    const [id1, id2] = h.sent.slice(-2).map((s) => s.msg.id);

    h.core.handleMessage('c1', JSON.stringify({ id: id2, ok: true, result: 'B' }));
    h.core.handleMessage('c1', JSON.stringify({ id: id1, ok: true, result: 'A' }));
    await expect(second).resolves.toBe('B');
    await expect(first).resolves.toBe('A');
  });

  it('surfaces extension-reported errors and times out silent ones', async () => {
    vi.useFakeTimers();
    try {
      const h = makeCore({ requestTimeoutMs: 1000 });
      connectAndAuth(h);

      const errored = h.core.request({ type: 'CALL_TOOL', tool: 'x' });
      const id = h.sent[h.sent.length - 1].msg.id;
      h.core.handleMessage('c1', JSON.stringify({ id, ok: false, error: 'nope' }));
      await expect(errored).rejects.toThrow('nope');

      const silent = h.core.request({ type: 'CALL_TOOL', tool: 'y' });
      const guarded = silent.catch((e: Error) => e.message);
      vi.advanceTimersByTime(1001);
      expect(await guarded).toContain('did not respond');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects pending requests when the active connection drops', async () => {
    const h = makeCore();
    connectAndAuth(h);
    const pending = h.core.request({ type: 'LIST_TOOLS' });
    h.core.handleClose('c1');
    await expect(pending).rejects.toThrow('disconnected');
    expect(h.core.connected).toBe(false);
    expect(h.changes).toHaveLength(2); // connect + disconnect
  });
});

describe('keepalive + change signals', () => {
  it('answers PING with PONG and relays TOOLS_CHANGED', () => {
    const h = makeCore();
    connectAndAuth(h);
    h.core.handleMessage('c1', JSON.stringify({ type: 'PING' }));
    expect(h.sent[h.sent.length - 1].msg).toEqual({ type: 'PONG' });

    h.core.handleMessage('c1', JSON.stringify({ type: 'TOOLS_CHANGED' }));
    expect(h.changes).toHaveLength(2);
  });
});
