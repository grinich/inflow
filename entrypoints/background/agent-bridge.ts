/**
 * WebSocket client to the Inflow.mcpb bridge (Claude Desktop).
 *
 * The .mcpb server owns ws://127.0.0.1:48632 and the pairing token; this
 * worker dials OUT to it whenever agent access is enabled and a pairing code
 * is saved, then serves LIST_TOOLS / CALL_TOOL through the same gated
 * executor as every other transport. Protocol and port are defined in
 * mcpb/server/bridge-core.mjs — change both sides together.
 *
 * MV3 lifetime: WebSocket traffic extends the service worker's life
 * (Chrome 116+), and the server pings every 20s. A 30s chrome.alarms loop is
 * the durable reconnect path for when the worker was suspended or the server
 * wasn't running yet.
 */

import {
  AGENT_BRIDGE_STATUS_KEY,
  AGENT_BRIDGE_TOKEN_KEY,
  AGENT_TOOLS_ENABLED_KEY,
  AGENT_WRITES_ENABLED_KEY,
  getAgentBridgeToken,
  getAgentToolsEnabled,
} from '@/lib/agent-settings';
import { setAgentBridgeCaller } from '@/lib/agent-tools/bridge-caller';
import { callTool, listTools } from '@/lib/agent-tools/executor';
import { handleMessage } from './messages';

const BRIDGE_URL = 'ws://127.0.0.1:48632'; // = BRIDGE_PORT in mcpb/server/bridge-core.mjs
const RECONNECT_ALARM = 'agent-bridge-reconnect';

export type AgentBridgeState = 'connected' | 'disconnected' | 'unpaired' | 'disabled';

let socket: WebSocket | null = null;
let ready = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelayMs = 1000;
let lastPublishedState: AgentBridgeState | null = null;

function publishStatus(state: AgentBridgeState): void {
  if (state === lastPublishedState) return;
  lastPublishedState = state;
  chrome.storage.local
    .set({ [AGENT_BRIDGE_STATUS_KEY]: { state, at: Date.now() } })
    .catch(() => {});
}

function disconnect(state: AgentBridgeState): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  ready = false;
  if (socket) {
    const s = socket;
    socket = null; // clear first so onclose doesn't schedule a retry
    try {
      s.close();
    } catch {}
  }
  publishStatus(state);
}

function scheduleRetry(token: string): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect(token);
  }, retryDelayMs);
  retryDelayMs = Math.min(retryDelayMs * 2, 30000);
}

function connect(token: string): void {
  if (socket) return; // open or connecting
  let ws: WebSocket;
  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch {
    scheduleRetry(token);
    return;
  }
  socket = ws;

  ws.onmessage = (event) => {
    let msg: any;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'HELLO') {
      if (msg.token === token) {
        ws.send(JSON.stringify({ type: 'AUTH', v: 1, token }));
      } else {
        // The server's token isn't the code the user pasted — a stale or
        // wrong pairing. Don't hot-retry; the alarm re-checks after the user
        // fixes the code.
        socket = null;
        try {
          ws.close();
        } catch {}
        publishStatus('unpaired');
      }
      return;
    }
    if (msg.type === 'READY') {
      ready = true;
      retryDelayMs = 1000;
      publishStatus('connected');
      return;
    }
    if (msg.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG' }));
      return;
    }
    if (typeof msg.id === 'string' && (msg.type === 'LIST_TOOLS' || msg.type === 'CALL_TOOL')) {
      void answer(ws, msg);
    }
  };

  ws.onclose = () => {
    ready = false;
    if (socket === ws) {
      socket = null;
      publishStatus('disconnected');
      scheduleRetry(token);
    }
  };
  ws.onerror = () => {
    // onclose follows and handles retry.
  };
}

async function answer(
  ws: WebSocket,
  msg: { id: string; type: string; tool?: unknown; input?: unknown }
): Promise<void> {
  let result: unknown;
  try {
    result =
      msg.type === 'LIST_TOOLS'
        ? await listTools()
        : await callTool(typeof msg.tool === 'string' ? msg.tool : '', msg.input);
  } catch (e) {
    // Executor contract is never-throw; a bug still must answer.
    result = {
      content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
      isError: true,
    };
  }
  try {
    ws.send(JSON.stringify({ id: msg.id, ok: true, result }));
  } catch {}
}

/** Re-read settings and converge the connection + alarm to match. */
async function evaluate(): Promise<void> {
  const [enabled, token] = await Promise.all([getAgentToolsEnabled(), getAgentBridgeToken()]);
  if (!enabled || !token) {
    try {
      void chrome.alarms.clear(RECONNECT_ALARM);
    } catch {}
    disconnect(!enabled ? 'disabled' : 'unpaired');
    return;
  }
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  if (!socket) {
    publishStatus('disconnected');
    connect(token);
  }
}

export function setupAgentBridge(): void {
  // This executor runs in the worker: bridge messages go straight to the
  // internal router (idempotent with setupExternalMessageRouter's call).
  setAgentBridgeCaller(handleMessage);

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) void evaluate();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (AGENT_TOOLS_ENABLED_KEY in changes || AGENT_BRIDGE_TOKEN_KEY in changes) {
      // Token or master toggle changed: drop any current session so the
      // handshake reruns against the new values.
      disconnect('disconnected');
      lastPublishedState = null; // evaluate() decides the real state
      void evaluate();
      return;
    }
    if (AGENT_WRITES_ENABLED_KEY in changes && ready && socket) {
      try {
        socket.send(JSON.stringify({ type: 'TOOLS_CHANGED' }));
      } catch {}
    }
  });

  void evaluate();
}
