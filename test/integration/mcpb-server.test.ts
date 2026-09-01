/**
 * The Inflow.mcpb server, run for real: spawned as a child process, driven
 * over stdio with JSON-RPC exactly as Claude Desktop does, and connected to by
 * a WebSocket client standing in for the extension.
 *
 * bridge-core covers the protocol in isolation; this covers the wiring around
 * it — the MCP handlers, the pairing token on disk, the tools/list_changed
 * notification, the origin gate, and the behaviour when no extension is
 * connected. It runs on its own port and its own state directory, so it can't
 * collide with a real Claude Desktop or overwrite the developer's pairing
 * token.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SERVER = join(ROOT, 'mcpb', 'server', 'index.mjs');
const require = createRequire(join(ROOT, 'mcpb', 'package.json'));

/** A port unlikely to collide with a real bridge or another test run. */
const PORT = 49000 + Math.floor(Math.random() * 500);

let server: ChildProcessWithoutNullStreams;
let stateDir: string;
let WebSocket: any;
let pending: Map<number, (m: any) => void>;
let notifications: string[];
let rpcSeq: number;

/** Skip rather than fail if the bundle's deps were never installed. */
let depsPresent = true;
try {
  WebSocket = require('ws');
} catch {
  depsPresent = false;
}

function rpc(method: string, params: unknown = {}): Promise<any> {
  const id = ++rpcSeq;
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    setTimeout(() => reject(new Error(`timed out: ${method}`)), 10_000);
  });
}

const text = (r: any) => r.result.content[0].text as string;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  if (!depsPresent) return;
  stateDir = mkdtempSync(join(tmpdir(), 'inflow-mcpb-'));
  pending = new Map();
  notifications = [];
  rpcSeq = 0;

  server = spawn('node', [SERVER], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, INFLOW_BRIDGE_PORT: String(PORT), INFLOW_STATE_DIR: stateDir },
  }) as ChildProcessWithoutNullStreams;

  let buf = '';
  server.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      } else if (msg.method) {
        notifications.push(msg.method);
      }
    }
  });

  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'vitest', version: '0' },
  });
  expect(init.result.serverInfo.name).toBe('inflow');
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await sleep(300); // let the ws server bind
}, 30_000);

afterAll(() => {
  server?.kill();
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
});

describe.skipIf(!depsPresent)('Inflow.mcpb server', () => {
  it('offers its local tools before any extension connects', async () => {
    const list = await rpc('tools/list');
    const names = list.result.tools.map((t: any) => t.name);
    expect(names).toContain('inflow_status');
    expect(names).toContain('get_pairing_code');
    // Nothing is forwarded yet — there is no extension to forward to.
    expect(names).toHaveLength(2);
  });

  it('issues a pairing code and persists it where the next run will find it', async () => {
    const res = await rpc('tools/call', { name: 'get_pairing_code', arguments: {} });
    const code = text(res).match(/INF-[A-Z2-7]{6}/)?.[0];
    expect(code).toBeTruthy();
    // The clickable link is the point — a code to transcribe is the fallback.
    expect(text(res)).toContain(`https://inflow.im/app?pair=${code}`);

    const onDisk = JSON.parse(readFileSync(join(stateDir, 'agent-bridge.json'), 'utf8'));
    expect(onDisk.token).toBe(code);
  });

  it('explains what is missing instead of failing silently', async () => {
    const res = await rpc('tools/call', { name: 'inflow_status', arguments: {} });
    expect(text(res)).toContain('Waiting for the inflow extension');
    expect(text(res)).toContain('Configure agent access');
  });

  it('answers a forwarded call with an actionable error when nothing is connected', async () => {
    const res = await rpc('tools/call', { name: 'list_conversations', arguments: {} });
    expect(res.result.isError).toBe(true);
    // A hang here would look like Claude freezing; it must say what to do.
    expect(text(res)).toContain('not connected');
    expect(text(res)).toContain('inflow_status');
  });

  it('rejects a socket that is not a chrome extension', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, {
      headers: { origin: 'https://evil.example' },
    });
    const outcome = await new Promise<string>((resolve) => {
      ws.on('close', () => resolve('closed'));
      ws.on('message', () => resolve('got-hello')); // would mean the gate leaked
      setTimeout(() => resolve('hung'), 3000);
    });
    expect(outcome).toBe('closed');
  });

  describe('with an extension connected', () => {
    let ws: any;
    let code: string;

    beforeAll(async () => {
      const res = await rpc('tools/call', { name: 'get_pairing_code', arguments: {} });
      code = text(res).match(/INF-[A-Z2-7]{6}/)![0];

      ws = new WebSocket(`ws://127.0.0.1:${PORT}`, {
        headers: { origin: 'chrome-extension://fakeextensionid' },
      });
      await new Promise<void>((resolve, reject) => {
        ws.on('message', (raw: any) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'HELLO') {
            // The server proves it knows the code before we reveal ours.
            expect(msg.token).toBe(code);
            ws.send(JSON.stringify({ type: 'AUTH', v: 1, token: code }));
          } else if (msg.type === 'READY') {
            resolve();
          } else if (msg.type === 'LIST_TOOLS') {
            ws.send(JSON.stringify({
              id: msg.id, ok: true,
              result: {
                tools: [{
                  name: 'list_conversations', description: 'from the extension',
                  inputSchema: { type: 'object', properties: {} },
                }],
                readsEnabled: true, writesEnabled: false,
              },
            }));
          } else if (msg.type === 'CALL_TOOL') {
            ws.send(JSON.stringify({
              id: msg.id, ok: true,
              result: { content: [{ type: 'text', text: `called ${msg.tool}` }] },
            }));
          } else if (msg.type === 'PING') {
            ws.send(JSON.stringify({ type: 'PONG' }));
          }
        });
        ws.on('error', reject);
        setTimeout(() => reject(new Error('handshake timed out')), 8000);
      });
      await sleep(150);
    }, 20_000);

    afterAll(() => ws?.close());

    it('tells the MCP client the tool list changed', () => {
      // Without this, Claude keeps showing only the two local tools until it
      // happens to re-list.
      expect(notifications).toContain('notifications/tools/list_changed');
    });

    it('advertises the extension tools alongside its own', async () => {
      const list = await rpc('tools/list');
      const names = list.result.tools.map((t: any) => t.name);
      expect(names).toContain('list_conversations');
      expect(names).toContain('inflow_status');
    });

    it('forwards a call and passes the result through untouched', async () => {
      const res = await rpc('tools/call', { name: 'list_conversations', arguments: { tab: 'focused' } });
      // The extension already answers in MCP shape; the bridge must not rewrap.
      expect(res.result).toEqual({ content: [{ type: 'text', text: 'called list_conversations' }] });
    });

    it('reports itself connected', async () => {
      const res = await rpc('tools/call', { name: 'inflow_status', arguments: {} });
      expect(text(res)).toContain('Connected');
    });
  });
});
