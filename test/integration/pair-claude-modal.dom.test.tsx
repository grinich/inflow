// @vitest-environment jsdom
/**
 * PairClaudeModal — the one-decision confirmation a ?pair= launch link opens:
 * Connect saves the code (and routes to Agent Access when access is off),
 * Cancel and Escape save nothing.
 */
import '../dom-setup';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PairClaudeModal } from '@/components/common/PairClaudeModal';
import { getAgentBridgeToken, setAgentToolsEnabled } from '@/lib/agent-settings';
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

it('Connect saves the code, toasts, and opens Agent Access while access is off', async () => {
  render(<PairClaudeModal />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(async () => expect(await getAgentBridgeToken()).toBe(CODE));
  expect(useUIStore.getState().toast?.message).toBe('Paired with Claude Desktop');
  expect(useUIStore.getState().pairRequestCode).toBeNull();
  expect(useUIStore.getState().agentAccessOpen).toBe(true); // access still off → choose consents
});

it('Connect skips Agent Access when access is already enabled', async () => {
  await setAgentToolsEnabled(true);
  render(<PairClaudeModal />);
  // Wait for the enabled-state load so the confirm branch sees it.
  await waitFor(() =>
    expect(screen.queryByText(/Agent access is currently off/)).not.toBeInTheDocument()
  );
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  await waitFor(async () => expect(await getAgentBridgeToken()).toBe(CODE));
  expect(useUIStore.getState().agentAccessOpen).toBe(false);
});

it('Cancel and Escape close without saving anything', async () => {
  render(<PairClaudeModal />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(useUIStore.getState().pairRequestCode).toBeNull());
  expect(await getAgentBridgeToken()).toBeNull();

  act(() => useUIStore.setState({ pairRequestCode: CODE }));
  await screen.findByText('Connect Claude Desktop'); // modal (and its Escape listener) is back
  fireEvent.keyDown(window, { key: 'Escape' });
  await waitFor(() => expect(useUIStore.getState().pairRequestCode).toBeNull());
  expect(await getAgentBridgeToken()).toBeNull();
});
