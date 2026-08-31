import { getAgentToolsEnabled, getAgentWritesEnabled } from '@/lib/agent-settings';
import { useUIStore } from '@/store/ui-store';
import { agentToolCatalog } from './catalog';
import { AGENT_SEND_CAP_PER_HOUR, checkAndRecordSend } from './send-cap';
import type { AgentToolDescriptor, AgentToolResult } from './types';
import { validateInput } from './validate';

/**
 * The single entry point every transport calls — WebMCP registration in the
 * app page and the shell postMessage RPC both delegate here, so the settings
 * gates and the send cap can't be bypassed by choice of transport.
 *
 * callTool never throws: every failure becomes an isError result with an
 * actionable message, because agents can act on "writes are disabled, the
 * user can enable them via X" but not on a hung promise or a stack trace.
 */

const ENABLE_HINT =
  "The inflow user can enable it via the command palette (Cmd+K) → 'Configure agent access'.";

export interface AgentToolList {
  tools: AgentToolDescriptor[];
  readsEnabled: boolean;
  writesEnabled: boolean;
}

/** Advertise only what's currently callable, plus the flags so agents know why. */
export async function listTools(): Promise<AgentToolList> {
  const [readsEnabled, writesEnabled] = await Promise.all([
    getAgentToolsEnabled(),
    getAgentWritesEnabled(),
  ]);
  const tools = !readsEnabled
    ? []
    : agentToolCatalog
        .filter((t) => !t.write || writesEnabled)
        .map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  return { tools, readsEnabled, writesEnabled };
}

export async function callTool(name: string, input: unknown): Promise<AgentToolResult> {
  if (!(await getAgentToolsEnabled())) {
    return errorResult(`Agent access is disabled. ${ENABLE_HINT}`);
  }

  const tool = agentToolCatalog.find((t) => t.name === name);
  if (!tool) {
    return errorResult(
      `unknown tool "${name}" — call listTools for the available tools`
    );
  }

  if (tool.write && !(await getAgentWritesEnabled())) {
    return errorResult(`Agent write actions are disabled. ${ENABLE_HINT}`);
  }

  const validated = validateInput(tool.inputSchema, input);
  if (!validated.ok) {
    return errorResult(`invalid input for ${name}: ${validated.error}`);
  }

  if (tool.name === 'send_message') {
    const cap = await checkAndRecordSend();
    if (!cap.ok) {
      const minutes = Math.max(1, Math.ceil(cap.retryAfterMs / 60000));
      return errorResult(
        `agent send limit reached (${AGENT_SEND_CAP_PER_HOUR}/hour). Retry in ${minutes}m.`
      );
    }
  }

  let data: unknown;
  try {
    data = await tool.handler(validated.value);
  } catch (e) {
    return errorResult(e instanceof Error ? e.message : String(e));
  }

  if (tool.write && tool.successToast) {
    try {
      useUIStore.getState().showToast({ message: tool.successToast(data) });
    } catch {
      // A toast must never fail a completed action (e.g. store not mounted in tests).
    }
  }

  return { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] };
}

function errorResult(message: string): AgentToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
