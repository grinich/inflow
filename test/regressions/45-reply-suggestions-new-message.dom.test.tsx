// @vitest-environment jsdom
// Regression: the fetch effect's first guard (`fetchedRef.current ===
// conversationId`) short-circuited the refetch that the `messages.length`
// dependency (and the cache's messageCount field) was designed to trigger.
// When the counterpart sent a new message while the thread was open, the UI
// kept showing suggestions that replied to the PREVIOUS message until the
// user switched threads and back.
import '../dom-setup';

const predict = vi.fn();
vi.mock('@/hooks/useAISession', () => ({
  useAISession: () => ({ available: true, predict }),
}));
vi.mock('@/lib/ai-settings', () => ({
  getAISuggestionsEnabled: () => Promise.resolve(true),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useReplySuggestions } from '@/hooks/useReplySuggestions';
import { makeMessage } from '../fixtures/factories';

beforeEach(() => {
  predict.mockReset();
});

it('refetches suggestions when a new counterpart message arrives in the open thread', async () => {
  const conversationId = 'conv-rs-new-msg';
  const initial = [
    makeMessage({ conversationId, isFromMe: true, body: 'hi' }),
    makeMessage({ conversationId, isFromMe: false, senderName: 'Ada', body: 'how are you?' }),
  ];

  predict.mockResolvedValue('good|fine|great');
  const { result, rerender } = renderHook(
    ({ messages }) => useReplySuggestions({ conversationId, messages, participantNames: ['Ada'], body: '' }),
    { initialProps: { messages: initial } },
  );

  await waitFor(() => expect(result.current.suggestions).toEqual(['good', 'fine', 'great']));
  expect(predict).toHaveBeenCalledTimes(1);

  // Counterpart sends another message while the thread is open
  predict.mockResolvedValue('yes|no|maybe');
  const withNewMessage = [
    ...initial,
    makeMessage({ conversationId, isFromMe: false, senderName: 'Ada', body: 'lunch tomorrow?' }),
  ];
  rerender({ messages: withNewMessage });

  // Suggestions must be regenerated for the NEW last message
  await waitFor(() => expect(result.current.suggestions).toEqual(['yes', 'no', 'maybe']));
  expect(predict).toHaveBeenCalledTimes(2);
  // The second prompt must include the new message
  expect(String(predict.mock.calls[1][0])).toContain('lunch tomorrow?');
});
