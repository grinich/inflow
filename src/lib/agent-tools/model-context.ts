import { callTool, listTools } from './executor';

/**
 * The ONLY extension-side contact with WebMCP (document.modelContext), kept
 * behind this adapter because the API is still moving — Chrome ships it in an
 * origin trial (149–156), testable behind chrome://flags/#enable-webmcp-testing,
 * and the registration surface migrated from navigator to document mid-trial.
 * If the shipped API drifts again, this file is the whole blast radius.
 *
 * Failures are isolated: registration problems are logged and swallowed so the
 * shell postMessage transport keeps working regardless.
 */

interface ModelContextLike {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: unknown;
      execute: (input: unknown) => Promise<unknown>;
    },
    opts?: { signal?: AbortSignal }
  ) => unknown;
}

function getModelContext(): ModelContextLike | null {
  const mc =
    (document as { modelContext?: unknown }).modelContext ??
    (navigator as { modelContext?: unknown }).modelContext; // pre-150 alias
  if (mc && typeof (mc as ModelContextLike).registerTool === 'function') {
    return mc as ModelContextLike;
  }
  return null;
}

export function isModelContextAvailable(): boolean {
  return typeof document !== 'undefined' && getModelContext() !== null;
}

/**
 * Call `onReady` once a WebMCP surface exists — now, or whenever one shows up.
 * Returns a stop function.
 *
 * A one-shot check at mount is not enough: agent extensions inject their own
 * implementation into the page rather than relying on Chrome's origin trial,
 * and they register that content script at RUNTIME — typically when the user
 * grants the agent access to the site, which is usually after our page has
 * loaded and already looked. (Verified against ChatGPT for Chrome's
 * content-scripts/webmcp.js, which defines modelContext on document and
 * navigator with configurable:false, so it cannot be watched with a setter —
 * hence polling.) The poll is a `typeof` check a few times a minute and stops
 * the moment it finds one.
 */
export function whenModelContextReady(onReady: () => void): () => void {
  if (isModelContextAvailable()) {
    onReady();
    return () => {};
  }
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', check);
  };
  function check() {
    if (stopped) return;
    if (isModelContextAvailable()) {
      stop();
      onReady();
    }
  }
  // Activating an agent on the page puts focus through the sidebar and back,
  // so these usually beat the timer to it.
  const timer = setInterval(check, 2000);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  return stop;
}

/**
 * Register every currently-enabled tool. Returns a cleanup that unregisters
 * them all — defensively, since the trial API has returned different handle
 * shapes (an object with unregister(), or nothing, relying on the signal).
 */
export async function registerAgentTools(): Promise<() => void> {
  const mc = getModelContext();
  if (!mc) return () => {};

  const controller = new AbortController();
  const handles: unknown[] = [];
  const { tools } = await listTools();

  for (const tool of tools) {
    try {
      const handle = await mc.registerTool(
        {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          // The executor re-checks the settings gates on every call, so a
          // registration that outlives a toggle-off still refuses to act.
          execute: (input: unknown) => callTool(tool.name, input),
        },
        { signal: controller.signal }
      );
      handles.push(handle);
    } catch (e) {
      console.warn(`[agent-tools] modelContext registration failed for ${tool.name}`, e);
    }
  }

  return () => {
    try {
      controller.abort();
    } catch {}
    for (const handle of handles) {
      try {
        (handle as { unregister?: () => void } | undefined)?.unregister?.();
      } catch {}
    }
  };
}
