/**
 * MCP bridge client — owns the localhost WebSocket to the companion and wires
 * the pure {@link createBridgeSession} protocol to the UI store. Runs in the app
 * tab (which has DB access and outlives the MV3 service worker while open).
 *
 * The connection is best-effort: if the companion isn't running the socket fails
 * and we retry with backoff. Closing the inflow tab drops the bridge — that's an
 * accepted trade for keeping everything local and keyless.
 */
import { createBridgeSession, type BridgeStatus, type CompanionKeys } from './bridge-protocol';
import { toolDescriptors, callTool } from './tools';
import { DEFAULT_MCP_URL } from './pairing';
import { useUIStore } from '@/store/ui-store';

let ws: WebSocket | null = null;
let stopped = true;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let activeToken = '';
let activeUrl = DEFAULT_MCP_URL;
let connected = false;

// Which provider keys the companion holds — learned from hello_ack. Until the
// handshake completes (or after a drop) we assume none, so we never route a
// provider through a companion that can't fulfil it.
let companionKeys: CompanionKeys = { anthropic: false, gemini: false };

// Pending proxy requests (id → settlers), shared by the Anthropic and Gemini
// server-side paths. Both settle by id, so one map serves both providers.
const proxyPending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let proxySeq = 0;
const PROXY_TIMEOUT_MS = 120_000;

/** True when the companion socket is open and paired. */
export function isCompanionConnected(): boolean {
  return connected && !!ws && ws.readyState === WebSocket.OPEN;
}

/** Whether the connected companion holds a key for `provider`. */
export function companionHasKey(provider: 'anthropic' | 'gemini'): boolean {
  return isCompanionConnected() && companionKeys[provider];
}

/**
 * Ask the companion to run one request server-side (it adds the key), for the
 * given provider. `type` is the wire verb ('anthropic' | 'gemini'); `msg` carries
 * the provider-specific fields. Resolves with the parsed response, or rejects on
 * error/timeout. The reply (`<type>_result`) settles by id via {@link settleProxy}.
 */
function requestViaCompanion(type: 'anthropic' | 'gemini', prefix: string, msg: object): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!isCompanionConnected()) {
      reject(new Error('The companion is not connected. Open the MCP connector and connect it.'));
      return;
    }
    const id = `${prefix}-${Date.now()}-${proxySeq++}`;
    const timer = setTimeout(() => {
      proxyPending.delete(id);
      reject(new Error('The companion did not respond in time.'));
    }, PROXY_TIMEOUT_MS);
    proxyPending.set(id, { resolve, reject, timer });
    try {
      ws!.send(JSON.stringify({ type, id, ...msg }));
    } catch (e: any) {
      proxyPending.delete(id);
      clearTimeout(timer);
      reject(new Error(e?.message || 'Could not reach the companion.'));
    }
  });
}

/**
 * Run one Anthropic Messages API request through the companion (it adds the key
 * server-side, so the browser's CORS restriction never applies).
 */
export function requestAnthropicViaCompanion(payload: object): Promise<any> {
  return requestViaCompanion('anthropic', 'an', { payload });
}

/**
 * Run one Gemini generateContent request through the companion (key kept in the
 * companion env, off the browser). `model` picks the endpoint; `body` is the
 * request body.
 */
export function requestGeminiViaCompanion(model: string, body: object): Promise<any> {
  return requestViaCompanion('gemini', 'gm', { model, body });
}

function settleProxy(id: string, ok: boolean, data: any, error?: string) {
  const p = proxyPending.get(id);
  if (!p) return;
  proxyPending.delete(id);
  clearTimeout(p.timer);
  if (ok) p.resolve(data);
  else p.reject(new Error(error || 'Companion request failed'));
}

function rejectAllProxy(reason: string) {
  for (const [, p] of proxyPending) {
    clearTimeout(p.timer);
    p.reject(new Error(reason));
  }
  proxyPending.clear();
}
// Track transitions so the activity feed shows connection progress without
// spamming a line on every backoff tick.
let wasConnected = false;
let loggedWaiting = false;

function setStatus(status: BridgeStatus, error?: string) {
  useUIStore.getState().setMcpStatus(status, error ?? null);
}
/**
 * The companion code this extension build expects, injected by the bundler.
 * Not the extension's own commit: staleness is about the companion's code, and
 * comparing repo HEAD flagged every unrelated commit. Absent under test (and in
 * any build without the define), so callers must treat it as optional.
 */
function appCompanionSha(): string | undefined {
  return typeof __COMPANION_SHA__ === 'string' ? __COMPANION_SHA__ : undefined;
}

function pushActivity(text: string) {
  useUIStore.getState().pushMcpActivity(text);
}

/** Backoff schedule (ms), capped — companion may simply not be running yet. */
function nextDelay(): number {
  const steps = [1000, 2000, 5000, 10000, 20000, 30000];
  return steps[Math.min(retry, steps.length - 1)];
}

function scheduleReconnect() {
  if (stopped) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retry += 1;
    open();
  }, nextDelay());
}

function open() {
  if (stopped) return;
  try {
    ws = new WebSocket(activeUrl);
  } catch {
    setStatus('error', 'Could not open a local connection');
    scheduleReconnect();
    return;
  }

  const session = createBridgeSession({
    token: activeToken,
    tools: toolDescriptors(),
    callTool,
    send: (msg) => {
      try {
        ws?.send(JSON.stringify(msg));
      } catch {
        /* socket closed mid-send */
      }
    },
    onStatus: (s, e) => {
      setStatus(s, e);
      connected = s === 'connected';
      if (s === 'connected') {
        wasConnected = true;
        loggedWaiting = false;
      }
    },
    appCompanionSha: appCompanionSha(),
    onActivity: (t) => pushActivity(t),
    onCompanionKeys: (keys) => {
      companionKeys = keys;
      // Mirror into the store so Settings can show where each key lives, live.
      useUIStore.getState().setMcpKeys(keys);
    },
    onAnthropicResult: (id, ok, data, error) => settleProxy(id, ok, data, error),
    onGeminiResult: (id, ok, data, error) => settleProxy(id, ok, data, error),
  });

  setStatus('connecting');

  ws.onopen = () => {
    retry = 0;
    session.open();
  };
  ws.onmessage = (ev) => {
    void session.handleMessage(typeof ev.data === 'string' ? ev.data : '');
  };
  ws.onerror = () => {
    // onclose fires next and handles the retry; keep the message quiet since a
    // missing companion is the common, expected case.
  };
  ws.onclose = () => {
    ws = null;
    connected = false;
    companionKeys = { anthropic: false, gemini: false };
    rejectAllProxy('The companion connection dropped.');
    if (stopped) {
      setStatus('disconnected');
      return;
    }
    setStatus('connecting');
    if (wasConnected) {
      pushActivity('Connection to the companion lost — reconnecting…');
      wasConnected = false;
    } else if (!loggedWaiting) {
      pushActivity(`Waiting for the companion on ${activeUrl} — install it from the MCP connector, then keep this tab open.`);
      loggedWaiting = true;
    }
    scheduleReconnect();
  };
}

/** Start (or restart) the bridge with a pairing token. Idempotent. */
export function startMcpBridge(token: string, url: string = DEFAULT_MCP_URL) {
  activeToken = token;
  activeUrl = url;
  stopped = false;
  retry = 0;
  wasConnected = false;
  loggedWaiting = false;
  pushActivity(`Connecting to the companion on ${activeUrl}…`);
  clearTimeout(retryTimer);
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  open();
}

/** Stop the bridge and mark disconnected. */
export function stopMcpBridge() {
  stopped = true;
  connected = false;
  companionKeys = { anthropic: false, gemini: false };
  rejectAllProxy('The companion was disconnected.');
  clearTimeout(retryTimer);
  try {
    ws?.close();
  } catch {
    /* ignore */
  }
  ws = null;
  setStatus('disconnected');
}
