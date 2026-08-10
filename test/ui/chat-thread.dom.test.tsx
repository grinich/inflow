// @vitest-environment jsdom
// The Flow chat thread: unencapsulated (ChatGPT-style) answers, copyable, with
// a subtle bubble for the user's own turns.
import '../dom-setup';

let chatState: any;
vi.mock('@/hooks/useConnectionChat', () => ({
  useConnectionChat: () => chatState,
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatThread } from '@/components/insights/ChatThread';

const ask = vi.fn();

beforeEach(() => {
  ask.mockReset();
  chatState = {
    messages: [],
    loading: false,
    available: true,
    error: null,
    connectionCount: 5,
    ask,
    newChat: vi.fn(),
    selectChat: vi.fn(),
    deleteChat: vi.fn(),
    chats: [],
    activeId: null,
    clear: vi.fn(),
  };
});

it('uses the Flow naming in the composer placeholder', () => {
  render(<ChatThread />);
  expect(screen.getByPlaceholderText(/Ask Flow/i)).toBeInTheDocument();
});

it('renders an assistant answer as plain text (no bubble) with a Copy button', () => {
  chatState.messages = [
    { role: 'user', content: 'Who are my investors?' },
    { role: 'assistant', content: 'Ada and Alan.' },
  ];
  render(<ChatThread />);
  expect(screen.getByText('Ada and Alan.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /copy answer/i })).toBeInTheDocument();
});

it('copies the answer to the clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  chatState.messages = [{ role: 'assistant', content: 'The answer text.' }];
  render(<ChatThread />);
  fireEvent.click(screen.getByRole('button', { name: /copy answer/i }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('The answer text.'));
});
