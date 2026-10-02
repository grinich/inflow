import { OpenAIUiResourceMetadataSchema } from '@openai/mcp-extensions/server';
import type { MiddlewareHandler } from 'hono';

export const inboxUri = 'ui://views/inbox.html';
export const openAIResourceMeta = {
  'openai/ui': OpenAIUiResourceMetadataSchema.parse({
    availableDisplayModes: ['fullscreen'],
    preferredDisplayMode: 'fullscreen',
  }),
};

/** Only modifies the Inflow UI's resource metadata, preserving MCP envelopes. */
export function addDisplayMetadata(value: any): any {
  if (Array.isArray(value)) return value.map(addDisplayMetadata);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value.contents)) {
    return {
      ...value,
      contents: value.contents.map((item: any) =>
        item.uri === inboxUri ? { ...item, _meta: { ...item._meta, ...openAIResourceMeta } } : item,
      ),
    };
  }
  if (value.result) return { ...value, result: addDisplayMetadata(value.result) };
  return value;
}

/**
 * mcp-use 2.7.2 generates View resources outside resources/read middleware and
 * has no resource metadata field on view:. Keep the framework's rendering and
 * authentication, adding only OpenAI's validated metadata at the HTTP boundary.
 * Remove this adapter when mcp-use exposes metadata for generated resources.
 */
export const openAIViewMetadata: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const request = await c.req.raw
    .clone()
    .json()
    .catch(() => null);
  if (request?.method !== 'resources/read' || request.params?.uri !== inboxUri) return next();
  await next();
  if (!c.res.ok) return;
  const type = c.res.headers.get('content-type') || '';
  if (!type.includes('application/json') && !type.includes('text/event-stream')) return;
  const rewrite = (json: string) => {
    try {
      return JSON.stringify(addDisplayMetadata(JSON.parse(json)));
    } catch {
      return json;
    }
  };
  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  if (type.includes('application/json')) {
    c.res = new Response(rewrite(await c.res.text()), { status: c.res.status, headers });
    return;
  }
  // Modern hosts can keep an SSE response open. Forward each event as it
  // arrives; buffering the entire body would prevent the UI from loading.
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      let match: RegExpMatchArray | null;
      while ((match = pending.match(/\r?\n\r?\n/))) {
        const end = match.index! + match[0].length;
        const event = pending.slice(0, end);
        pending = pending.slice(end);
        controller.enqueue(
          encoder.encode(
            event.replace(
              /^data: ?([^\r\n]*)/gm,
              (_line, data: string) => `data: ${rewrite(data)}`,
            ),
          ),
        );
      }
    },
    flush(controller) {
      pending += decoder.decode();
      if (pending)
        controller.enqueue(
          encoder.encode(
            pending.replace(
              /^data: ?([^\r\n]*)/gm,
              (_line, data: string) => `data: ${rewrite(data)}`,
            ),
          ),
        );
    },
  });
  c.res = new Response(c.res.body?.pipeThrough(transform), { status: c.res.status, headers });
};
