// @vitest-environment jsdom
// The interests editor lists the user's interest tags, adds/removes them, and
// triggers a re-categorization pass.
import '../dom-setup';

let mockInterests: string[] = [];
const setInterests = vi.fn(async (next: string[]) => {
  mockInterests = next;
});
vi.mock('@/hooks/useConnectionInterests', () => ({
  useConnectionInterests: () => [mockInterests, setInterests] as const,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InterestsEditor } from '@/components/connections/InterestsEditor';

beforeEach(() => {
  mockInterests = ['Investors'];
  setInterests.mockClear();
});

it('renders existing interest tags', () => {
  render(<InterestsEditor aiAvailable connectionCount={10} onRecategorize={vi.fn()} />);
  expect(screen.getByText('★ Investors')).toBeInTheDocument();
});

it('adds a new tag on Enter', () => {
  render(<InterestsEditor aiAvailable connectionCount={10} onRecategorize={vi.fn()} />);
  const input = screen.getByPlaceholderText(/Add an interest/i);
  fireEvent.change(input, { target: { value: 'Advisors' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(setInterests).toHaveBeenCalledWith(['Investors', 'Advisors']);
});

it('does not add a duplicate tag (case-insensitive)', () => {
  render(<InterestsEditor aiAvailable connectionCount={10} onRecategorize={vi.fn()} />);
  const input = screen.getByPlaceholderText(/Add an interest/i);
  fireEvent.change(input, { target: { value: 'investors' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(setInterests).not.toHaveBeenCalled();
});

it('removes a tag', () => {
  render(<InterestsEditor aiAvailable connectionCount={10} onRecategorize={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Investors' }));
  expect(setInterests).toHaveBeenCalledWith([]);
});

it('confirms cost before re-categorizing all', async () => {
  const onRecategorize = vi.fn().mockResolvedValue(undefined);
  render(<InterestsEditor aiAvailable connectionCount={980} onRecategorize={onRecategorize} />);
  // First click asks for confirmation with the cost (count), doesn't run yet.
  fireEvent.click(screen.getByRole('button', { name: /Re-categorize all/i }));
  expect(onRecategorize).not.toHaveBeenCalled();
  expect(screen.getByText(/Re-scan all 980\?/i)).toBeInTheDocument();
  // Confirming runs it.
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(onRecategorize).toHaveBeenCalled());
});

it('disables re-categorize when AI is unavailable', () => {
  render(<InterestsEditor aiAvailable={false} connectionCount={10} onRecategorize={vi.fn()} />);
  expect(screen.getByRole('button', { name: /Re-categorize all/i })).toBeDisabled();
});
