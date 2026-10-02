import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
const client = new Client({ name: 'inflow-verification', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
const tools = await client.listTools();
const inbox = tools.tools.find((t) => t.name === 'open_inbox');
if (!inbox?._meta?.['openai/ui']?.entrypoints?.some((e) => e.type === 'global'))
  throw new Error('Missing sidebar entrypoint');
assert.equal(
  tools.tools.filter((t) => t._meta?.ui?.resourceUri).length,
  1,
  'Exactly one rendering tool',
);
const response = await client.callTool({ name: 'open_inbox', arguments: {} });
if (response.isError || !response.structuredContent)
  throw new Error('Inbox response failed: ' + JSON.stringify(response));
const uri = inbox._meta.ui.resourceUri;
const resource = await client.readResource({ uri });
if (!resource.contents[0].text) throw new Error('Missing UI resource or metadata');
assert.deepEqual(resource.contents[0]._meta?.['openai/ui'], {
  availableDisplayModes: ['fullscreen'],
  preferredDisplayMode: 'fullscreen',
});
const resources = await client.listResources();
assert.equal(resources.resources.length, 1);
assert.deepEqual(
  resources.resources[0]._meta?.['openai/ui'],
  resource.contents[0]._meta['openai/ui'],
);
const widgetSessionId = response.structuredContent.widgetSessionId;
assert.equal(response._meta?.['openai/widgetSessionId'], widgetSessionId);
for (const state of ['connection', 'visualize', 'inbox']) {
  const updated = await client.callTool({
    name: 'open_inbox',
    arguments: { state, widgetSessionId },
  });
  assert.equal(updated.isError, undefined);
  assert.equal(updated.structuredContent.state, state);
  assert.equal(updated.structuredContent.widgetSessionId, widgetSessionId);
  assert.equal(updated._meta['openai/widgetSessionId'], widgetSessionId);
  assert.equal(updated._meta.ui.resourceUri, uri);
}
const fresh = await client.callTool({ name: 'open_inbox', arguments: {} });
assert.notEqual(
  fresh.structuredContent.widgetSessionId,
  widgetSessionId,
  'Separate chats must not share a global session ID',
);
const missing = await client
  .callTool({ name: 'open_inbox', arguments: { state: 'thread', widgetSessionId } })
  .catch(() => ({ isError: true }));
assert.equal(missing.isError, true, 'Thread view requires a conversation');
const invalid = await client
  .callTool({ name: 'send_message', arguments: { conversationId: 'test', body: '' } })
  .catch((e) => ({ isError: true }));
if (!invalid.isError) throw new Error('Invalid send input accepted');
console.log(
  JSON.stringify(
    {
      endpoint: `${base}/mcp`,
      tools: tools.tools.length,
      sidebar: true,
      fullscreenResourceMetadata: true,
      singleWidget: true,
      sessionReuse: true,
      uiResource: uri,
      uiBytes: resource.contents[0].text.length,
      connected: response.structuredContent.connected,
      conversations: response.structuredContent.conversations.length,
      inputValidation: true,
    },
    null,
    2,
  ),
);
await client.close();
