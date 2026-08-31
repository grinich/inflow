// @vitest-environment jsdom
/**
 * AgentAccessModal: toggles edit local state only and nothing persists until
 * Save; writes stay subordinate to reads (disabled until reads on; reads off
 * flips writes off); Cancel and Escape discard; Save persists, toasts, closes.
 */
import '../dom-setup';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentAccessModal } from '@/components/common/AgentAccessModal';
import {
  AGENT_BRIDGE_STATUS_KEY,
  getAgentBridgeToken,
  getAgentToolsEnabled,
  getAgentWritesEnabled,
  setAgentBridgeToken,
  setAgentToolsEnabled,
  setAgentWritesEnabled,
} from '@/lib/agent-settings';
import { useUIStore } from '@/store/ui-store';
import { fireStorageChanged, setLocalStore } from '../mocks/chrome';

const readsToggle = () => screen.getByRole('switch', { name: 'Let agents read my inbox' });
const writesToggle = () => screen.getByRole('switch', { name: 'Let agents act' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  useUIStore.setState({ agentAccessOpen: true, toast: null });
});

it('renders nothing while closed', () => {
  useUIStore.setState({ agentAccessOpen: false });
  const { container } = render(<AgentAccessModal />);
  expect(container.innerHTML).toBe('');
});

it('loads persisted values when opening; Save stays disabled until something changes', async () => {
  await setAgentToolsEnabled(true);
  await setAgentWritesEnabled(true);
  render(<AgentAccessModal />);
  await waitFor(() => expect(readsToggle()).toHaveAttribute('aria-checked', 'true'));
  expect(writesToggle()).toHaveAttribute('aria-checked', 'true');
  expect(saveButton()).toBeDisabled();
});

it('toggles do NOT persist until Save; Save persists both, toasts, and closes', async () => {
  render(<AgentAccessModal />);
  await waitFor(() => expect(writesToggle()).toBeDisabled());

  fireEvent.click(readsToggle());
  await waitFor(() => expect(writesToggle()).not.toBeDisabled());
  fireEvent.click(writesToggle());

  // Still nothing persisted — only local state changed.
  expect(await getAgentToolsEnabled()).toBe(false);
  expect(await getAgentWritesEnabled()).toBe(false);

  fireEvent.click(saveButton());
  await waitFor(async () => expect(await getAgentToolsEnabled()).toBe(true));
  expect(await getAgentWritesEnabled()).toBe(true);
  expect(useUIStore.getState().toast?.message).toBe('Agent access enabled (read + act)');
  expect(useUIStore.getState().agentAccessOpen).toBe(false);
});

it('turning reads off flips writes off, and Save persists both off', async () => {
  await setAgentToolsEnabled(true);
  await setAgentWritesEnabled(true);
  render(<AgentAccessModal />);
  await waitFor(() => expect(readsToggle()).toHaveAttribute('aria-checked', 'true'));

  fireEvent.click(readsToggle());
  expect(writesToggle()).toHaveAttribute('aria-checked', 'false');

  fireEvent.click(saveButton());
  await waitFor(async () => expect(await getAgentToolsEnabled()).toBe(false));
  expect(await getAgentWritesEnabled()).toBe(false);
  expect(useUIStore.getState().toast?.message).toBe('Agent access disabled');
});

it('Cancel and Escape discard changes', async () => {
  render(<AgentAccessModal />);
  await waitFor(() => expect(readsToggle()).toHaveAttribute('aria-checked', 'false'));

  fireEvent.click(readsToggle());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(useUIStore.getState().agentAccessOpen).toBe(false));
  expect(await getAgentToolsEnabled()).toBe(false);

  // Reopen: the discarded change must not resurface, and Escape discards too.
  useUIStore.setState({ agentAccessOpen: true });
  await waitFor(() => expect(readsToggle()).toHaveAttribute('aria-checked', 'false'));
  fireEvent.click(readsToggle());
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(useUIStore.getState().agentAccessOpen).toBe(false));
  expect(await getAgentToolsEnabled()).toBe(false);
});

it('pairing code persists only on Save, lowercased input normalized', async () => {
  render(<AgentAccessModal />);
  const input = await screen.findByLabelText('Claude Desktop pairing code');

  fireEvent.change(input, { target: { value: 'inf-abc234' } });
  expect((input as HTMLInputElement).value).toBe('INF-ABC234');
  expect(await getAgentBridgeToken()).toBeNull(); // not yet saved

  fireEvent.click(saveButton());
  await waitFor(async () => expect(await getAgentBridgeToken()).toBe('INF-ABC234'));
  expect(useUIStore.getState().agentAccessOpen).toBe(false);
});

it('shows the live bridge status and updates when the background publishes', async () => {
  await setAgentBridgeToken('INF-ABC234');
  setLocalStore(AGENT_BRIDGE_STATUS_KEY, { state: 'disconnected', at: 1 });
  render(<AgentAccessModal />);
  await waitFor(() =>
    expect(screen.getByTestId('bridge-status').textContent).toContain('waiting for Claude Desktop')
  );

  setLocalStore(AGENT_BRIDGE_STATUS_KEY, { state: 'connected', at: 2 });
  fireStorageChanged({ [AGENT_BRIDGE_STATUS_KEY]: { newValue: { state: 'connected' } } });
  await waitFor(() =>
    expect(screen.getByTestId('bridge-status').textContent).toBe('Connected to Claude Desktop')
  );
});

it('the knob is anchored inside the track (left-0), not floating at the static position', async () => {
  render(<AgentAccessModal />);
  await waitFor(() => expect(readsToggle()).toBeInTheDocument());
  const knob = readsToggle().querySelector('span');
  expect(knob?.className).toContain('left-0');
});
