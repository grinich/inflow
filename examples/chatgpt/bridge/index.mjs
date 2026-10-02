#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { BridgeCore, generatePairingToken, TOKEN_RE } from '../vendor/bridge-core.mjs';

const base = (process.env.INFLOW_PUBLIC_URL || '').replace(/\/$/, '');
const secret = process.env.INFLOW_BRIDGE_KEY || '';
if (!base || secret.length < 32)
  throw new Error(
    'Set INFLOW_PUBLIC_URL and INFLOW_BRIDGE_KEY in your private bridge environment file.',
  );
const url = new URL(base);
if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname))
  throw new Error('The cloud bridge requires HTTPS.');
const state = resolve(process.env.INFLOW_STATE_DIR || '.inflow-local');
mkdirSync(state, { recursive: true, mode: 0o700 });
const tokenFile = resolve(state, 'agent-bridge.json');
let token;
try {
  token = JSON.parse(readFileSync(tokenFile, 'utf8')).token;
} catch {}
if (!TOKEN_RE.test(token || '')) {
  token = generatePairingToken(randomBytes(6));
  writeFileSync(tokenFile, JSON.stringify({ token }), { mode: 0o600 });
}
chmodSync(tokenFile, 0o600);
const sockets = new Map();
const bridge = new BridgeCore({
  token,
  send: (id, data) => sockets.get(id)?.send(JSON.stringify(data)),
  close: (id) => {
    sockets.get(id)?.close();
    sockets.delete(id);
  },
  onExtensionChange: () =>
    console.error(
      bridge.connected ? 'Inflow browser connected.' : 'Waiting for the Inflow browser.',
    ),
});
const http = createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server: http, maxPayload: 4000000 });
let seq = 0;
wss.on('connection', (ws, req) => {
  const id = String(++seq);
  sockets.set(id, ws);
  ws.on('message', (d) => bridge.handleMessage(id, d.toString()));
  ws.on('close', () => {
    sockets.delete(id);
    bridge.handleClose(id);
  });
  ws.on('error', () => {});
  bridge.handleConnection(id, req.headers.origin);
});
const fatal = (e) => {
  console.error(
    e.code === 'EADDRINUSE'
      ? 'Port 48632 is busy. Stop the other Inflow bridge before starting this one.'
      : e.message,
  );
  process.exit(1);
};
http.on('error', fatal);
wss.on('error', fatal);
http.listen(48632, '127.0.0.1', () =>
  console.error(
    `Pair Inflow using https://inflow.im/app?pair=${token}\nEnable agent access in Inflow. Keep this bridge and Chrome running.`,
  ),
);
setInterval(() => {
  if (bridge.connected)
    try {
      bridge.send(bridge.activeConn, { type: 'PING' });
    } catch {}
}, 20000).unref();
const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
let running = true;
process.on('SIGINT', () => {
  running = false;
  http.close();
  wss.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  running = false;
  process.exit(0);
});
let cloudFailure = false;
while (running) {
  try {
    const response = await fetch(`${base}/bridge/poll`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ connected: bridge.connected, pairingCode: token }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw new Error(`Cloud returned ${response.status}`);
    if (cloudFailure) {
      console.error('Cloud connection restored.');
      cloudFailure = false;
    }
    const { commands } = await response.json();
    for (const command of commands || []) {
      let result;
      try {
        result = await bridge.request({
          type: 'CALL_TOOL',
          tool: command.tool,
          input: command.input,
        });
      } catch (e) {
        result = { isError: true, content: [{ type: 'text', text: e.message }] };
      }
      // One delivery, no automatic tool retry, especially for writes.
      const reply = await fetch(`${base}/bridge/result`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: command.id, result }),
        signal: AbortSignal.timeout(10000),
      });
      if (!reply.ok)
        console.error('A result was not accepted. Check the inbox before retrying a write.');
    }
    if (!bridge.connected) await new Promise((r) => setTimeout(r, 2000));
  } catch (e) {
    if (!cloudFailure) console.error(`Cloud connection unavailable: ${e.message}. Reconnecting…`);
    cloudFailure = true;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
