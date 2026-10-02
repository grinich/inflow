import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MCPServer } from 'mcp-use';
import { createAuth } from '../src/auth.js';
import { Relay } from '../src/relay.js';
const base = 'http://localhost:3000';
const signing = 's'.repeat(48);
const login = 'l'.repeat(48);
const bridgeKey = 'b'.repeat(48);
function setup() {
  const auth = createAuth(base, signing, login);
  const s = new MCPServer({ name: 'test', version: '1', oauth: auth.provider });
  auth.routes(s);
  return { auth, s };
}
const request = (
  s: MCPServer<{ id: string }>,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  s.fetch(
    new Request(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
const form = (s: MCPServer<{ id: string }>, path: string, body: Record<string, string>) =>
  s.fetch(
    new Request(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    }),
  );
test('OAuth protects MCP, validates PKCE/resource, and consumes authorization codes once', async () => {
  const { s, auth } = setup();
  assert.equal(
    (
      await request(
        s,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        },
        { accept: 'application/json, text/event-stream' },
      )
    ).status,
    401,
  );
  assert.equal(
    (await request(s, '/oauth/register', { redirect_uris: ['https://good.test/callback#bad'] }))
      .status,
    400,
  );
  const client = await (
    await request(s, '/oauth/register', { redirect_uris: ['http://localhost:8181/callback'] })
  ).json();
  const verifier = 'x'.repeat(64);
  const p = {
    client_id: client.client_id,
    redirect_uri: 'http://localhost:8181/callback',
    response_type: 'code',
    state: 'test-state',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    resource: `${base}/mcp`,
    scope: 'inflow',
  };
  assert.equal(
    (
      await request(
        s,
        '/oauth/authorize?' + new URLSearchParams({ ...p, redirect_uri: 'https://attacker.test' }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        s,
        '/oauth/authorize?' + new URLSearchParams({ ...p, resource: 'https://attacker.test/mcp' }),
      )
    ).status,
    400,
  );
  const page = await request(s, '/oauth/authorize?' + new URLSearchParams(p));
  assert.equal(page.status, 200, await page.clone().text());
  const transaction = (await page.text()).match(/name="transaction" value="([^"]+)"/)![1];
  assert.equal((await form(s, '/oauth/authorize', { transaction, key: 'wrong' })).status, 403);
  const grant = await form(s, '/oauth/authorize', { transaction, key: login });
  assert.equal(grant.status, 302);
  const location = new URL(grant.headers.get('location')!);
  assert.equal(location.searchParams.get('state'), 'test-state');
  const params = {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    redirect_uri: p.redirect_uri,
    code: location.searchParams.get('code')!,
    code_verifier: verifier,
  };
  assert.equal(
    (await form(s, '/oauth/token', { ...params, code_verifier: 'y'.repeat(64) })).status,
    400,
  );
  const token = await (await form(s, '/oauth/token', params)).json();
  assert.ok(token.access_token);
  assert.equal((await form(s, '/oauth/token', params)).status, 400);
  const claims = await auth.verify(token.access_token, 'access');
  assert.equal(claims.sub, 'owner');
  await assert.rejects(() => auth.verify(token.refresh_token, 'access'));
  const refreshed = await form(s, '/oauth/token', {
    grant_type: 'refresh_token',
    client_id: client.client_id,
    refresh_token: token.refresh_token,
  });
  assert.equal(refreshed.status, 200);
  const rotated = await refreshed.json();
  assert.notEqual(rotated.refresh_token, token.refresh_token);
  const originalClaims = await auth.verify(token.refresh_token, 'refresh');
  const rotatedClaims = await auth.verify(rotated.refresh_token, 'refresh');
  assert.equal(
    rotatedClaims.exp,
    originalClaims.exp,
    'rotation must not extend the family lifetime',
  );
  const refresh = (server: MCPServer<{ id: string }>, value: string) =>
    form(server, '/oauth/token', {
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: value,
    });
  const { s: restarted } = setup();
  assert.equal(
    (await refresh(restarted, rotated.refresh_token)).status,
    400,
    'restart requires a new sign-in',
  );
  const next = await refresh(s, rotated.refresh_token);
  assert.equal(next.status, 200, 'the replacement can be used once');
  const nextToken = await next.json();
  assert.equal(
    (await refresh(s, token.refresh_token)).status,
    400,
    'a consumed token cannot be replayed',
  );
  assert.equal(
    (await refresh(s, nextToken.refresh_token)).status,
    400,
    'replay revokes the current token in that family',
  );
});
test('OAuth bounds bodies without trusting a Content-Length header', async () => {
  const { s } = setup();
  for (const path of ['/oauth/register', '/oauth/authorize', '/oauth/token']) {
    const oversized = new Request(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(16384) }),
    });
    assert.equal(oversized.headers.has('content-length'), false);
    const response = await s.fetch(oversized);
    assert.equal(response.status, 413, path);
    assert.deepEqual(await response.json(), { error: 'invalid_request' });
  }
  assert.equal(
    (await request(s, '/oauth/register', { redirect_uris: ['https://good.test/callback'] })).status,
    201,
    'small bodies still reach the handler',
  );
});
test('missing secrets fail closed', async () => {
  const auth = createAuth(base, '', '');
  const s = new MCPServer({ name: 'test', version: '1', oauth: auth.provider });
  auth.routes(s);
  assert.equal(
    (await request(s, '/oauth/register', { redirect_uris: ['https://good.test/cb'] })).status,
    503,
  );
  assert.equal(
    (
      await request(
        s,
        '/mcp',
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        },
        { accept: 'application/json, text/event-stream' },
      )
    ).status,
    401,
  );
});
test('relay needs its separate credential and delivers tool calls at most once', async () => {
  const { s } = setup();
  const relay = new Relay();
  relay.mount(s, bridgeKey);
  assert.equal((await request(s, '/bridge/poll', { connected: true })).status, 401);
  await assert.rejects(() => relay.call('send_message', {}), /offline/);
  const headers = { authorization: `Bearer ${bridgeKey}` };
  const poll = request(s, '/bridge/poll', { connected: true }, headers);
  await new Promise((r) => setTimeout(r, 20));
  const call = relay.call('send_message', { conversationId: 'abc', body: 'test' });
  const delivery = await (await poll).json();
  assert.equal(delivery.commands.length, 1);
  const command = delivery.commands[0];
  assert.equal(command.tool, 'send_message');
  const answer = { content: [{ type: 'text', text: '{"sent":true}' }] };
  assert.equal(
    (await request(s, '/bridge/result', { id: command.id, result: answer }, headers)).status,
    200,
  );
  assert.deepEqual(await call, answer);
  assert.equal(
    (await request(s, '/bridge/result', { id: command.id, result: answer }, headers)).status,
    404,
  );
  const offline = await request(s, '/bridge/poll', { connected: false }, headers);
  assert.deepEqual((await offline.json()).commands, []);
  assert.equal(relay.connected, false);
});
