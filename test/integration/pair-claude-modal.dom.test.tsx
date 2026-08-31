// @vitest-environment jsdom
/**
 * PairClaudeModal — the one-decision confirmation a ?pair= launch link opens:
 * Connect saves the code (and routes to Agent Access when access is off),
 * Cancel and Escape save nothing.
 */
import '../dom-setup';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PairClaudeModal } from '@/components/common/PairClaudeModal';
import {
  getAgentBridgeToken,
  getAgentToolsEnabled,
  getAgentWritesEnabled,
} from '@/lib/agent-settings';
import { useUIStore } from '@/store/ui-store';

const CODE = 'INF-QRS234';

beforeEach(() => {
  useUIStore.setState({ pairRequestCode: CODE, agentAccessOpen: false, toast: null });
});

it('renders nothing without a pair request', () => {
  useUIStore.setState({ pairRequestCode: null });
  const { container } = render(<PairClaudeModal />);
  expect(container.innerHTML).toBe('');
});

it('shows the code for the user to verify against what Claude displayed', () => {
  render(<PairClaudeModal />);
  expect(screen.getByText('Connect Claude Desktop')).toBeInTheDocument();
  expect(screen.getByText(CODE)).toBeInTheDocument();
});

it('Connect saves the code, enables READ (never writes), toasts, and opens Agent Access', async () => {
  render(<PairClaudeModal />);
  // The consent is stated up front: connecting grants read access.
  expect(screen.getByText(/Connecting lets it/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(async () => expect(await getAgentBridgeToken()).toBe(CODE));
  expect(await getAgentToolsEnabled()).toBe(true); // exactly what the copy promises
  expect(await getAgentWritesEnabled()).toBe(false); // and nothing more
  expect(useUIStore.getState().toast?.message).toBe(
    'Paired with Claude Desktop — read access enabled'
  );
  expect(useUIStore.getState().pairRequestCode).toBeNull();
  expect(useUIStore.getState().agentAccessOpen).toBe(true); // offer the "act" toggle
});

it('Cancel and Escape close without saving anything', async () => {
  render(<PairClaudeModal />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(useUIStore.getState().pairRequestCode).toBeNull());
  expect(await getAgentBridgeToken()).toBeNull();
  expect(await getAgentToolsEnabled()).toBe(false); // no consent granted on cancel

  act(() => useUIStore.setState({ pairRequestCode: CODE }));
  await screen.findByText('Connect Claude Desktop'); // modal (and its Escape listener) is back
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(useUIStore.getState().pairRequestCode).toBeNull());
  expect(await getAgentBridgeToken()).toBeNull();
});
