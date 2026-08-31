// @vitest-environment jsdom
/**
 * AgentAccessModal: persists the two toggles, keeps writes subordinate to
 * reads (disabled until reads on; reads off also persists writes off),
 * Escape closes, and every change toasts.
 */
import '../dom-setup';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentAccessModal } from '@/components/common/AgentAccessModal';
import {
  getAgentToolsEnabled,
  getAgentWritesEnabled,
  setAgentToolsEnabled,
  setAgentWritesEnabled,
} from '@/lib/agent-settings';
import { useUIStore } from '@/store/ui-store';

const readsToggle = () => screen.getByRole('switch', { name: 'Let agents read my inbox' });
const writesToggle = () => screen.getByRole('switch', { name: 'Let agents act' });

beforeEach(() => {
  useUIStore.setState({ agentAccessOpen: true, toast: null });
});

it('renders nothing while closed', () => {
  useUIStore.setState({ agentAccessOpen: false });
  const { container } = render(<AgentAccessModal />);
  expect(container.innerHTML).toBe('');
});

it('loads persisted values when opening', async () => {
  await setAgentToolsEnabled(true);
  await setAgentWritesEnabled(true);
  render(<AgentAccessModal />);
  await waitFor(() => expect(readsToggle()).toHaveAttribute('aria-checked', 'true'));
  expect(writesToggle()).toHaveAttribute('aria-checked', 'true');
});

it('writes toggle is disabled until reads are on', async () => {
  render(<AgentAccessModal />);
  await waitFor(() => expect(writesToggle()).toBeDisabled());

  fireEvent.click(readsToggle());
  await waitFor(() => expect(writesToggle()).not.toBeDisabled());
  expect(await getAgentToolsEnabled()).toBe(true);
  expect(useUIStore.getState().toast?.message).toBe('Agent read access enabled');

  fireEvent.click(writesToggle());
  await waitFor(async () => expect(await getAgentWritesEnabled()).toBe(true));
  expect(useUIStore.getState().toast?.message).toBe('Agent write actions enabled');
});

it('turning reads off also persists writes off', async () => {
  await setAgentToolsEnabled(true);
  await setAgentWritesEnabled(true);
  render(<AgentAccessModal />);
  await waitFor(() => expect(readsToggle()).toHaveAttribute('aria-checked', 'true'));

  fireEvent.click(readsToggle());
  await waitFor(async () => expect(await getAgentToolsEnabled()).toBe(false));
  expect(await getAgentWritesEnabled()).toBe(false);
  expect(writesToggle()).toHaveAttribute('aria-checked', 'false');
});

it('Escape closes the modal', async () => {
  render(<AgentAccessModal />);
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(useUIStore.getState().agentAccessOpen).toBe(false));
});
