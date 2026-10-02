import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
const base = process.env.INFLOW_PUBLIC_URL || 'http://localhost:3000';
const secrets = process.env;
if (!secrets.INFLOW_SIGNING_KEY || !secrets.INFLOW_BRIDGE_KEY)
  throw new Error('Load verification credentials with --env-file=.env');
const token = await new SignJWT({ kind: 'access', sub: 'owner', client: 'verification' })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuer(base)
  .setAudience(`${base}/mcp`)
  .setIssuedAt()
  .setExpirationTime('10m')
  .sign(new TextEncoder().encode(secrets.INFLOW_SIGNING_KEY));
// Exercise the modern wire protocol directly. @mcp-use/client 2.4.0's
// automatic subscription connection stalls subsequent reads on this cloud
// route in this Node runtime; the same resource request without that stream
// succeeds. Keep this check independent of the optional subscription channel.
const r = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': '2026-07-28',
    'mcp-method': 'resources/read',
    'mcp-name': 'ui://views/inbox.html',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/read',
    params: {
      uri: 'ui://views/inbox.html',
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'inflow-modern-verification', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  }),
  signal: AbortSignal.timeout(15000),
});
assert.equal(r.status, 200);
const envelope = await r.json();
assert.deepEqual(envelope.result.contents[0]._meta?.['openai/ui'], {
  availableDisplayModes: ['fullscreen'],
  preferredDisplayMode: 'fullscreen',
});
console.log('Modern MCP wire protocol: fullscreen resource metadata verified');
