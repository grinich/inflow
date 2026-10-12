// @vitest-environment jsdom
// The nav rail switches sections and collapses/expands.
import '../dom-setup';

import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { NavRail } from '@/components/nav/NavRail';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  act(() => useUIStore.setState({ activeSection: 'inbox', navRailCollapsed: false, sectionHistory: [], sectionForward: [] }));
  try { localStorage.clear(); } catch {}
});

it('renders both sections with labels when expanded', () => {
  render(<NavRail connectionsCount={18} />);
  expect(screen.getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Connections' })).toBeInTheDocument();
  expect(screen.getByText('18')).toBeInTheDocument();
});

it('switches the active section on click', () => {
  render(<NavRail connectionsCount={3} />);
  fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
  expect(useUIStore.getState().activeSection).toBe('connections');
});

it('collapse toggle flips state and persists', () => {
  render(<NavRail connectionsCount={3} />);
  fireEvent.click(screen.getByLabelText(/Collapse sidebar/i));
  expect(useUIStore.getState().navRailCollapsed).toBe(true);
  expect(localStorage.getItem('inflow-nav-collapsed')).toBe('1');
});

it('shows the Flow section', () => {
  render(<NavRail connectionsCount={3} />);
  expect(screen.getByRole('button', { name: 'AI Chat' })).toBeInTheDocument();
});

it('shows the MCP connector section with an attention badge', () => {
  render(<NavRail connectionsCount={3} outboxAttention={2} />);
  const btn = screen.getByRole('button', { name: 'MCP connector' });
  expect(btn).toBeInTheDocument();
  expect(within(btn).getByText('2')).toBeInTheDocument();
});

it('shows Invitations as an expandable branch under Connections', () => {
  render(<NavRail connectionsCount={3} invitationsCount={40} />);
  // Branch is expanded by default → the child is visible with its count.
  const inv = screen.getByRole('button', { name: 'Invitations' });
  expect(inv).toBeInTheDocument();
  expect(within(inv).getByText('40')).toBeInTheDocument();

  // Selecting the child switches to the invitations section.
  fireEvent.click(inv);
  expect(useUIStore.getState().activeSection).toBe('invitations');

  // The chevron collapses the branch, hiding the child.
  fireEvent.click(screen.getByLabelText(/Collapse Connections/i));
  expect(screen.queryByRole('button', { name: 'Invitations' })).not.toBeInTheDocument();
});

it('highlights the Inbox parent and the active tab together (option B)', () => {
  act(() => useUIStore.setState({ activeSection: 'inbox', inboxTab: 'other' }));
  render(<NavRail connectionsCount={3} />);
  // Parent Inbox is marked current…
  expect(screen.getByRole('button', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
  // …and so is the active tab child (Other = the 'other' tab; the InMail tab
  // is a separate, message-type view).
  expect(screen.getByRole('button', { name: 'Other' })).toHaveAttribute('aria-current', 'page');
  // Connections (a different section) is not highlighted.
  expect(screen.getByRole('button', { name: 'Connections' })).not.toHaveAttribute('aria-current');
});

it('renders a custom Inbox section name from settings', () => {
  act(() => useUIStore.setState({ inboxSectionLabel: 'Messages' }));
  render(<NavRail connectionsCount={3} />);
  expect(screen.getByRole('button', { name: 'Messages' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Inbox' })).not.toBeInTheDocument();
  act(() => useUIStore.setState({ inboxSectionLabel: 'Inbox' }));
});

it('shows a hover description for each section', () => {
  render(<NavRail connectionsCount={3} />);
  expect(screen.getByText(/Read and reply to your LinkedIn messages/i)).toBeInTheDocument();
  expect(screen.getByText(/Ask AI anything about your network/i)).toBeInTheDocument();
});

it('back/forward arrows navigate section history', () => {
  render(<NavRail connectionsCount={3} />);
  // Nothing to go back to yet.
  expect(screen.getByLabelText(/Back to previous section/i)).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
  expect(useUIStore.getState().activeSection).toBe('connections');

  fireEvent.click(screen.getByLabelText(/Back to previous section/i));
  expect(useUIStore.getState().activeSection).toBe('inbox');

  fireEvent.click(screen.getByLabelText(/Forward to next section/i));
  expect(useUIStore.getState().activeSection).toBe('connections');
});

it('hides the inline text label when collapsed (icon-only button)', () => {
  act(() => useUIStore.setState({ navRailCollapsed: true }));
  render(<NavRail connectionsCount={3} />);
  // The button is still reachable by its accessible name, but shows no inline
  // label text — only the icon (the description lives in the hover tooltip).
  const btn = screen.getByRole('button', { name: 'Connections' });
  expect(btn.textContent).not.toContain('Connections');
  const nav = screen.getByRole('navigation');
  expect(within(nav).getAllByRole('button').length).toBeGreaterThanOrEqual(3);
});
