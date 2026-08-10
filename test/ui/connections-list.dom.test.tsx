// @vitest-environment jsdom
// The Connections list renders people from the local table, refreshes from
// LinkedIn on mount, auto-selects the first person, and selects on click.
import '../dom-setup';

const { sendBridgeMessage } = vi.hoisted(() => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage }));

// Keep the AI hooks inert so this test never runs the real categorizer/predict.
vi.mock('@/hooks/useAutoCategorize', () => ({
  useAutoCategorize: () => ({
    categorizing: false, remaining: 0, done: 0, failed: 0, error: null,
    uncategorized: 0, mode: 'auto', retry: vi.fn(), categorizeNow: vi.fn(),
  }),
}));
vi.mock('@/hooks/useAISession', () => ({ useAISession: () => ({ available: false, predict: vi.fn() }) }));

let mockConnections: any[] = [];
vi.mock('@/hooks/useConnections', () => ({
  useConnections: () => ({ connections: mockConnections, isLoading: false }),
}));

import { render, screen, act, fireEvent } from '@testing-library/react';
import { ConnectionsList } from '@/components/connections/ConnectionsList';
import { useUIStore } from '@/store/ui-store';

function makeConn(over: Partial<any> = {}) {
  return {
    profileUrn: 'urn:li:fsd_profile:P1',
    connectionUrn: 'urn:li:fsd_connection:C1',
    connectedAt: Date.now() - 2 * 86400000,
    publicId: 'adalovelace',
    firstName: 'Ada',
    lastName: 'Lovelace',
    fullName: 'Ada Lovelace',
    headline: 'Mathematician',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true, data: { count: 0 } });
  mockConnections = [];
  act(() => useUIStore.setState({ selectedConnectionUrn: null, connectionsFilter: { kind: 'all' }, connectionsSearch: '' }));
});

it('fetches a refresh on mount and lists connections', () => {
  mockConnections = [
    makeConn(),
    makeConn({ profileUrn: 'urn:li:fsd_profile:P2', fullName: 'Alan Turing', headline: 'Cryptanalyst', publicId: 'aturing' }),
  ];
  render(<ConnectionsList />);

  expect(screen.getByText('Connections')).toBeInTheDocument();
  expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  expect(screen.getByText('Alan Turing')).toBeInTheDocument();
  expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'FETCH_CONNECTIONS' });
});

it('auto-selects the first connection', () => {
  mockConnections = [makeConn(), makeConn({ profileUrn: 'urn:li:fsd_profile:P2', fullName: 'Alan Turing' })];
  render(<ConnectionsList />);
  expect(useUIStore.getState().selectedConnectionUrn).toBe('urn:li:fsd_profile:P1');
});

it('selects a connection on click', () => {
  mockConnections = [makeConn(), makeConn({ profileUrn: 'urn:li:fsd_profile:P2', fullName: 'Alan Turing' })];
  render(<ConnectionsList />);
  fireEvent.click(screen.getByText('Alan Turing'));
  expect(useUIStore.getState().selectedConnectionUrn).toBe('urn:li:fsd_profile:P2');
});

it('shows an empty state once the refresh settles with none', async () => {
  mockConnections = [];
  render(<ConnectionsList />);
  await screen.findByText(/No connections found/i);
});

it('opens a context menu on right-click', () => {
  mockConnections = [makeConn()];
  render(<ConnectionsList />);
  fireEvent.contextMenu(screen.getByText('Ada Lovelace'));
  expect(screen.getByRole('menu')).toBeInTheDocument();
  expect(screen.getByText('Set role')).toBeInTheDocument();
});
