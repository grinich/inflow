// @vitest-environment jsdom
/**
 * Regression: two useAutocomplete reliability bugs.
 *
 * 1. DEBOUNCE_MS was 80 — shorter than nearly every typist's inter-key gap
 *    (~300ms), so the "debounce" coalesced nothing: every keystroke fired a
 *    real Gemini streaming request that the next keystroke aborted. Typing a
 *    60-char reply issued ~55 requests, ~54 of them aborted mid-stream.
 * 2. Switching conversations neither aborted the in-flight prediction nor
 *    re-keyed the effect (deps omitted conversationId) — if the new
 *    conversation's draft happened to equal the old one's, a suggestion
 *    computed from the PREVIOUS conversation's messages landed in the new one.
 */
import '../dom-setup';

import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { makeMessage } from '../fixtures/factories';

const { mockPredict } = vi.hoisted(() => ({ mockPredict: vi.fn() }));

vi.mock('@/hooks/useAISession', () => ({
  useAISession: () => ({ available: true, predict: mockPredict }),
}));

vi.mock('@/lib/feature-flags', () => ({ ENABLE_AI_AUTOCOMPLETE: true }));

import { useAutocomplete } from '@/hooks/useAutocomplete';

const capturedSignals: AbortSignal[] = [];

beforeEach(() => {
  capturedSignals.length = 0;
  mockPredict.mockReset().mockImplementation((_prompt: string, signal: AbortSignal) => {
    capturedSignals.push(signal);
    return new Promise(() => {}); // stays in flight
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderAutocomplete(initial: { body: string; conversationId: string }) {
  const textareaRef = createRef<HTMLTextAreaElement>();
  return renderHook(
    (props: { body: string; conversationId: string }) =>
      useAutocomplete({
        body: props.body,
        cursorAtEnd: true,
        emojiOpen: false,
        messages: [makeMessage({ conversationId: props.conversationId, isFromMe: false, body: 'hey!' })],
        participantNames: ['Other'],
        conversationId: props.conversationId,
        textareaRef,
        setBody: () => {},
      }),
    { initialProps: initial },
  );
}

it('coalesces a normal typing cadence into a single prediction request', () => {
  const { rerender } = renderAutocomplete({ body: 'hello ther', conversationId: 'c-1' });

  // Type 4 more characters at a 150ms cadence — a normal fast typist.
  let body = 'hello ther';
  for (const ch of 'e my') {
    vi.advanceTimersByTime(150);
    body += ch;
    rerender({ body, conversationId: 'c-1' });
  }
  // Pause: the (single) debounced request fires.
  vi.advanceTimersByTime(1000);

  expect(mockPredict).toHaveBeenCalledTimes(1);
});

it('aborts the in-flight prediction when the conversation changes with an identical body', () => {
  const { rerender } = renderAutocomplete({ body: 'same draft text', conversationId: 'c-1' });
  vi.advanceTimersByTime(1000);
  expect(mockPredict).toHaveBeenCalledTimes(1);
  expect(capturedSignals[0].aborted).toBe(false);

  // Switch threads; the restored draft is byte-identical.
  rerender({ body: 'same draft text', conversationId: 'c-2' });

  expect(capturedSignals[0].aborted).toBe(true);
});
