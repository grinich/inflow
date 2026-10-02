import { randomUUID } from 'node:crypto';
import type { MCPServer } from 'mcp-use';
import { bodyLimit } from 'hono/body-limit';
import { equalSecret } from './auth.js';
export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};
type Command = { id: string; tool: string; input: Record<string, unknown> };
type Pending = {
  command: Command;
  resolve: (r: ToolResult) => void;
  timer: ReturnType<typeof setTimeout>;
  delivered: boolean;
};
/** Transient RPC state only. One instance/one owner; nothing is stored in cloud. */
export class Relay {
  private pending = new Map<string, Pending>();
  private seen = 0;
  private ready = false;
  private pairingUrl: string | null = null;
  private waiter: (() => void) | undefined;
  private polling = false;
  get connected() {
    return this.ready && Date.now() - this.seen < 45000;
  }
  status() {
    return {
      connected: this.connected,
      pairingUrl: this.pairingUrl,
      lastSeenAt: this.seen ? new Date(this.seen).toISOString() : null,
    };
  }
  async call(tool: string, input: Record<string, unknown>): Promise<ToolResult> {
    if (!this.connected)
      throw new Error(
        'Inflow is offline. Start the local bridge and open Chrome with Inflow paired.',
      );
    if (this.pending.size >= 32) throw new Error('Too many pending requests. Try again shortly.');
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          isError: true,
          content: [
            {
              type: 'text',
              text: 'The browser did not answer in time. A write may have completed; check the thread before retrying. No automatic retry was sent.',
            },
          ],
        });
      }, 35000);
      this.pending.set(id, { command: { id, tool, input }, resolve, timer, delivered: false });
      this.waiter?.();
    });
  }
  mount(server: MCPServer<{ id: string }>, secret: string) {
    server.use('/bridge/*', async (c, next) => {
      if (
        secret.length < 32 ||
        !equalSecret(c.req.header('authorization') || '', `Bearer ${secret}`)
      )
        return c.json({ error: 'Unauthorized' }, 401);
      c.header('Cache-Control', 'no-store');
      await next();
    });
    server.use(
      '/bridge/*',
      bodyLimit({ maxSize: 4_000_000, onError: (c) => c.json({ error: 'Result too large' }, 413) }),
    );
    server.post('/bridge/poll', async (c) => {
      if (this.polling) return c.json({ error: 'Another bridge poll is active' }, 409);
      const body = await c.req.json().catch(() => ({}));
      this.seen = Date.now();
      this.ready = body.connected === true;
      this.pairingUrl = /^INF-[A-Z2-7]{6}$/.test(body.pairingCode || '')
        ? `https://inflow.im/app?pair=${body.pairingCode}`
        : null;
      this.polling = true;
      try {
        if (this.ready && ![...this.pending.values()].some((x) => !x.delivered)) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 18000);
            this.waiter = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
        this.waiter = undefined;
        const commands: Command[] = [];
        if (this.ready)
          for (const p of this.pending.values())
            if (!p.delivered) {
              p.delivered = true;
              commands.push(p.command);
              break;
            }
        return c.json({ commands });
      } finally {
        this.polling = false;
      }
    });
    server.post('/bridge/result', async (c) => {
      const body = await c.req.json();
      const p = this.pending.get(body.id);
      if (!p || !p.delivered) return c.json({ accepted: false }, 404);
      if (!body.result || !Array.isArray(body.result.content))
        return c.json({ error: 'Malformed result' }, 400);
      clearTimeout(p.timer);
      this.pending.delete(body.id);
      p.resolve(body.result);
      return c.json({ accepted: true });
    });
  }
}
export function unpack<T>(result: ToolResult): T {
  const value = result.content
    .filter((x) => x.type === 'text')
    .map((x) => x.text)
    .join('\n');
  if (result.isError) throw new Error(value);
  return (result.structuredContent || JSON.parse(value)) as T;
}
