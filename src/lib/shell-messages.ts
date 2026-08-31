/**
 * Messages exchanged with the inflow.im/app shell — the page that embeds this
 * app in a cross-origin iframe.
 *
 * Inbound: a notification shown by the shell was clicked, so navigate to its
 * conversation; and agent tool RPC (list/call), which the shell forwards on
 * behalf of AI agents driving inflow.im/app. The origin check is the security
 * boundary — only the shell's origin may drive navigation or reach the agent
 * executor (whose own settings gates are the real authorization); anything
 * else is ignored.
 *
 * Outbound: the current route, so the shell can mirror it into the address
 * bar. Inside the frame the hash lives on `chrome-extension://…/app.html`,
 * which the user never sees and which is rebuilt from scratch on reload — so
 * without this the route survives a reload of the extension page directly but
 * not a reload of inflow.im/app. Plus a tools-changed ping so the shell can
 * refresh any tool registrations it proxies.
 */

import { callTool, listTools } from '@/lib/agent-tools/executor';

const PROD_SHELL_ORIGIN = 'https://inflow.im';

// A dev build may be embedded by `vercel dev` on localhost. Match patterns
// ignore ports, but postMessage targetOrigin does not, so the common dev ports
// are listed explicitly. Never included in a production build.
const DEV_SHELL_ORIGINS = __INFLOW_LOCAL_SHELL__
  ? ['http://localhost:8765', 'http://127.0.0.1:8765', 'http://localhost:3000']
  : [];

export const SHELL_ORIGINS: readonly string[] = [PROD_SHELL_ORIGIN, ...DEV_SHELL_ORIGINS];

function isShellOrigin(origin: string): boolean {
  return SHELL_ORIGINS.includes(origin);
}

/** Subscribe to shell "open conversation" messages. Returns unsubscribe. */
export function onShellOpenConversation(
  handler: (conversationId: string) => void
): () => void {
  const listener = (event: MessageEvent) => {
    if (!isShellOrigin(event.origin)) return;
    const data = event.data;
    if (
      data &&
      data.type === 'OPEN_CONVERSATION' &&
      typeof data.conversationId === 'string' &&
      data.conversationId
    ) {
      handler(data.conversationId);
    }
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/**
 * Subscribe to agent tool RPC from the shell. Returns unsubscribe.
 *
 * Requests: { type: 'INFLOW_AGENT_LIST_TOOLS', requestId }
 *           { type: 'INFLOW_AGENT_CALL_TOOL', requestId, tool, input? }
 * The reply goes to the requesting window and origin only (not a broadcast),
 * as { type: 'INFLOW_AGENT_RESULT', requestId, result }. Always installed,
 * even with agent access disabled: the executor answers "disabled" with a
 * structured error — an agent can act on that, but not on a timeout.
 */
export function onShellAgentRequest(): () => void {
  const listener = (event: MessageEvent) => {
    if (!isShellOrigin(event.origin)) return;
    const data = event.data;
    if (!data || typeof data.requestId !== 'string') return;
    if (data.type !== 'INFLOW_AGENT_LIST_TOOLS' && data.type !== 'INFLOW_AGENT_CALL_TOOL') return;
    void (async () => {
      let result: unknown;
      try {
        result =
          data.type === 'INFLOW_AGENT_LIST_TOOLS'
            ? await listTools()
            : await callTool(typeof data.tool === 'string' ? data.tool : '', data.input);
      } catch (e) {
        // callTool never throws by contract, but a bug must still produce an
        // answer — a hung shell promise helps nobody.
        result = {
          content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
      (event.source as Window | null)?.postMessage(
        { type: 'INFLOW_AGENT_RESULT', requestId: data.requestId, result },
        event.origin
      );
    })();
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** Ping the shell that the enabled tool set changed (mirror of publishRouteToShell). */
export function publishAgentToolsChanged(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  for (const origin of SHELL_ORIGINS) {
    try {
      window.parent.postMessage({ type: 'INFLOW_AGENT_TOOLS_CHANGED' }, origin);
    } catch {
      // A targetOrigin mismatch throws in some engines; the others still go.
    }
  }
}

/**
 * Tell the shell which route we're on, so it can put it in its own URL.
 *
 * A no-op when not framed (the extension page opened directly already owns its
 * address bar). Posting to a targetOrigin that isn't the real parent is
 * silently dropped by the browser, so naming every candidate is safe.
 */
export function publishRouteToShell(hash: string): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  for (const origin of SHELL_ORIGINS) {
    try {
      window.parent.postMessage({ type: 'ROUTE_CHANGED', hash }, origin);
    } catch {
      // A targetOrigin mismatch throws in some engines; the others still go.
    }
  }
}
