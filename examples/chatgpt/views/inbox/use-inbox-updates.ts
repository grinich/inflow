import { useEffect, useRef } from 'react';
import { useToolContext } from 'mcp-use/react';
import { InboxOutput, OpenInboxInput, type InboxData } from '../../src/contracts.js';
import type { z } from 'zod';
/** mcp-use owns initialization and requests. In 2.7.2 useToolContext latches
 * the first result. Observe later host notifications for ChatGPT session reuse,
 * without starting a competing transport or handling host requests. */
export function useInboxUpdates(
  onResult: (data: InboxData) => void,
  onInput: (input: z.infer<typeof OpenInboxInput>) => void,
) {
  const initial = useToolContext<'open_inbox'>();
  const handlers = useRef({ onResult, onInput });
  handlers.current = { onResult, onInput };
  const session = useRef<string | null>(null);
  const initialApplied = useRef(false);
  useEffect(() => {
    if (initial.status === 'ready' && !initialApplied.current) {
      initialApplied.current = true;
      session.current = initial.toolOutput.widgetSessionId;
      handlers.current.onResult(initial.toolOutput);
    }
  }, [initial]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.jsonrpc !== '2.0' || event.data.id != null)
        return;
      const { method, params } = event.data;
      if (method === 'ui/notifications/tool-input') {
        const args = params?.arguments;
        if (!args || !('state' in args) || args.widgetSessionId !== session.current) return;
        const parsed = OpenInboxInput.safeParse(args);
        if (parsed.success) handlers.current.onInput(parsed.data);
      }
      if (method === 'ui/notifications/tool-result' && !params?.isError) {
        const parsed = InboxOutput.safeParse(params?.structuredContent);
        if (!parsed.success || (session.current && parsed.data.widgetSessionId !== session.current))
          return;
        if (params?._meta?.['openai/widgetSessionId'] !== parsed.data.widgetSessionId) return;
        session.current = parsed.data.widgetSessionId;
        handlers.current.onResult(parsed.data);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  return initial;
}
