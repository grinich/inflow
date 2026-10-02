import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCPServer } from 'mcp-use';
import { createAuth } from '../src/auth.js';
import { Relay } from '../src/relay.js';

test('bridge rejects oversized bodies even without Content-Length', async () => {
  const base = 'http://localhost:3000';
  const auth = createAuth(base, 's'.repeat(48), 'l'.repeat(48));
  const server = new MCPServer({ name: 'test', version: '1', oauth: auth.provider });
  new Relay().mount(server, 'b'.repeat(48));
  const request = new Request(`${base}/bridge/result`, {
    method: 'POST',
    headers: { authorization: `Bearer ${'b'.repeat(48)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ data: 'x'.repeat(4_000_001) }),
  });
  assert.equal(request.headers.get('content-length'), null);
  const response = await server.fetch(request);
  assert.equal(response.status, 413);
});
