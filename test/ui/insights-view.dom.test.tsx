// @vitest-environment jsdom
// The Insights overview shows network composition (the "40% investors" stat),
// firm clustering, and an empty state.
import '../dom-setup';

let mockConnections: any[] = [];
vi.mock('@/hooks/useConnections', () => ({
  useConnections: () => ({ connections: mockConnections, isLoading: false }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { InsightsView } from '@/components/insights/InsightsView';
import { useUIStore } from '@/store/ui-store';

function c(over: any = {}) {
  return {
    profileUrn: Math.random().toString(),
    connectionUrn: '',
    connectedAt: 0,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: 'X',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  mockConnections = [];
  try { localStorage.clear(); } catch {}
  useUIStore.setState({
    activeSection: 'insights',
    connectionsFilter: { kind: 'all' },
    connectionsSearch: '',
  });
});

it('shows an empty state with no connections', () => {
  render(<InsightsView />);
  expect(screen.getByText(/No connections yet/i)).toBeInTheDocument();
});

it('leads with the dominant-role composition stat', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme Ventures' }),
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Principal at Acme Ventures' }),
    c({ roleCategory: 'Founder', categorizedAt: 1, headline: 'CEO at Solo Co' }),
    c({ roleCategory: 'Engineering', categorizedAt: 1, headline: 'Eng at Solo Co' }),
  ];
  render(<InsightsView />);
  expect(screen.getByText(/Your network is 50% investors/i)).toBeInTheDocument();
  // Firm clustering surfaces the 2-person firm.
  expect(screen.getByText(/Clustered around Acme Ventures/i)).toBeInTheDocument();
});

it('shows composition and suggestions on one dashboard (no tabs); Ask lives in its own section', () => {
  mockConnections = [c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme' })];
  render(<InsightsView />);
  // No tab buttons.
  expect(screen.queryByRole('button', { name: 'Suggestions' })).not.toBeInTheDocument();
  expect(screen.getByText('Composition by role')).toBeInTheDocument();
  expect(screen.getByText('Follow up')).toBeInTheDocument();
  // Ask moved out of Insights into the dedicated Chat section.
  expect(screen.queryByText('Ask your network')).not.toBeInTheDocument();
});

it('drills into Connections filtered by role when a composition bar is clicked', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme' }),
    c({ roleCategory: 'Founder', categorizedAt: 1, headline: 'CEO at Solo' }),
  ];
  render(<InsightsView />);
  fireEvent.click(screen.getByRole('button', { name: /Show Investor/i }));
  const s = useUIStore.getState();
  expect(s.activeSection).toBe('connections');
  expect(s.connectionsFilter).toEqual({ kind: 'role', value: 'Investor' });
});

it('drills into Connections filtered by interest tag when a tag bar is clicked', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1, interestTags: ['Investors'] }),
  ];
  render(<InsightsView />);
  fireEvent.click(screen.getByRole('button', { name: /Show ★ Investors/i }));
  const s = useUIStore.getState();
  expect(s.activeSection).toBe('connections');
  expect(s.connectionsFilter).toEqual({ kind: 'interest', value: 'Investors' });
});

it('drills into Connections searched by firm when a firm bar is clicked', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme Ventures' }),
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Principal at Acme Ventures' }),
  ];
  render(<InsightsView />);
  fireEvent.click(screen.getByRole('button', { name: /Show Acme Ventures/i }));
  const s = useUIStore.getState();
  expect(s.activeSection).toBe('connections');
  expect(s.connectionsSearch).toBe('Acme Ventures');
});

it('Customize lets you hide a section and restore it from the tray', () => {
  mockConnections = [c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme' })];
  const { container } = render(<InsightsView />);

  // Composition is visible initially.
  expect(container.querySelector('[data-section="composition"]')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Customize/i }));
  fireEvent.click(screen.getByRole('button', { name: /Hide Composition by role/i }));

  // Card gone from the grid; appears in the hidden tray as a restore button.
  expect(container.querySelector('[data-section="composition"]')).not.toBeInTheDocument();
  const restore = screen.getByRole('button', { name: 'Composition by role' });
  fireEvent.click(restore);
  expect(container.querySelector('[data-section="composition"]')).toBeInTheDocument();
});

it('Customize can move a section down past its sibling', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Partner at Acme Ventures' }),
    c({ roleCategory: 'Investor', categorizedAt: 1, headline: 'Principal at Acme Ventures' }),
  ];
  const { container } = render(<InsightsView />);
  const order = () => Array.from(container.querySelectorAll('[data-section]')).map((el) => el.getAttribute('data-section'));
  // AI suggestions leads the default order.
  expect(order()[0]).toBe('aisuggestions');

  fireEvent.click(screen.getByRole('button', { name: /Customize/i }));
  // Move "AI suggestions" down one — it should no longer be first.
  fireEvent.click(screen.getByRole('button', { name: /Move AI suggestions down/i }));
  expect(order()[0]).not.toBe('aisuggestions');
});

it('nudges to categorize when some are uncategorized', () => {
  mockConnections = [
    c({ roleCategory: 'Investor', categorizedAt: 1 }),
    c({}), // uncategorized
  ];
  render(<InsightsView />);
  const nudge = screen.getByText(/1 of 2 not categorized yet/i);
  fireEvent.click(nudge);
  expect(useUIStore.getState().activeSection).toBe('connections');
});
