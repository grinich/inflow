// @vitest-environment jsdom
// Manual categorization controls: the "Categorize N" button in the list header
// and the per-connection "Refresh" button in the detail pane.
import '../dom-setup';

const { sendBridgeMessage } = vi.hoisted(() => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage }));
vi.mock('@/lib/backup-service', () => ({ maybeAutoBackup: vi.fn() }));
vi.mock('@/hooks/useAISession', () => ({ useAISession: () => ({ available: true, predict: vi.fn() }) }));
vi.mock('@/hooks/useDbGeneration', () => ({ useDbGeneration: () => 0 }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => null }));

let mockConnections: any[] = [];
vi.mock('@/hooks/useConnections', () => ({
  useConnections: () => ({ connections: mockConnections, isLoading: false }),
}));

const categorizeNow = vi.fn();
let autoState: any;
vi.mock('@/hooks/useAutoCategorize', () => ({
  useAutoCategorize: () => autoState,
}));

const refresh = vi.fn();
let refreshState: any;
vi.mock('@/hooks/useRefreshConnection', () => ({
  useRefreshConnection: () => refreshState,
}));

const setMode = vi.fn();
let mode: 'auto' | 'manual' = 'auto';
vi.mock('@/hooks/useCategorizeMode', () => ({
  useCategorizeMode: () => [mode, setMode] as const,
}));
vi.mock('@/hooks/useConnectionSummary', () => ({
  useConnectionSummary: () => ({ summary: '', generating: false }),
}));

import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { ConnectionsList } from '@/components/connections/ConnectionsList';
import { ConnectionDetail } from '@/components/connections/ConnectionDetail';
import { useUIStore } from '@/store/ui-store';

const conn = {
  profileUrn: 'urn:li:fsd_profile:P1',
  connectionUrn: 'c1',
  connectedAt: Date.now(),
  publicId: 'ada',
  firstName: 'Ada',
  lastName: 'Lovelace',
  fullName: 'Ada Lovelace',
  headline: 'Investor',
  pictureUrl: '',
  syncedAt: 0,
};

beforeEach(() => {
  sendBridgeMessage.mockReset().mockResolvedValue({ success: true, data: { count: 0 } });
  categorizeNow.mockReset();
  refresh.mockReset();
  setMode.mockReset();
  mode = 'auto';
  mockConnections = [];
  autoState = {
    categorizing: false, remaining: 0, done: 0, failed: 0, error: null,
    uncategorized: 0, mode: 'manual', retry: vi.fn(), categorizeNow,
  };
  refreshState = { refreshing: false, available: true, refresh };
  act(() => useUIStore.setState({ selectedConnectionUrn: null, toast: null, connectionsFilter: { kind: 'all' }, connectionsSearch: '' }));
});

it('shows the full categorization error, wrapped and with a hover title', () => {
  const longErr =
    'No response — the AI may be rate-limited (Gemini free tier is limited per minute). Wait a minute, then Retry.';
  autoState = { ...autoState, categorizing: false, failed: 980, error: longErr };
  mockConnections = [conn];
  render(<ConnectionsList />);
  const msg = screen.getByText(/Couldn.t categorize 980 connections — No response/i);
  expect(msg).not.toHaveClass('truncate');
  expect(msg).toHaveAttribute('title', expect.stringContaining('rate-limited'));
});

it('shows a visible AI scan progress bar while categorizing', () => {
  autoState = { ...autoState, categorizing: true, done: 10, remaining: 90 };
  mockConnections = [conn];
  render(<ConnectionsList />);
  const strip = screen.getByTestId('categorize-progress');
  expect(within(strip).getByText(/Scanning connections with AI/i)).toBeInTheDocument();
  expect(within(strip).getByText('10 of 100')).toBeInTheDocument();
});

it('toasts when a categorization pass completes', () => {
  autoState = { ...autoState, categorizing: true, done: 0, remaining: 5 };
  mockConnections = [conn];
  const { rerender } = render(<ConnectionsList />);
  autoState = { ...autoState, categorizing: false, done: 5, remaining: 0 };
  rerender(<ConnectionsList />);
  expect(useUIStore.getState().toast?.message).toMatch(/Categorized 5 connections/i);
});

it('toggles AI auto/manual from the header', () => {
  mockConnections = [conn];
  render(<ConnectionsList />);
  const toggle = screen.getByRole('button', { name: /auto-categorize on/i });
  fireEvent.click(toggle);
  expect(setMode).toHaveBeenCalledWith('manual');
});

it('reflects manual mode in the header toggle', () => {
  mode = 'manual';
  mockConnections = [conn];
  render(<ConnectionsList />);
  expect(screen.getByRole('button', { name: /auto-categorize off/i })).toBeInTheDocument();
});

it('shows a "Categorize N" button when people are uncategorized and triggers it', () => {
  mockConnections = [conn];
  autoState.uncategorized = 3;
  render(<ConnectionsList />);
  const btn = screen.getByRole('button', { name: /Categorize 3/ });
  fireEvent.click(btn);
  expect(categorizeNow).toHaveBeenCalled();
});

it('hides the "Categorize" button when nothing is uncategorized', () => {
  mockConnections = [conn];
  autoState.uncategorized = 0;
  render(<ConnectionsList />);
  expect(screen.queryByRole('button', { name: /Categorize \d/ })).not.toBeInTheDocument();
});

it('offers a per-connection Refresh that re-analyzes the person', () => {
  mockConnections = [conn];
  act(() => useUIStore.setState({ selectedConnectionUrn: 'urn:li:fsd_profile:P1' }));
  render(<ConnectionDetail />);
  fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
  expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ profileUrn: 'urn:li:fsd_profile:P1' }));
});
