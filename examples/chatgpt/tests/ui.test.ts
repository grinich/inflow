import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
  openAIViewMetadata,
  addDisplayMetadata,
  inboxUri,
  openAIResourceMeta,
} from '../src/openai-ui.js';
import { OpenInboxInput } from '../src/contracts.js';

test('OpenAI metadata survives JSON and SSE resource responses, without touching other results', async () => {
  const original = {
    jsonrpc: '2.0',
    id: 7,
    result: {
      contents: [
        {
          uri: inboxUri,
          text: '<html>fixture</html>',
          mimeType: 'text/html',
          _meta: { ui: { csp: { connectDomains: ['https://example.com'] } } },
        },
      ],
    },
  };
  for (const type of ['application/json', 'text/event-stream']) {
    const app = new Hono();
    app.use('/mcp', openAIViewMetadata);
    app.post('/mcp', (c) =>
      c.body(
        type === 'application/json'
          ? JSON.stringify(original)
          : `event: message\nid: 42\ndata: ${JSON.stringify(original)}\n\n`,
        200,
        { 'content-type': type },
      ),
    );
    const r = await app.request('/mcp', {
      method: 'POST',
      body: JSON.stringify({ method: 'resources/read', params: { uri: inboxUri } }),
    });
    const body = await r.text();
    const value = JSON.parse(
      type === 'application/json'
        ? body
        : body
            .split('\n')
            .find((s) => s.startsWith('data: '))!
            .slice(6),
    );
    assert.deepEqual(value.result.contents[0]._meta['openai/ui'], openAIResourceMeta['openai/ui']);
    assert.deepEqual(value.result.contents[0]._meta.ui, original.result.contents[0]._meta.ui);
    assert.equal(value.result.contents[0].text, '<html>fixture</html>');
    if (type === 'text/event-stream') assert.ok(body.startsWith('event: message\nid: 42\n'));
  }
  const other = { result: { contents: [{ uri: 'test://other', text: 'untouched' }] } };
  assert.deepEqual(addDisplayMetadata(other), other);
});
test('one opener supports view changes and validates thread/session input', () => {
  assert.equal(OpenInboxInput.parse({}).state, 'inbox');
  assert.equal(OpenInboxInput.safeParse({ state: 'thread' }).success, false);
  assert.equal(OpenInboxInput.safeParse({ widgetSessionId: 'global-shared-id' }).success, false);
  assert.equal(
    OpenInboxInput.parse({
      state: 'visualize',
      widgetSessionId: '7117a2c2-1a37-44e3-818c-f5f46a0788f2',
    }).state,
    'visualize',
  );
});

test('SSE UI metadata is delivered without waiting for the server to close its stream', async () => {
  const app = new Hono();
  app.use('/mcp', openAIViewMetadata);
  app.post(
    '/mcp',
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: message\ndata: ' +
                  JSON.stringify({ result: { contents: [{ uri: inboxUri, text: 'UI' }] } }) +
                  '\n\n',
              ),
            );
            // Deliberately keep the stream open, as a modern host may do.
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  const response = await app.request('/mcp', {
    method: 'POST',
    body: JSON.stringify({ method: 'resources/read', params: { uri: inboxUri } }),
  });
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /preferredDisplayMode/);
  await reader.cancel();
});
