import { useEffect, useState } from 'react';
import {
  AGENT_TOOLS_ENABLED_KEY,
  AGENT_WRITES_ENABLED_KEY,
  getAgentToolsEnabled,
  getAgentWritesEnabled,
} from '@/lib/agent-settings';
import { registerAgentTools, whenModelContextReady } from '@/lib/agent-tools/model-context';
import { onShellAgentRequest, publishAgentToolsChanged } from '@/lib/shell-messages';

/**
 * Mounts the agent tool transports. Renders nothing; called once from App.
 *
 * No re-registration on account/database switch is needed — deliberately no
 * subscribeDbChanged here: catalog handlers read the `db` live binding at
 * call time, so a switch is picked up by the very next tool call.
 */
export function useAgentTools(): void {
  const [enabled, setEnabled] = useState({ reads: false, writes: false });

  // Shell RPC listener is ALWAYS installed (cheap): with agent access off, the
  // executor answers a structured "disabled" error instead of a timeout.
  useEffect(() => onShellAgentRequest(), []);

  // Track the toggles, including changes made in another window or by the
  // modal — chrome.storage.onChanged fires for both.
  useEffect(() => {
    let disposed = false;
    const load = () => {
      void Promise.all([getAgentToolsEnabled(), getAgentWritesEnabled()]).then(
        ([reads, writes]) => {
          if (disposed) return;
          setEnabled((prev) =>
            prev.reads === reads && prev.writes === writes ? prev : { reads, writes }
          );
        }
      );
    };
    load();
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== 'local') return;
      if (AGENT_TOOLS_ENABLED_KEY in changes || AGENT_WRITES_ENABLED_KEY in changes) load();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  // WebMCP registration tracks both toggles: reads gate registration entirely;
  // a writes change re-registers so the advertised tool list stays accurate.
  // The executor re-checks the gates per call either way — registration is
  // advertisement, not authorization.
  useEffect(() => {
    // Let an embedding shell refresh whatever registrations it proxies.
    publishAgentToolsChanged();

    if (!enabled.reads) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    // Wait for a WebMCP surface rather than checking once: agent extensions
    // inject theirs when the user grants site access, usually after we loaded.
    const stopWaiting = whenModelContextReady(() => {
      void registerAgentTools().then((c) => {
        if (cancelled) c();
        else cleanup = c;
      });
    });
    return () => {
      cancelled = true;
      stopWaiting();
      cleanup?.();
    };
  }, [enabled.reads, enabled.writes]);
}
