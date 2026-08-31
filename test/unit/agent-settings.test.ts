import {
  AGENT_TOOLS_ENABLED_KEY,
  AGENT_WRITES_ENABLED_KEY,
  getAgentToolsEnabled,
  getAgentWritesEnabled,
  setAgentToolsEnabled,
  setAgentWritesEnabled,
} from '@/lib/agent-settings';
import { setLocalStore } from '../mocks/chrome';

describe('agent-settings', () => {
  it('defaults BOTH gates to false — opposite of the AI-suggestions default', async () => {
    expect(await getAgentToolsEnabled()).toBe(false);
    expect(await getAgentWritesEnabled()).toBe(false);
  });

  it('only a stored literal true enables (corrupted values stay off)', async () => {
    setLocalStore(AGENT_TOOLS_ENABLED_KEY, 'true');
    setLocalStore(AGENT_WRITES_ENABLED_KEY, 1);
    expect(await getAgentToolsEnabled()).toBe(false);
    expect(await getAgentWritesEnabled()).toBe(false);
  });

  it('round-trips through the setters', async () => {
    await setAgentToolsEnabled(true);
    await setAgentWritesEnabled(true);
    expect(await getAgentToolsEnabled()).toBe(true);
    expect(await getAgentWritesEnabled()).toBe(true);
    await setAgentWritesEnabled(false);
    expect(await getAgentWritesEnabled()).toBe(false);
  });
});
