// @vitest-environment jsdom
// The connections list surfaces AI categories: role/interest filter chips,
// badges on rows, and filtering the visible list.
import '../dom-setup';

const { sendBridgeMessage } = vi.hoisted(() => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage }));

// Keep the auto-categorizer inert in these tests (no DB / AI).
vi.mock('@/hooks/useAutoCategorize', () => ({
  useAutoCategorize: () => ({ categorizing: false, remaining: 0 }),
}));
vi.mock('@/hooks/useAISession', () => ({ useAISession: () => ({ available: true, predict: vi.fn() }) }));

let mockConnections: any[] = [];
vi.mock('@/hooks/useConnections', () => ({
  useConnections: () => ({ connections: mockConnections, isLoading: false }),
}));

import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { ConnectionsList } from '@/components/connections/ConnectionsList';
import { useUIStore } from '@/store/ui-store';

function makeConn(over: Partial<any> = {}) {
  return {
    profileUrn: 'urn:li:fsd_profile:P1',
    connectionUrn: 'urn:li:fsd_connection:C1',
    connectedAt: Date.now(),
    publicId: 'p1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    fullName: 'Ada Lovelace',
    headline: 'Partner at Foo Ventures',
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

it('renders role and interest filter chips from categorized data', () => {
  mockConnections = [
    makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace', roleCategory: 'Investor', interestTags: ['Investors'] }),
    makeConn({ profileUrn: 'b', fullName: 'Alan Turing', roleCategory: 'Engineering', interestTags: [] }),
  ];
  render(<ConnectionsList />);

  // Interest chip (starred) and both role chips present — scoped to the filter
  // bar so we don't match the same text on connection rows.
  const bar = within(screen.getByTestId('connection-filters'));
  expect(bar.getByRole('button', { name: /★ Investors/ })).toBeInTheDocument();
  expect(bar.getByRole('button', { name: /^Investor\s?\d/ })).toBeInTheDocument();
  expect(bar.getByRole('button', { name: /^Engineering/ })).toBeInTheDocument();
  expect(bar.getByRole('button', { name: /^All/ })).toBeInTheDocument();
});

it('filters the visible list when a role chip is clicked', () => {
  mockConnections = [
    makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace', roleCategory: 'Investor', interestTags: ['Investors'] }),
    makeConn({ profileUrn: 'b', fullName: 'Alan Turing', roleCategory: 'Engineering', interestTags: [] }),
  ];
  render(<ConnectionsList />);

  expect(screen.getByText('Alan Turing')).toBeInTheDocument();
  const bar = within(screen.getByTestId('connection-filters'));
  fireEvent.click(bar.getByRole('button', { name: /★ Investors/ }));

  expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  expect(screen.queryByText('Alan Turing')).not.toBeInTheDocument();
});

it('shows a role badge on categorized rows but hides Other', () => {
  mockConnections = [
    makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace', roleCategory: 'Investor' }),
    makeConn({ profileUrn: 'b', fullName: 'Alan Turing', roleCategory: 'Other' }),
  ];
  render(<ConnectionsList />);

  const adaRow = screen.getByText('Ada Lovelace').closest('button')!;
  expect(within(adaRow).getByText('Investor')).toBeInTheDocument();

  const alanRow = screen.getByText('Alan Turing').closest('button')!;
  expect(within(alanRow).queryByText('Other')).not.toBeInTheDocument();
});

it('does not render a filter bar when nothing is categorized yet', () => {
  mockConnections = [makeConn({ profileUrn: 'a', fullName: 'Ada Lovelace' })];
  render(<ConnectionsList />);
  expect(screen.queryByTestId('connection-filters')).not.toBeInTheDocument();
});
