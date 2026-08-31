#!/usr/bin/env node
/**
 * Inflow.mcpb — the Claude Desktop side of the inflow agent bridge.
 *
 * Speaks MCP over stdio to the host app and owns ws://127.0.0.1:48632, which
 * the inflow extension's service worker dials into (see
 * entrypoints/background/agent-bridge.ts). Tool calls forward to the
 * extension's gated executor; its results are already MCP CallToolResults and
 * pass through verbatim. All authorization lives in the extension (opt-in
 * toggles, send cap) — this process only relays.
 *
 * stdout belongs to the MCP transport; every log goes to stderr.
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  BRIDGE_PORT,
  BridgeCore,
  TOKEN_RE,
  generatePairingToken,
} from './bridge-core.mjs';

const VERSION = '0.7.0';
const log = (...args) => console.error('[inflow-mcpb]', ...args);

// ---------------------------------------------------------------------------
// Pairing token: generated once, kept in ~/.inflow. The user reads it via the
// get_pairing_code tool and pastes it into inflow's Agent Access modal.
// ---------------------------------------------------------------------------

function loadOrCreateToken() {
  const dir = join(homedir(), '.inflow');
  const file = join(dir, 'agent-bridge.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed.token === 'string' && TOKEN_RE.test(parsed.token)) return parsed.token;
  } catch {}
  const token = generatePairingToken(randomBytes(6));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ token }, null, 2), { mode: 0o600 });
  } catch (e) {
    log('could not persist pairing token (will regenerate next run):', e.message);
  }
  return token;
}

const token = loadOrCreateToken();

// ---------------------------------------------------------------------------
// MCP server (stdio)
// ---------------------------------------------------------------------------

const mcp = new Server(
  { name: 'inflow', version: VERSION },
  { capabilities: { tools: { listChanged: true } } }
);

let portConflict = false;
let mcpConnected = false;

function notifyToolsChanged() {
  if (!mcpConnected) return;
  Promise.resolve()
    .then(() =>
      typeof mcp.sendToolListChanged === 'function'
        ? mcp.sendToolListChanged()
        : mcp.notification({ method: 'notifications/tools/list_changed' })
    )
    .catch((e) => log('tools/list_changed notification failed:', e.message));
}

const bridge = new BridgeCore({
  token,
  send: (connId, obj) => sockets.get(connId)?.send(JSON.stringify(obj)),
  close: (connId, reason) => {
    log('closing extension socket:', reason);
    sockets.get(connId)?.close(4000, reason);
    sockets.delete(connId);
  },
  onExtensionChange: notifyToolsChanged,
});

function statusText() {
  const state = portConflict
    ? `Port ${BRIDGE_PORT} is in use by another process — quit it (or a second copy of this server) and restart Claude Desktop.`
    : bridge.connected
      ? 'Connected to the inflow extension. LinkedIn tools are live.'
      : 'Waiting for the inflow extension. Checklist: 1) Chrome is running with the inflow extension installed (v0.8.0+), 2) agent access is enabled in inflow (⌘K → Configure agent access), 3) the pairing code from get_pairing_code is pasted and saved there. The extension retries every 30 seconds.';
  return state;
}

const LOCAL_TOOLS = [
  {
    name: 'inflow_status',
    description:
      'Whether this bridge is connected to the inflow Chrome extension, with setup guidance if not. Call this first if LinkedIn tools are missing or failing.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_pairing_code',
    description:
      "The one-time pairing code the user must paste into inflow's Agent Access settings (⌘K → Configure agent access) to authorize this bridge. Show it to the user when asked, or when inflow_status reports the extension is unpaired.",
    inputSchema: { type: 'object', properties: {} },
  },
];

const text = (s, isError = false) => ({
  content: [{ type: 'text', text: s }],
  ...(isError ? { isError: true } : {}),
});

mcp.setRequestHandler(ListToolsRequestSchema, async () => {
  let forwarded = [];
  if (bridge.connected) {
    try {
      const list = await bridge.request({ type: 'LIST_TOOLS' });
      forwarded = (list?.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    } catch (e) {
      log('LIST_TOOLS forward failed:', e.message);
    }
  }
  return { tools: [...LOCAL_TOOLS, ...forwarded] };
});

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: input } = req.params;
  if (name === 'inflow_status') {
    return text(statusText());
  }
  if (name === 'get_pairing_code') {
    return text(
      `Pairing code: ${token}\n\nHave the user paste this into inflow: open the inflow app in Chrome, press ⌘K, run "Configure agent access", enter the code under Claude Desktop, and Save.`
    );
  }
  try {
    // The extension answers with an MCP CallToolResult — pass it through.
    return await bridge.request({ type: 'CALL_TOOL', tool: name, input: input ?? {} });
  } catch (e) {
    return text(`Error: ${e.message} (call inflow_status for setup guidance)`, true);
  }
});

// ---------------------------------------------------------------------------
// WebSocket server the extension dials into
// ---------------------------------------------------------------------------

const sockets = new Map(); // connId -> ws
let connSeq = 0;

const http = createServer();
const wss = new WebSocketServer({ server: http });

wss.on('connection', (ws, req) => {
  const connId = `conn-${++connSeq}`;
  sockets.set(connId, ws);
  ws.on('message', (data) => bridge.handleMessage(connId, data.toString()));
  ws.on('close', () => {
    sockets.delete(connId);
    bridge.handleClose(connId);
  });
  ws.on('error', (e) => log('socket error:', e.message));
  bridge.handleConnection(connId, req.headers.origin);
});

// App-level keepalive: traffic on the socket is what keeps the extension's
// MV3 service worker alive (Chrome 116+ extends worker lifetime on WebSocket
// activity), so the server drives a PING every 20 seconds.
setInterval(() => {
  if (bridge.connected) {
    try {
      bridge.send(bridge.activeConn, { type: 'PING' });
    } catch {}
  }
}, 20000).unref();

http.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    portConflict = true;
    log(`port ${BRIDGE_PORT} in use — bridge disabled, MCP server still up`);
  } else {
    log('bridge server error:', e.message);
  }
});
http.listen(BRIDGE_PORT, '127.0.0.1', () => log(`bridge listening on 127.0.0.1:${BRIDGE_PORT}`));

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await mcp.connect(transport);
mcpConnected = true;
log(`inflow mcpb v${VERSION} ready (token ${token.slice(0, 4)}…)`);
