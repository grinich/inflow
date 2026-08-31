/**
 * The extension⇄server bridge protocol, free of IO so the root test suite can
 * drive it without ws or the MCP SDK (test/unit/mcpb-bridge-core.test.ts).
 * index.mjs wires it to a WebSocketServer and the MCP stdio server.
 *
 * Protocol (JSON text frames):
 *   server → { type:'HELLO', v:1, token }        on connect (proves server identity)
 *   ext    → { type:'AUTH',  v:1, token }        (proves the user paired this extension)
 *   server → { type:'READY' }                    both tokens verified
 *   server → { id, type:'LIST_TOOLS' } / { id, type:'CALL_TOOL', tool, input }
 *   ext    → { id, ok:true, result } | { id, ok:false, error }
 *   ext    → { type:'TOOLS_CHANGED' }            settings toggles changed
 *   either → { type:'PING' } / { type:'PONG' }   keepalive (also extends the MV3
 *                                                service worker's lifetime)
 *
 * The port constant is mirrored in entrypoints/background/agent-bridge.ts —
 * change both together.
 */

export const BRIDGE_PORT = 48632;
export const PROTOCOL_VERSION = 1;
export const REQUEST_TIMEOUT_MS = 30000;

const TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // base32, no 0/1/8
export const TOKEN_RE = /^INF-[A-Z2-7]{6}$/;

/** 'INF-XXXXXX' from 6 random bytes (injectable for tests). */
export function generatePairingToken(bytes) {
  if (!bytes || bytes.length < 6) throw new Error('need 6 random bytes');
  let code = '';
  for (let i = 0; i < 6; i++) code += TOKEN_ALPHABET[bytes[i] % 32];
  return `INF-${code}`;
}

/** Only the inflow extension may connect — a browser page can't fake this
 *  header, and non-browser processes still fail the token handshake. */
export function isAllowedOrigin(origin) {
  return typeof origin === 'string' && origin.startsWith('chrome-extension://');
}

/**
 * One bridge: at most one READY extension connection, plus the pending
 * request table for calls forwarded from the MCP side.
 *
 * IO is injected: `send(connId, obj)`, `close(connId, reason)`, and
 * `onExtensionChange()` (connect/disconnect/TOOLS_CHANGED — the MCP side
 * emits notifications/tools/list_changed off it).
 */
export class BridgeCore {
  constructor({ token, send, close, onExtensionChange, requestTimeoutMs = REQUEST_TIMEOUT_MS }) {
    this.token = token;
    this.send = send;
    this.close = close;
    this.onExtensionChange = onExtensionChange;
    this.requestTimeoutMs = requestTimeoutMs;
    this.sessions = new Map(); // connId -> 'hello-sent' | 'ready'
    this.activeConn = null;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.seq = 0;
  }

  get connected() {
    return this.activeConn !== null;
  }

  handleConnection(connId, origin) {
    if (!isAllowedOrigin(origin)) {
      this.close(connId, 'origin-not-allowed');
      return;
    }
    this.sessions.set(connId, 'hello-sent');
    this.send(connId, { type: 'HELLO', v: PROTOCOL_VERSION, token: this.token });
  }

  handleMessage(connId, data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return; // not ours — ignore
    }
    if (!msg || typeof msg !== 'object') return;
    const state = this.sessions.get(connId);

    if (state === 'hello-sent') {
      // Nothing but a correct AUTH is acceptable before READY.
      if (msg.type === 'AUTH' && msg.token === this.token) {
        if (this.activeConn !== null && this.activeConn !== connId) {
          // Newest pairing wins; the stale worker's socket is closed.
          this.close(this.activeConn, 'replaced');
          this.sessions.delete(this.activeConn);
        }
        this.sessions.set(connId, 'ready');
        this.activeConn = connId;
        this.send(connId, { type: 'READY' });
        this.onExtensionChange();
      } else {
        this.sessions.delete(connId);
        this.close(connId, 'bad-auth');
      }
      return;
    }

    if (state !== 'ready') return;

    if (msg.type === 'PING') {
      this.send(connId, { type: 'PONG' });
      return;
    }
    if (msg.type === 'PONG') return;
    if (msg.type === 'TOOLS_CHANGED') {
      this.onExtensionChange();
      return;
    }
    if (typeof msg.id === 'string' && this.pending.has(msg.id)) {
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(typeof msg.error === 'string' ? msg.error : 'extension error'));
    }
  }

  handleClose(connId) {
    this.sessions.delete(connId);
    if (this.activeConn === connId) {
      this.activeConn = null;
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error('inflow extension disconnected'));
        this.pending.delete(id);
      }
      this.onExtensionChange();
    }
  }

  /** Forward a request to the READY extension; resolves with its `result`. */
  request(payload) {
    if (this.activeConn === null) {
      return Promise.reject(
        new Error('inflow extension is not connected — is Chrome running with inflow paired?')
      );
    }
    const id = `srv-${++this.seq}`;
    const connId = this.activeConn;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('inflow extension did not respond'));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send(connId, { id, ...payload });
    });
  }
}
