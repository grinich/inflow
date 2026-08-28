// @vitest-environment jsdom
/**
 * Regression: typing during an in-flight suggestions fetch stranded
 * isLoading at true — a perpetual spinner row.
 *
 * `body` is in the fetch effect's deps, so the first keystroke aborts the
 * controller via the effect cleanup. Both .then and .catch deliberately skip
 * setIsLoading(false) when aborted, and nothing else cleared the flag. If
 * the refetch after clearing the draft is blocked (e.g. the user SENT the
 * reply, so the last message is now their own), ComposeBox rendered the
 * suggestions spinner forever (it shows whenever body is empty and isLoading
 * is true).
 *
 * Fix: the fetch effect's cleanup clears isLoading alongside the abort.
 */
import '../dom-setup';

import { renderHook, waitFor } from '@testing-library/react';
import { makeMessage } from '../fixtures/factories';

const { mockPredict } = vi.hoisted(() => ({ mockPredict: vi.fn() }));

vi.mock('@/hooks/useAISession', () => ({
  useAISession: () => ({ available: true, predict: mockPredict }),
}));

vi.mock('@/lib/feature-flags', () => ({ ENABLE_AI_AUTOCOMPLETE: true }));
vi.mock('@/lib/ai-settings', () => ({ getAISuggestionsEnabled: vi.fn().mockResolvedValue(true) }));

import { useReplySuggestions } from '@/hooks/useReplySuggestions';

beforeEach(() => {
  mockPredict.mockReset().mockImplementation(() => new Promise(() => {})); // never resolves
});

it('clears the spinner when typing aborts the fetch and the refetch is blocked', async () => {
  const inbound = makeMessage({ id: 'm-in', conversationId: 'c-120', isFromMe: false, body: 'question?' });
  const outbound = makeMessage({ id: 'm-out', conversationId: 'c-120', isFromMe: true, body: 'my reply' });

  const { result, rerender } = renderHook(
    (props: { messages: any[]; body: string }) =>
      useReplySuggestions({
        conversationId: 'c-120',
        messages: props.messages,
        participantNames: ['Other'],
        body: props.body,
      }),
    { initialProps: { messages: [inbound], body: '' } },
  );

  await waitFor(() => expect(result.current.isLoading).toBe(true));

  // User types — the dep change aborts the in-flight fetch.
  rerender({ messages: [inbound], body: 'typing…' });
  // They send the reply and the draft clears; the refetch is blocked because
  // the last message is now their own.
  rerender({ messages: [inbound, outbound], body: '' });

  await waitFor(() => expect(result.current.isLoading).toBe(false));
});
