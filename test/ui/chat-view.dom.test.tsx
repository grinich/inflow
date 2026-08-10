// @vitest-environment jsdom
// The AI Chat section: a history sidebar of past conversations + the active thread.
import '../dom-setup';

let chatState: any;
vi.mock('@/hooks/useConnectionChat', () => ({
  useConnectionChat: () => chatState,
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { ChatView } from '@/components/chat/ChatView';

const newChat = vi.fn();
const selectChat = vi.fn();
const deleteChat = vi.fn();

beforeEach(() => {
  newChat.mockReset();
  selectChat.mockReset();
  deleteChat.mockReset();
  chatState = {
    messages: [],
    loading: false,
    available: true,
    error: null,
    connectionCount: 3,
    chats: [
      { id: 'a', title: 'Who are my investors?', messages: [], createdAt: 1, updatedAt: 2 },
      { id: 'b', title: 'Fintech founders', messages: [], createdAt: 1, updatedAt: 1 },
    ],
    activeId: 'a',
    ask: vi.fn(),
    newChat,
    selectChat,
    deleteChat,
    clear: newChat,
  };
});

it('lists past conversations in the sidebar', () => {
  render(<ChatView />);
  expect(screen.getByText('Who are my investors?')).toBeInTheDocument();
  expect(screen.getByText('Fintech founders')).toBeInTheDocument();
});

it('starts a new chat', () => {
  render(<ChatView />);
  fireEvent.click(screen.getByRole('button', { name: /New chat/i }));
  expect(newChat).toHaveBeenCalled();
});

it('resumes a saved conversation on click', () => {
  render(<ChatView />);
  fireEvent.click(screen.getByText('Fintech founders'));
  expect(selectChat).toHaveBeenCalledWith('b');
});

it('deletes a conversation', () => {
  render(<ChatView />);
  fireEvent.click(screen.getByRole('button', { name: /Delete Fintech founders/i }));
  expect(deleteChat).toHaveBeenCalledWith('b');
});

it('shows an empty history state when there are no chats', () => {
  chatState.chats = [];
  render(<ChatView />);
  expect(screen.getByText(/No conversations yet/i)).toBeInTheDocument();
});
