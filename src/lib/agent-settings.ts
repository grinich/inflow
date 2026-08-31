import { readLocal } from './storage';

/**
 * Agent-access settings. Two independent gates, both OFF by default —
 * deliberately the opposite defaulting from getAISuggestionsEnabled: nothing
 * about the inbox is exposed to agents until the user opts in, and write
 * actions require a second explicit opt-in on top.
 *
 * Key names are exported because useAgentTools filters chrome.storage.onChanged
 * events by them (and tests seed them directly).
 */

export const AGENT_TOOLS_ENABLED_KEY = 'agentToolsEnabled';
export const AGENT_WRITES_ENABLED_KEY = 'agentWritesEnabled';

/** Whether agents may call read tools (and see the tool list at all). */
export async function getAgentToolsEnabled(): Promise<boolean> {
  return (await readLocal<boolean>(AGENT_TOOLS_ENABLED_KEY)) === true;
}

export async function setAgentToolsEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [AGENT_TOOLS_ENABLED_KEY]: enabled });
}

/** Whether agents may call write tools (send, archive, mark read/unread). */
export async function getAgentWritesEnabled(): Promise<boolean> {
  return (await readLocal<boolean>(AGENT_WRITES_ENABLED_KEY)) === true;
}

export async function setAgentWritesEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [AGENT_WRITES_ENABLED_KEY]: enabled });
}
