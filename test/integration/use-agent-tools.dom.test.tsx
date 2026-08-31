// @vitest-environment jsdom
/**
 * useAgentTools transport lifecycle: WebMCP registration tracks the settings
 * toggles (and unregisters on unmount), and the always-on shell RPC listener
 * answers origin-checked postMessage requests — including a structured
 * "disabled" error when agent access is off, never a silent timeout.
 */
import '../dom-setup';

import { renderHook, waitFor } from '@testing-library/react';
import { useAgentTools } from '@/hooks/useAgentTools';
import {
  AGENT_TOOLS_ENABLED_KEY,
  AGENT_WRITES_ENABLED_KEY,
} from '@/lib/agent-settings';
import { fireStorageChanged, setLocalStore } from '../mocks/chrome';
import {
  getRegisteredTools,
  installModelContextMock,
  invokeTool,
  uninstallModelContextMock,
} from '../mocks/model-context';

const READ_TOOLS = [
  'get_send_quota', 'get_unread_count', 'list_connections', 'list_conversations',
  'list_invitations', 'list_sent_invitations', 'read_thread',
  'search_conversations', 'search_recipients',
];
const ALL_TOOLS = [
  ...READ_TOOLS, 'accept_invitation', 'archive_conversation', 'delete_conversation',
  'delete_message', 'edit_message', 'ignore_invitation', 'mark_read', 'mark_unread',
  'move_conversation', 'react_to_message', 'send_message', 'star_conversation',
  'start_conversation', 'withdraw_invitation',
].sort();

function enable(reads: boolean, writes = false) {
  setLocalStore(AGENT_TOOLS_ENABLED_KEY, reads);
  setLocalStore(AGENT_WRITES_ENABLED_KEY, writes);
  fireStorageChanged({
    [AGENT_TOOLS_ENABLED_KEY]: { newValue: reads },
    [AGENT_WRITES_ENABLED_KEY]: { newValue: writes },
  });
}

afterEach(() => uninstallModelContextMock());

describe('modelContext registration', () => {
  it('registers nothing while disabled, follows the toggles, unregisters on unmount', async () => {
    installModelContextMock();
    const { unmount } = renderHook(() => useAgentTools());

    // Disabled: give effects a beat, then confirm no registrations.
    await waitFor(() => expect(getRegisteredTools()).toEqual([]));

    enable(true);
    await waitFor(() => expect(getRegisteredTools()).toEqual(READ_TOOLS));

    enable(true, true);
    await waitFor(() => expect(getRegisteredTools()).toEqual(ALL_TOOLS));

    enable(false);
    await waitFor(() => expect(getRegisteredTools()).toEqual([]));

    enable(true);
    await waitFor(() => expect(getRegisteredTools()).toEqual(READ_TOOLS));

    unmount();
    await waitFor(() => expect(getRegisteredTools()).toEqual([]));
  });

  it('registered tools execute through the gated executor', async () => {
    installModelContextMock();
    renderHook(() => useAgentTools());
    enable(true);
    await waitFor(() => expect(getRegisteredTools()).toContain('list_conversations'));

    // Toggle off WITHOUT waiting for re-registration: the executor re-checks
    // the gate per call, so even a stale registration refuses to act.
    setLocalStore(AGENT_TOOLS_ENABLED_KEY, false);
    const result = (await invokeTool('list_conversations', {})) as {
      isError?: boolean;
      content: [{ text: string }];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Agent access is disabled');
  });

  it('is inert when modelContext does not exist (no crash, RPC still works)', async () => {
    expect(() => renderHook(() => useAgentTools())).not.toThrow();
  });
});

describe('shell RPC', () => {
  function dispatch(data: unknown, origin = 'https://inflow.im') {
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: window }));
  }

  let postSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // spyOn returns the SAME spy instance across tests — clear its call log.
    postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    postSpy.mockClear();
  });

  it('answers LIST_TOOLS to the requesting window with the request origin', async () => {
    renderHook(() => useAgentTools());
    enable(true);
    dispatch({ type: 'INFLOW_AGENT_LIST_TOOLS', requestId: 'r1' });
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const [msg, origin] = postSpy.mock.calls[0] as [any, string];
    expect(origin).toBe('https://inflow.im');
    expect(msg.type).toBe('INFLOW_AGENT_RESULT');
    expect(msg.requestId).toBe('r1');
    expect(msg.result.readsEnabled).toBe(true);
    expect(msg.result.tools.map((t: any) => t.name).sort()).toEqual(READ_TOOLS);
  });

  it('answers a disabled CALL_TOOL with a structured error, not silence', async () => {
    renderHook(() => useAgentTools());
    dispatch({ type: 'INFLOW_AGENT_CALL_TOOL', requestId: 'r2', tool: 'get_unread_count', input: {} });
    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    const [msg] = postSpy.mock.calls[0] as [any];
    expect(msg.requestId).toBe('r2');
    expect(msg.result.isError).toBe(true);
    expect(msg.result.content[0].text).toContain('Agent access is disabled');
  });

  it('ignores requests from a non-shell origin and malformed requests', async () => {
    renderHook(() => useAgentTools());
    dispatch({ type: 'INFLOW_AGENT_LIST_TOOLS', requestId: 'evil' }, 'https://evil.example');
    dispatch({ type: 'INFLOW_AGENT_LIST_TOOLS' }); // no requestId
    dispatch({ type: 'OPEN_CONVERSATION', conversationId: 'x' }); // different protocol
    await new Promise((r) => setTimeout(r, 25));
    expect(postSpy).not.toHaveBeenCalled();
  });
});
