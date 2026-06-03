// @vitest-environment jsdom
// Behavioral coverage for useReplySuggestions: fetch+parse, skip conditions,
// clear-on-typing, re-serve after the draft is cleared (the fetchedRef reset the
// audit flagged), and clear()/dismiss.
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

let convSeq = 0;
function freshConvId() {
  return `conv-rs-${++convSeq}`; // unique per test to avoid the module-level cache bleeding
}

beforeEach(() => {
  predict.mockReset();
});

function inbound(convId: string) {
  return [
    makeMessage({ conversationId: convId, isFromMe: true, body: 'hi' }),
    makeMessage({ conversationId: convId, isFromMe: false, senderName: 'Ada', body: 'how are you?' }),
  ];
}

it('fetches, parses pipe-separated output, and caps at 3 suggestions', async () => {
  predict.mockResolvedValue('one | two | three | four');
  const conversationId = freshConvId();
  const { result } = renderHook(() =>
    useReplySuggestions({ conversationId, messages: inbound(conversationId), participantNames: ['Ada'], body: '' }),
  );
  await waitFor(() => expect(result.current.suggestions).toEqual(['one', 'two', 'three']));
});

it('does not fetch when the last message is from us', async () => {
  const conversationId = freshConvId();
  renderHook(() =>
    useReplySuggestions({
      conversationId,
      messages: [makeMessage({ conversationId, isFromMe: false, body: 'hi' }), makeMessage({ conversationId, isFromMe: true, body: 'mine' })],
      participantNames: ['Ada'],
      body: '',
    }),
  );
  await new Promise((r) => setTimeout(r, 50));
  expect(predict).not.toHaveBeenCalled();
});

it('does not fetch with no messages', async () => {
  const conversationId = freshConvId();
  renderHook(() => useReplySuggestions({ conversationId, messages: [], participantNames: [], body: '' }));
  await new Promise((r) => setTimeout(r, 50));
  expect(predict).not.toHaveBeenCalled();
});

it('clears suggestions while typing, then re-serves them from cache when the draft is cleared', async () => {
  predict.mockResolvedValue('a|b|c');
  const conversationId = freshConvId();
  const msgs = inbound(conversationId);
  const { result, rerender } = renderHook(
    ({ body }) => useReplySuggestions({ conversationId, messages: msgs, participantNames: ['Ada'], body }),
    { initialProps: { body: '' } },
  );

  await waitFor(() => expect(result.current.suggestions).toEqual(['a', 'b', 'c']));
  expect(predict).toHaveBeenCalledTimes(1);

  // User types — suggestions hide.
  rerender({ body: 'thinking...' });
  await waitFor(() => expect(result.current.suggestions).toEqual([]));

  // Draft cleared — suggestions come back from cache without a second predict call.
  rerender({ body: '' });
  await waitFor(() => expect(result.current.suggestions).toEqual(['a', 'b', 'c']));
  expect(predict).toHaveBeenCalledTimes(1);
});

it('clear() dismisses suggestions and prevents a refetch for that conversation', async () => {
  predict.mockResolvedValue('a|b|c');
  const conversationId = freshConvId();
  const msgs = inbound(conversationId);
  const { result, rerender } = renderHook(
    ({ body }) => useReplySuggestions({ conversationId, messages: msgs, participantNames: ['Ada'], body }),
    { initialProps: { body: '' } },
  );
  await waitFor(() => expect(result.current.suggestions).toEqual(['a', 'b', 'c']));

  result.current.clear();
  await waitFor(() => expect(result.current.suggestions).toEqual([]));

  // Even toggling the draft shouldn't bring them back (dismissed for this conv).
  rerender({ body: 'x' });
  rerender({ body: '' });
  await new Promise((r) => setTimeout(r, 50));
  expect(result.current.suggestions).toEqual([]);
});
