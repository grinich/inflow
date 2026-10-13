// @vitest-environment jsdom
// The Outbox MCP status bar: a real on/off toggle (persisted), a click-to-reveal
// connection log, and setup instructions (code + .mcpb download + advanced CLI).
import '../dom-setup';

const { startMcpBridge, stopMcpBridge } = vi.hoisted(() => ({ startMcpBridge: vi.fn(), stopMcpBridge: vi.fn() }));
vi.mock('@/lib/mcp/bridge-client', () => ({ startMcpBridge, stopMcpBridge }));

const { getOrCreatePairingCode, getMcpEnabled, setMcpEnabled } = vi.hoisted(() => ({
  getOrCreatePairingCode: vi.fn(async () => 'A1B2-C3D4'),
  getMcpEnabled: vi.fn(async () => true),
  setMcpEnabled: vi.fn(async () => {}),
}));
vi.mock('@/lib/mcp/pairing', () => ({ getOrCreatePairingCode, getMcpEnabled, setMcpEnabled }));

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { McpStatusBar } from '@/components/outbox/McpStatusBar';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  startMcpBridge.mockClear();
  stopMcpBridge.mockClear();
  setMcpEnabled.mockClear();
  getMcpEnabled.mockResolvedValue(true);
  act(() => useUIStore.setState({ mcpStatus: 'disconnected', mcpError: null, mcpActivity: [] }));
});

it('reveals setup (pairing code + download) via the Setup button', async () => {
  render(<McpStatusBar />);
  fireEvent.click(screen.getByRole('button', { name: /^Setup$/ }));
  expect(screen.getByText(/Claude Desktop extension/i)).toBeInTheDocument();
  expect(await screen.findByText('A1B2-C3D4')).toBeInTheDocument();
  const dl = screen.getByRole('link', { name: /Download inflow\.mcpb/i });
  expect(dl).toHaveAttribute('download', 'inflow.mcpb');
});

it('reveals CLI-client instructions under the Advanced toggle', () => {
  render(<McpStatusBar />);
  fireEvent.click(screen.getByRole('button', { name: /^Setup$/ }));
  expect(screen.queryByText(/copy config/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Advanced · CLI/i }));
  expect(screen.getByText(/copy config/i)).toBeInTheDocument();
  expect(screen.getByText(/npx -y inflow-mcp/)).toBeInTheDocument();
});

it('Disconnect turns the bridge off and persists it', async () => {
  render(<McpStatusBar />);
  // Enabled by default → the toggle reads "Disconnect".
  fireEvent.click(await screen.findByRole('button', { name: /^Disconnect$/ }));
  await waitFor(() => expect(setMcpEnabled).toHaveBeenCalledWith(false));
  expect(stopMcpBridge).toHaveBeenCalled();
});

it('Connect turns the bridge on and persists it', async () => {
  getMcpEnabled.mockResolvedValue(false); // came back from a prior Disconnect
  render(<McpStatusBar />);
  fireEvent.click(await screen.findByRole('button', { name: /^Connect$/ }));
  await waitFor(() => expect(setMcpEnabled).toHaveBeenCalledWith(true));
  expect(startMcpBridge).toHaveBeenCalledWith('A1B2-C3D4');
});

it('reveals the connection log when the status is clicked', () => {
  act(() => useUIStore.setState({
    mcpStatus: 'connected',
    mcpActivity: [{ id: '1', at: Date.now(), text: 'Claude searched your connections for “investors”' }],
  }));
  render(<McpStatusBar />);
  expect(screen.queryByText(/searched your connections/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Claude connected/i }));
  expect(screen.getByText(/searched your connections/i)).toBeInTheDocument();
});

it('makes Setup look like the control it is, not a label', () => {
  render(<McpStatusBar />);
  const setup = screen.getByRole('button', { name: /^Setup$/ });

  // Its two neighbours carry weight at rest (Connect is filled and ringed,
  // Disconnect is ringed); Setup carried none, so it read as plain text.
  // It stays quiet at rest and gains a surface and a border under the pointer.
  expect(setup.className).toMatch(/hover:bg-surface-hover/);
  expect(setup.className).toMatch(/hover:ring-edge/);
});
