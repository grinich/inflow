// @vitest-environment jsdom
// The connections list supports searching by name/headline and sorting by
// date added (default), first name, or last name.
import '../dom-setup';

const { sendBridgeMessage } = vi.hoisted(() => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage }));
vi.mock('@/hooks/useAutoCategorize', () => ({
  useAutoCategorize: () => ({ categorizing: false, remaining: 0 }),
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
    profileUrn: 'p',
    connectionUrn: 'c',
    connectedAt: 0,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: '',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

const ada = makeConn({ profileUrn: 'a', firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace', headline: 'Mathematician', connectedAt: 300 });
const alan = makeConn({ profileUrn: 'b', firstName: 'Alan', lastName: 'Turing', fullName: 'Alan Turing', headline: 'Cryptanalyst', connectedAt: 200 });
const grace = makeConn({ profileUrn: 'c', firstName: 'Grace', lastName: 'Hopper', fullName: 'Grace Hopper', headline: 'Compiler pioneer', connectedAt: 100 });

function order() {
  return Array.from(document.querySelectorAll('[data-connection-urn]')).map((el) =>
    el.getAttribute('data-connection-urn'),
  );
}

beforeEach(() => {
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true, data: { count: 0 } });
  mockConnections = [ada, alan, grace];
  localStorage.clear();
  act(() => useUIStore.setState({ selectedConnectionUrn: null, connectionsFilter: { kind: 'all' }, connectionsSearch: '' }));
});

it('defaults to most-recent-first order', () => {
  render(<ConnectionsList />);
  expect(order()).toEqual(['a', 'b', 'c']); // connectedAt 300, 200, 100
});

it('filters by name via the search box', () => {
  render(<ConnectionsList />);
  fireEvent.change(screen.getByPlaceholderText(/Search connections/i), { target: { value: 'turing' } });
  expect(order()).toEqual(['b']);
});

it('searches headlines too', () => {
  render(<ConnectionsList />);
  fireEvent.change(screen.getByPlaceholderText(/Search connections/i), { target: { value: 'compiler' } });
  expect(order()).toEqual(['c']);
});

it('sorts by first name', () => {
  render(<ConnectionsList />);
  fireEvent.change(screen.getByLabelText(/Sort connections/i), { target: { value: 'first' } });
  expect(order()).toEqual(['a', 'b', 'c']); // Ada, Alan, Grace
});

it('sorts by last name', () => {
  render(<ConnectionsList />);
  fireEvent.change(screen.getByLabelText(/Sort connections/i), { target: { value: 'last' } });
  expect(order()).toEqual(['c', 'a', 'b']); // Hopper, Lovelace, Turing
});

it('persists the sort choice to localStorage', () => {
  render(<ConnectionsList />);
  fireEvent.change(screen.getByLabelText(/Sort connections/i), { target: { value: 'last' } });
  expect(localStorage.getItem('inflow-connections-sort')).toBe('last');
});

it('shows a no-match message when search finds nothing', () => {
  render(<ConnectionsList />);
  fireEvent.change(screen.getByPlaceholderText(/Search connections/i), { target: { value: 'zzz' } });
  expect(screen.getByText(/No connections match/i)).toBeInTheDocument();
});
