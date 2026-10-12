#!/usr/bin/env node
/**
 * inflow MCP companion — the local "MCP server" that Claude Desktop connects to.
 *
 * It is a *generic relay*: the real toolbox lives in the inflow browser extension.
 * This process:
 *   1. Speaks MCP to Claude Desktop over stdio (stdout = JSON-RPC; keep it clean).
 *   2. Runs a localhost WebSocket server the inflow tab dials out to.
 *   3. Learns the available tools from the extension's `hello`, exposes them to
 *      Claude, and relays each `tools/call` to the extension, returning results.
 *
 * Security: the extension must present the pairing code (printed to stderr and
 * persisted). Only 127.0.0.1 is bound. Read-only in this version — the extension
 * only advertises read tools, and this relay adds nothing.
 *
 * NOTE: run `npm install` in this folder before first use. This file was authored
 * without an end-to-end run in the dev sandbox — verify against a live Claude
 * Desktop once (see README).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocket, WebSocketServer } from 'ws';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

const PORT = Number(process.env.INFLOW_MCP_PORT || 8123);
const CONFIG_DIR = join(homedir(), '.inflow-mcp');
const TOKEN_FILE = join(CONFIG_DIR, 'token');
const TOOLS_FILE = join(CONFIG_DIR, 'tools.json');
// Catalog shipped with the companion, generated from the extension's own
// descriptors (npm run gen:mcp-tools). Lets a fresh install advertise tools on
// its very first launch, before the inflow tab has ever paired.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TOOLS_FILE = join(MODULE_DIR, 'default-tools.json');
const CALL_TIMEOUT_MS = 30_000;
/**
 * Relay-only: never bind the bridge, always work through the companion that
 * does. For instances started by a client that has no provider keys (e.g. a
 * second MCP client), so they can't win the port and end up serving the
 * extension without an ANTHROPIC_API_KEY — which would silently break inflow's
 * in-app AI. They still get the full toolbox, via the owner.
 */
const RELAY_ONLY = process.env.INFLOW_RELAY_ONLY === '1';
/**
 * Build identity, stamped by scripts/gen-companion-build.mjs at pack time.
 * Reported to inflow so the activity feed can say exactly which build is live.
 * Absent when running from a checkout that was never stamped — say "dev" rather
 * than claiming a version we can't substantiate.
 */
const BUILD_INFO = (() => {
  try {
    return JSON.parse(readFileSync(join(MODULE_DIR, 'build-info.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const COMPANION_VERSION = BUILD_INFO.version || 'dev';
const COMPANION_COMMIT = BUILD_INFO.commit || undefined;
// What inflow compares to decide whether this companion is stale: the commit
// of the companion's own code, not of the repo it was packed from.
const COMPANION_CODE_COMMIT = BUILD_INFO.codeCommit || undefined;
/** True once we own the bridge (the WS server is listening). */
let ownsBridge = false;

// --- Anthropic proxy (for the in-app Claude agent) ------------------------
// The companion calls Anthropic server-side, so the browser's CORS restriction
// (which blocks BAA/enterprise orgs) never applies and the API key stays OUT of
// the browser. The key is read from the companion's own environment — set
// ANTHROPIC_API_KEY (via the .mcpb install prompt or the shell), never sent from
// the extension.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim() || '';

// --- Gemini proxy (optional) ----------------------------------------------
// Same idea as the Anthropic proxy: run Gemini server-side so the key stays OUT
// of the browser. Optional — set GEMINI_API_KEY to enable. The extension picks
// the model per request; we build the endpoint from it.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim() || '';
const geminiUrl = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

/** All logging goes to stderr — stdout is reserved for the MCP protocol. */
const log = (...a) => console.error('[inflow-mcp]', ...a);

/** Load the persisted pairing code, or generate + save one on first run. */
function ensurePairingCode() {
  try {
    if (existsSync(TOKEN_FILE)) {
      const code = readFileSync(TOKEN_FILE, 'utf8').trim();
      if (code) return code;
    }
  } catch {}
  const code = randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})(.{4})/, '$1-$2');
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(TOKEN_FILE, code, { mode: 0o600 });
  } catch (e) {
    log('Could not persist pairing code:', e?.message);
  }
  return code;
}

// Prefer the code Claude injects from the .mcpb install prompt (which the user
// copied from inflow); fall back to a locally-persisted code for `npx` runs.
const PAIRING_CODE = process.env.INFLOW_PAIRING_CODE?.trim() || ensurePairingCode();

function printSetup() {
  const cfg = {
    mcpServers: {
      inflow: { command: 'npx', args: ['-y', 'inflow-mcp'] },
    },
  };
  console.error('');
  console.error('  inflow MCP companion');
  console.error('  ─────────────────────');
  console.error(`  Build:         v${COMPANION_VERSION}${COMPANION_COMMIT ? ` (${COMPANION_COMMIT})` : ''}`);
  console.error(`  Pairing code:  ${PAIRING_CODE}`);
  console.error(`  Claude (Anthropic):  ${ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY set ✓' : 'not set (Claude runs from the browser, if allowed)'}`);
  console.error(`  Gemini (Google):     ${GEMINI_API_KEY ? 'GEMINI_API_KEY set ✓' : 'not set (Gemini runs from the browser)'}`);
  console.error('  Tools:               ' + (advertisedTools.length ? advertisedTools.length + ' available (refreshed when inflow pairs)' : 'none — open the inflow tab once'));
  console.error('  Bridge port:         ' + PORT + (RELAY_ONLY
    ? ' (relay-only: this instance works through the companion that owns the bridge)'
    : ' (checking… see the log line below)'));
  console.error('  Paste this code into inflow → Outbox → Connect Claude.');
  console.error('');
  console.error('  Add to Claude Desktop config (claude_desktop_config.json):');
  console.error(JSON.stringify(cfg, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
  console.error('');
}

if (process.argv.includes('--config') || process.argv.includes('--setup')) {
  printSetup();
  process.exit(0);
}

// --- Extension bridge (WebSocket) -----------------------------------------
/** The currently paired extension socket, if any. */
let extension = null;
/**
 * Tell Claude the tool list changed (set once the MCP server exists). Claude
 * calls tools/list once at startup — before the extension has paired — so we
 * must nudge it to re-fetch when the extension connects (or drops), otherwise
 * it caches an empty toolset and reports "no inflow connector".
 */
let notifyToolsChanged = () => {};
/**
 * Tools advertised to the MCP client (descriptors authored by the extension).
 *
 * Deliberately decoupled from the live extension connection: the catalog is
 * cached to disk when the extension pairs and reloaded at startup, so
 * tools/list is populated before the inflow tab is ever opened, while it is
 * closed, and in a second companion instance that lost the WebSocket port.
 * Previously it was emptied whenever the extension was not paired at that exact
 * moment, so any client that asked during that window saw a tool-less server
 * and cached that snapshot. Calls still fail fast, with a clear message, when
 * the tab is not actually connected.
 */
let advertisedTools = loadCachedTools();

/** Read a tool catalog from disk; null when absent, empty or unreadable. */
function readToolsFile(file) {
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return null;
    const tools = parsed.filter((t) => t && typeof t.name === 'string');
    return tools.length ? tools : null;
  } catch {
    return null;
  }
}

/**
 * The catalog to advertise before (or without) a live extension: the user's
 * cache from their last pairing, else the catalog bundled with this companion.
 * Never throws — a bad file just falls through to the next source.
 */
function loadCachedTools() {
  return readToolsFile(TOOLS_FILE) ?? readToolsFile(DEFAULT_TOOLS_FILE) ?? [];
}

/** Persist the catalog so every future instance can advertise it immediately. */
function saveCachedTools(tools) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(TOOLS_FILE, JSON.stringify(tools, null, 2));
  } catch (e) {
    log('Could not cache the tool list:', e?.message);
  }
}
/** Pending relayed calls, id → { resolve, reject, timer }. */
const pending = new Map();

let wss = null;
/**
 * Only one companion can own the localhost bridge the extension dials into, but
 * every MCP client (Claude Desktop, Claude Code, …) starts its own companion.
 * The one that wins the port is the OWNER and talks to the extension directly.
 * Any other becomes a PEER: it connects to the owner over the same socket and
 * asks it to run tool calls, so every client works instead of the losers being
 * dead weight. Peers keep retrying the bind, so if the owner exits one of them
 * takes over the bridge.
 */
/** Owner side: connected peer companions, for broadcasting catalog changes. */
const peers = new Set();
/** Peer side: our socket to the owner, and calls awaiting its reply. */
let peerSocket = null;
// Set once we are confirmed to be relaying, and cleared only after we announce
// taking the bridge over. The socket itself is already gone by then (the owner
// exiting is what frees the port), so it can't be used to detect a takeover.
let wasRelaying = false;
const peerPending = new Map();
// Slightly longer than the owner's own timeout so a genuine extension timeout
// surfaces as itself rather than as an opaque peer timeout.
const PEER_CALL_TIMEOUT_MS = CALL_TIMEOUT_MS + 5_000;

/**
 * Bind the localhost WebSocket server, retrying on EADDRINUSE instead of dying.
 * Claude Desktop can briefly run two instances during a relaunch; the loser used
 * to give up and the whole connection collapsed. Now the live instance keeps
 * trying until the port frees up, then grabs it and pairs.
 */
function bindWs() {
  if (RELAY_ONLY) {
    // connectAsPeer is a no-op while a socket is open or connecting, so this
    // doubles as the reattach loop if the owner restarts.
    connectAsPeer();
    setTimeout(bindWs, 2000);
    return;
  }
  wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
  wss.on('listening', () => {
    ownsBridge = true;
    log(`bridge port ${PORT} is FREE — listening on ws://127.0.0.1:${PORT}; inflow can pair with this companion`);
    // We just took the bridge (possibly from an owner that exited); stop
    // relaying through anyone else.
    if (peerSocket || wasRelaying) {
      try { peerSocket?.close(); } catch {}
      peerSocket = null;
      wasRelaying = false;
      log('took over the bridge — no longer relaying through another companion');
    }
  });
  wss.on('connection', onConnection);
  wss.on('error', (e) => {
    if (e?.code === 'EADDRINUSE') {
      log(
        `bridge port ${PORT} is BUSY — another inflow companion already owns the bridge. ` +
        `This instance still advertises ${advertisedTools.length} tools, but tool calls will fail ` +
        `until the port frees up (quit the other Claude window, or let a stale process exit). Retrying in 2s…`
      );
      try { wss.close(); } catch {}
      connectAsPeer(); // work through the owner instead of idling
      setTimeout(bindWs, 2000); // and keep trying, in case the owner exits
    } else {
      log('WebSocket server error:', e?.message);
    }
  });
}

function onConnection(socket) {
  let authed = false;
  let isPeer = false;
  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'hello') {
      if (msg.token !== PAIRING_CODE) {
        socket.send(JSON.stringify({ type: 'error', message: 'Wrong pairing code' }));
        socket.close();
        return;
      }
      authed = true;
      extension = socket;
      // Only replace the catalog with a non-empty one, so a malformed hello can
      // never wipe a good cache out from under other clients.
      if (Array.isArray(msg.tools) && msg.tools.length) {
        advertisedTools = msg.tools;
        saveCachedTools(msg.tools);
      }
      // Advertise which provider keys we hold so the extension only routes a
      // provider through us when we can actually run it server-side.
      socket.send(JSON.stringify({
        type: 'hello_ack',
        keys: { anthropic: !!ANTHROPIC_API_KEY, gemini: !!GEMINI_API_KEY },
        // Companion-side facts the browser otherwise has no way to know.
        status: {
          version: COMPANION_VERSION,
          commit: COMPANION_COMMIT,
          codeCommit: COMPANION_CODE_COMMIT,
          port: PORT,
          ownsBridge,
          tools: advertisedTools.length,
          peers: peers.size,
        },
      }));
      log(`extension paired; ${advertisedTools.length} tools available`);
      notifyToolsChanged(); // Claude re-fetches tools/list now that they exist
      broadcastToolsToPeers(); // and so do any companions relaying through us
      return;
    }
    // Another companion asking us (the bridge owner) to work on its behalf.
    if (msg.type === 'peer_hello') {
      if (msg.token !== PAIRING_CODE) {
        socket.send(JSON.stringify({ type: 'error', message: 'Wrong pairing code' }));
        socket.close();
        return;
      }
      authed = true;
      isPeer = true;
      peers.add(socket);
      socket.send(JSON.stringify({ type: 'peer_ack', tools: advertisedTools }));
      log(`peer companion attached (${peers.size} now relaying through this one)`);
      sendActivity(`Another Claude client attached — ${peers.size} relaying through this companion`);
      return;
    }
    if (!authed) return;

    // A peer's tool call. We run it against OUR extension and send the result
    // back. Peers never forward to other peers, so this cannot loop.
    if (msg.type === 'peer_call') {
      callExtension(msg.name, msg.args).then(
        (data) => { try { socket.send(JSON.stringify({ type: 'peer_result', id: msg.id, ok: true, data })); } catch {} },
        (e) => { try { socket.send(JSON.stringify({ type: 'peer_result', id: msg.id, ok: false, error: e?.message || 'Tool failed' })); } catch {} },
      );
      return;
    }

    if (msg.type === 'result') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || 'Tool failed'));
      return;
    }
    // Extension → companion → Anthropic (the in-app Claude agent's transport).
    if (msg.type === 'anthropic') {
      void handleAnthropic(socket, msg);
      return;
    }
    // Extension → companion → Gemini (server-side Gemini, key kept here).
    if (msg.type === 'gemini') {
      void handleGemini(socket, msg);
      return;
    }
    if (msg.type === 'pong') return;
  });

  socket.on('close', () => {
    if (isPeer) {
      peers.delete(socket);
      log(`peer companion detached (${peers.size} still relaying)`);
      sendActivity(`A Claude client detached — ${peers.size} still relaying`);
    }
    if (extension === socket) {
      extension = null;
      // Keep advertising the catalog: the tools still exist, inflow just is not
      // open. Clearing it here is what made Claude see a tool-less server.
      log('extension disconnected (still advertising ' + advertisedTools.length + ' tools)');
    }
  });
}

bindWs();

/**
 * Proxy one Messages API request for the extension's Claude agent. The key is
 * added here (server-side) — the extension only sends the request body. Replies
 * with `anthropic_result` { id, ok, data|error } on the same socket.
 */
async function handleAnthropic(socket, msg) {
  const id = msg.id;
  const reply = (obj) => {
    try { socket.send(JSON.stringify({ type: 'anthropic_result', id, ...obj })); } catch {}
  };
  if (!ANTHROPIC_API_KEY) {
    reply({ ok: false, error: 'No Anthropic key in the companion. Set ANTHROPIC_API_KEY and restart it.' });
    return;
  }
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(msg.payload || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      reply({ ok: false, error: data?.error?.message || `Anthropic HTTP ${res.status}` });
      return;
    }
    reply({ ok: true, data });
  } catch (e) {
    reply({ ok: false, error: e?.message || 'Anthropic request failed' });
  }
}

/**
 * Proxy one Gemini generateContent request for the extension. The key is added
 * here (server-side); the extension sends the model + request body. Replies with
 * `gemini_result` { id, ok, data|error } on the same socket.
 */
async function handleGemini(socket, msg) {
  const id = msg.id;
  const reply = (obj) => {
    try { socket.send(JSON.stringify({ type: 'gemini_result', id, ...obj })); } catch {}
  };
  if (!GEMINI_API_KEY) {
    reply({ ok: false, error: 'No Gemini key in the companion. Set GEMINI_API_KEY and restart it.' });
    return;
  }
  const model = (msg.model || '').toString().trim();
  if (!model) {
    reply({ ok: false, error: 'No Gemini model specified.' });
    return;
  }
  try {
    const res = await fetch(geminiUrl(model), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify(msg.body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      reply({ ok: false, error: data?.error?.message || `Gemini HTTP ${res.status}` });
      return;
    }
    reply({ ok: true, data });
  } catch (e) {
    reply({ ok: false, error: e?.message || 'Gemini request failed' });
  }
}

/**
 * Send a line to inflow's in-app activity feed. Only the bridge owner can: the
 * extension is connected to us, not to peers. Without this the companion's side
 * of the story (which port, owner vs relay, how many clients) only ever reached
 * the MCP client's log file, never the user.
 */
function sendActivity(text) {
  if (!extension || extension.readyState !== extension.OPEN) return;
  try { extension.send(JSON.stringify({ type: 'activity', text })); } catch {}
}

/** Tell every attached peer the catalog changed, so their clients refresh. */
function broadcastToolsToPeers() {
  for (const sock of peers) {
    try { sock.send(JSON.stringify({ type: 'peer_tools', tools: advertisedTools })); } catch {}
  }
}

/**
 * Attach to the companion that owns the bridge, so our client's tool calls can
 * be run through it. Idempotent: a live or pending socket short-circuits.
 */
function connectAsPeer() {
  if (peerSocket && (peerSocket.readyState === WebSocket.OPEN || peerSocket.readyState === WebSocket.CONNECTING)) return;
  let sock;
  try {
    sock = new WebSocket(`ws://127.0.0.1:${PORT}`);
  } catch (e) {
    log('could not reach the companion that owns the bridge:', e?.message);
    return;
  }
  peerSocket = sock;

  sock.on('open', () => sock.send(JSON.stringify({ type: 'peer_hello', token: PAIRING_CODE })));

  sock.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'peer_ack' || msg.type === 'peer_tools') {
      if (Array.isArray(msg.tools) && msg.tools.length) {
        advertisedTools = msg.tools;
        notifyToolsChanged();
      }
      if (msg.type === 'peer_ack') {
        wasRelaying = true;
        log(`relaying through the companion that owns the bridge (${advertisedTools.length} tools)`);
      }
      return;
    }
    if (msg.type === 'peer_result') {
      const pend = peerPending.get(msg.id);
      if (!pend) return;
      peerPending.delete(msg.id);
      clearTimeout(pend.timer);
      if (msg.ok) pend.resolve(msg.data);
      else pend.reject(new Error(msg.error || 'Tool failed'));
      return;
    }
    if (msg.type === 'error') log('bridge owner rejected us:', msg.message);
  });

  const drop = () => {
    if (peerSocket === sock) peerSocket = null;
    // Fail fast rather than leaving the client hanging until each timeout.
    for (const [, pend] of peerPending) {
      clearTimeout(pend.timer);
      pend.reject(new Error('The companion that owns the inflow bridge went away.'));
    }
    peerPending.clear();
  };
  sock.on('close', drop);
  sock.on('error', drop);
}

/** Ask the bridge owner to run a tool for us, and await its reply. */
function callViaPeer(name, args) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      peerPending.delete(id);
      reject(new Error('The companion that owns the inflow bridge did not respond in time.'));
    }, PEER_CALL_TIMEOUT_MS);
    peerPending.set(id, { resolve, reject, timer });
    try {
      peerSocket.send(JSON.stringify({ type: 'peer_call', id, name, args: args || {} }));
    } catch (e) {
      peerPending.delete(id);
      clearTimeout(timer);
      reject(new Error(e?.message || 'Could not reach the companion that owns the bridge.'));
    }
  });
}

/** Send a tool call straight to our own paired extension. */
function callExtension(name, args) {
  return new Promise((resolve, reject) => {
    if (!extension || extension.readyState !== extension.OPEN) {
      reject(new Error('inflow is not connected. Open the inflow tab — it pairs automatically.'));
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('inflow did not respond in time.'));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    extension.send(JSON.stringify({ type: 'call', id, name, args: args || {} }));
  });
}

/** Relay a tool call to the paired extension and await its result. */
function relayCall(name, args) {
  // We own the bridge: straight to the extension.
  if (extension && extension.readyState === extension.OPEN) return callExtension(name, args);
  // Another companion owns it: ask them to run it for us.
  if (peerSocket && peerSocket.readyState === WebSocket.OPEN) return callViaPeer(name, args);
  // Neither: the tab is closed (or we have not attached to the owner yet).
  if (peerSocket && peerSocket.readyState === WebSocket.CONNECTING) {
    return Promise.reject(new Error('Still attaching to the companion that owns the inflow bridge — try again in a moment.'));
  }
  return Promise.reject(new Error('inflow is not connected. Open the inflow tab — it pairs automatically.'));
}

// --- MCP server (stdio to Claude Desktop) ---------------------------------
const server = new Server(
  { name: 'inflow', version: '0.1.0' },
  {
    capabilities: { tools: { listChanged: true } },
    // Surfaced to the model by MCP clients as a briefing on what this server is.
    // Deliberately only the durable description — operational specifics (what
    // never sends, what needs the tab open, which tools combine) live in the
    // tool descriptions, so they travel with the tools instead of going stale
    // in a string the companion has to be rebuilt to change.
    instructions:
      'inflow is the user\u2019s LinkedIn messaging client and network CRM, running locally in ' +
      'their browser. Use these tools to read their connections, search message history, ' +
      'triage the inbox, and draft messages.',
  },
);

// Now that the server exists, wire the "tools changed" nudge. Prefer the SDK
// helper; fall back to a raw notification for older SDKs.
notifyToolsChanged = () => {
  try {
    if (typeof server.sendToolListChanged === 'function') server.sendToolListChanged();
    else server.notification({ method: 'notifications/tools/list_changed' });
  } catch (e) {
    log('tools/list_changed notify failed:', e?.message);
  }
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: advertisedTools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema || { type: 'object' },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const data = await relayCall(name, args);
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e?.message || 'call failed'}` }], isError: true };
  }
});

printSetup();
await server.connect(new StdioServerTransport());
log('MCP server ready (stdio).');

// Exit when Claude disconnects so we never orphan a process that keeps holding
// the WS port (which would block the next launch from binding). Cover the MCP
// transport close, a closed stdin, and the usual termination signals.
server.onclose = () => { log('Claude disconnected — exiting'); process.exit(0); };
process.stdin.on('close', () => process.exit(0));
process.stdin.on('end', () => process.exit(0));
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(0));
