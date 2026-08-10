// @vitest-environment jsdom
// The connection detail pane shows the selected person and an Open-profile
// action, and an empty state when nothing is selected.
import '../dom-setup';

let mockConnections: any[] = [];
vi.mock('@/hooks/useConnections', () => ({
  useConnections: () => ({ connections: mockConnections, isLoading: false }),
}));
vi.mock('@/hooks/useDbGeneration', () => ({ useDbGeneration: () => 0 }));

// The pane calls useLiveQuery twice per render, in order: profile, then the
// existing conversation. Return each from a controllable variable.
let mockProfile: any = null;
let mockConv: any = null;
let liveCall = 0;
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => {
    const isProfile = liveCall % 2 === 0;
    liveCall++;
    return isProfile ? mockProfile : mockConv;
  },
}));

// AI availability + conversation-summary action are controllable per test.
let mockAiAvailable = false;
const summarizeSpy = vi.fn();
vi.mock('@/hooks/useRefreshConnection', () => ({
  useRefreshConnection: () => ({ refresh: vi.fn(), refreshing: false, available: mockAiAvailable }),
}));
vi.mock('@/hooks/useConversationSummary', () => ({
  useConversationSummary: () => ({
    summarize: summarizeSpy,
    summarizing: false,
    error: null,
    available: mockAiAvailable,
  }),
}));

import { render, screen, act, fireEvent } from '@testing-library/react';
import { ConnectionDetail } from '@/components/connections/ConnectionDetail';
import { useUIStore } from '@/store/ui-store';

const conn = {
  profileUrn: 'urn:li:fsd_profile:P1',
  connectionUrn: 'urn:li:fsd_connection:C1',
  connectedAt: Date.now() - 3 * 86400000,
  publicId: 'adalovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  fullName: 'Ada Lovelace',
  headline: 'Mathematician',
  pictureUrl: '',
  syncedAt: 0,
};

beforeEach(() => {
  mockConnections = [];
  mockProfile = null;
  mockConv = null;
  mockAiAvailable = false;
  liveCall = 0;
  summarizeSpy.mockReset();
  act(() => useUIStore.setState({ selectedConnectionUrn: null }));
});

it('shows an empty state when nothing is selected', () => {
  render(<ConnectionDetail />);
  expect(screen.getByText(/Select a connection/i)).toBeInTheDocument();
});

it('renders the selected person and opens their profile', () => {
  mockConnections = [conn];
  act(() => useUIStore.setState({ selectedConnectionUrn: 'urn:li:fsd_profile:P1' }));
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

  render(<ConnectionDetail />);
  expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  expect(screen.getByText('Mathematician')).toBeInTheDocument();
  expect(screen.getByText(/connected/i)).toBeInTheDocument();

  fireEvent.click(screen.getByText(/Open LinkedIn profile/i));
  expect(openSpy).toHaveBeenCalledWith(
    'https://www.linkedin.com/in/adalovelace',
    '_blank',
    'noopener,noreferrer',
  );
  openSpy.mockRestore();
});

it('renders a cached AI summary and the connected date', () => {
  mockConnections = [
    { ...conn, aiSummary: 'Growth-equity investor at Silversmith.', summarizedAt: Date.now() },
  ];
  act(() => useUIStore.setState({ selectedConnectionUrn: 'urn:li:fsd_profile:P1' }));
  render(<ConnectionDetail />);
  expect(screen.getByText('Growth-equity investor at Silversmith.')).toBeInTheDocument();
  // The facts grid shows a formatted connected date.
  expect(screen.getByText('Connected')).toBeInTheDocument();
});

it('shows a graceful placeholder when there is no summary', () => {
  mockConnections = [conn];
  act(() => useUIStore.setState({ selectedConnectionUrn: 'urn:li:fsd_profile:P1' }));
  render(<ConnectionDetail />);
  expect(screen.getByText(/No summary available/i)).toBeInTheDocument();
});

it('says you have not messaged them when there is no conversation', () => {
  mockConnections = [conn];
  mockConv = null;
  act(() => useUIStore.setState({ selectedConnectionUrn: 'urn:li:fsd_profile:P1' }));
  render(<ConnectionDetail />);
  expect(screen.getByText(/haven.t messaged Ada yet/i)).toBeInTheDocument();
  expect(screen.queryByText(/Open conversation/i)).not.toBeInTheDocument();
});

it('offers Open conversation and jumps to the thread when one exists', () => {
  mockConnections = [conn];
  mockConv = { id: 'conv1', participantUrns: ['urn:li:fsd_profile:P1'], lastActivityAt: Date.now() - 86400000 };
  act(() => useUIStore.setState({ selectedConnectionUrn: 'urn:li:fsd_profile:P1' }));
  render(<ConnectionDetail />);

  const open = screen.getByText(/Open conversation/i);
  expect(open).toBeInTheDocument();
  fireEvent.click(open);
  const s = useUIStore.getState();
  expect(s.activeSection).toBe('inbox');
  expect(s.selectedConversationId).toBe('conv1');
});

it('shows Summarize conversation and calls it when AI is available', () => {
  mockAiAvailable = true;
  mockConnections = [conn];
  mockConv = { id: 'conv1', participantUrns: ['urn:li:fsd_profile:P1'], lastActivityAt: 1000 };
  act(() => useUIStore.setState({ selectedConnectionUrn: 'urn:li:fsd_profile:P1' }));
  render(<ConnectionDetail />);

  const btn = screen.getByRole('button', { name: /^Summarize$/i });
  fireEvent.click(btn);
  expect(summarizeSpy).toHaveBeenCalledTimes(1);
  expect(summarizeSpy.mock.calls[0][0].profileUrn).toBe('urn:li:fsd_profile:P1');
  expect(summarizeSpy.mock.calls[0][1].id).toBe('conv1');
});

it('flags an outdated summary when newer messages exist', () => {
  mockAiAvailable = true;
  mockConnections = [
    { ...conn, conversationSummary: 'We discussed a term sheet.', conversationSummaryLastMsgAt: 500 },
  ];
  mockConv = { id: 'conv1', participantUrns: ['urn:li:fsd_profile:P1'], lastActivityAt: 900 };
  act(() => useUIStore.setState({ selectedConnectionUrn: 'urn:li:fsd_profile:P1' }));
  render(<ConnectionDetail />);

  expect(screen.getByText('We discussed a term sheet.')).toBeInTheDocument();
  expect(screen.getByText(/Outdated/i)).toBeInTheDocument();
});

it('does not flag an up-to-date summary as outdated', () => {
  mockAiAvailable = true;
  mockConnections = [
    { ...conn, conversationSummary: 'We discussed a term sheet.', conversationSummaryLastMsgAt: 900 },
  ];
  mockConv = { id: 'conv1', participantUrns: ['urn:li:fsd_profile:P1'], lastActivityAt: 900 };
  act(() => useUIStore.setState({ selectedConnectionUrn: 'urn:li:fsd_profile:P1' }));
  render(<ConnectionDetail />);

  expect(screen.getByText('We discussed a term sheet.')).toBeInTheDocument();
  expect(screen.queryByText(/Outdated/i)).not.toBeInTheDocument();
});
