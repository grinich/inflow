// @vitest-environment jsdom
// The Insights → Suggestions tab: follow-ups (local), AI tag suggestions, and
// re-categorization candidates.
import '../dom-setup';

const { sendBridgeMessage } = vi.hoisted(() => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage }));

const predict = vi.fn();
let aiAvailable = true;
vi.mock('@/hooks/useAISession', () => ({ useAISession: () => ({ available: aiAvailable, predict }) }));

let followUps: any[] = [];
vi.mock('@/hooks/useFollowUps', () => ({ useFollowUps: () => ({ followUps, loading: false }) }));

let suggestState: any;
vi.mock('@/hooks/useConnectionSuggestions', () => ({
  useConnectionSuggestions: () => suggestState,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FollowUpsSection, AISuggestionsSection } from '@/components/insights/SuggestionsTab';
import { useUIStore } from '@/store/ui-store';

const refresh = vi.fn();
const addTag = vi.fn();
const applyRecat = vi.fn();
const dismissRecat = vi.fn();

function followUp(over: any = {}) {
  return {
    connection: {
      profileUrn: 'a',
      fullName: 'Becca Gilmore',
      publicId: 'becca',
      pictureUrl: '',
      roleCategory: 'Investor',
      ...over.connection,
    },
    lastContactAt: null,
    days: 32,
    reason: 'never',
    ...over,
  };
}

beforeEach(() => {
  followUps = [];
  aiAvailable = true;
  predict.mockReset();
  sendBridgeMessage.mockReset().mockResolvedValue({ success: true, data: { conversationId: '2-x' } });
  refresh.mockReset();
  addTag.mockReset();
  applyRecat.mockReset();
  dismissRecat.mockReset();
  suggestState = {
    available: true,
    loading: false,
    hasRun: false,
    error: null,
    suggestedTags: [],
    recatCandidates: [],
    refresh,
    addTag,
    applyRecat,
    dismissRecat,
  };
});

it('lists follow-ups and the Connection action opens the connection', () => {
  followUps = [followUp()];
  render(<FollowUpsSection />);
  expect(screen.getByText('Becca Gilmore')).toBeInTheDocument();
  expect(screen.getByText(/never messaged/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Connection' }));
  expect(useUIStore.getState().activeSection).toBe('connections');
  expect(useUIStore.getState().selectedConnectionUrn).toBe('a');
});

it('opens LinkedIn from a follow-up', () => {
  followUps = [followUp()];
  const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  render(<FollowUpsSection />);
  fireEvent.click(screen.getByRole('button', { name: 'LinkedIn' }));
  expect(openSpy).toHaveBeenCalledWith('https://www.linkedin.com/in/becca', '_blank', 'noopener,noreferrer');
  openSpy.mockRestore();
});

it('composes and sends a follow-up message inline', async () => {
  followUps = [followUp()];
  render(<FollowUpsSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Message' }));
  const box = screen.getByPlaceholderText(/write a message to becca gilmore/i);
  fireEvent.change(box, { target: { value: 'Hey Becca!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() =>
    expect(sendBridgeMessage).toHaveBeenCalledWith({
      type: 'CREATE_CONVERSATION',
      recipientUrns: ['a'],
      body: 'Hey Becca!',
    }),
  );
});

it('drafts a follow-up message with AI', async () => {
  predict.mockResolvedValue('Hey Becca, would love to reconnect!');
  followUps = [followUp()];
  render(<FollowUpsSection />);
  fireEvent.click(screen.getByRole('button', { name: 'Message' }));
  fireEvent.click(screen.getByRole('button', { name: /draft with ai/i }));
  const box = await screen.findByDisplayValue('Hey Becca, would love to reconnect!');
  expect(box).toBeInTheDocument();
  expect(predict).toHaveBeenCalled();
});

it('gates AI suggestions behind setup when unavailable', () => {
  suggestState.available = false;
  render(<AISuggestionsSection />);
  fireEvent.click(screen.getByRole('button', { name: /set up ai/i }));
  expect(useUIStore.getState().settingsOpen).toBe(true);
});

it('runs the AI suggestion refresh', () => {
  render(<AISuggestionsSection />);
  fireEvent.click(screen.getByRole('button', { name: /get suggestions/i }));
  expect(refresh).toHaveBeenCalled();
});

it('adds a suggested tag', () => {
  suggestState.hasRun = true;
  suggestState.suggestedTags = ['Design leaders'];
  render(<AISuggestionsSection />);
  fireEvent.click(screen.getByRole('button', { name: /\+ Design leaders/ }));
  expect(addTag).toHaveBeenCalledWith('Design leaders');
});

it('applies and dismisses re-categorization candidates', () => {
  suggestState.hasRun = true;
  suggestState.recatCandidates = [
    { profileUrn: 'x', fullName: 'J. Smith', headline: 'GP at Foo', from: 'Other', to: 'Investor' },
  ];
  render(<AISuggestionsSection />);
  expect(screen.getByText(/Other → /)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(applyRecat).toHaveBeenCalledWith(expect.objectContaining({ profileUrn: 'x' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(dismissRecat).toHaveBeenCalledWith('x');
});
