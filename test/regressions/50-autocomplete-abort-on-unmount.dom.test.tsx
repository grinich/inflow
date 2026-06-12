// @vitest-environment jsdom
// Regression: the prediction effect's cleanup only cleared the debounce timer;
// the in-flight AbortController was aborted only at the START of the next
// effect run. When the compose box unmounted mid-prediction (user closes the
// thread right after typing) the streaming fetch ran to completion and then
// called setState on the unmounted component — a wasted API call per
// occurrence plus a state update after unmount.
import '../dom-setup';

const predict = vi.fn();
vi.mock('@/hooks/useAISession', () => ({
  useAISession: () => ({ available: true, predict }),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useAutocomplete } from '@/hooks/useAutocomplete';
import { makeMessage } from '../fixtures/factories';

const textareaRef = { current: null } as any;

function opts(over: any = {}) {
  return {
    body: 'hello there',
    cursorAtEnd: true,
    emojiOpen: false,
    messages: [makeMessage({ isFromMe: false, body: 'hey' })],
    participantNames: ['Ada'],
    conversationId: 'c1',
    textareaRef,
    setBody: vi.fn(),
    ...over,
  };
}

// Braces matter: mockReset() returns the mock, and a beforeEach return value
// is treated as a teardown callback (which would call predict() and await its
// never-resolving promise).
beforeEach(() => {
  predict.mockReset();
});

it('aborts the in-flight prediction when the hook unmounts', async () => {
  let capturedSignal: AbortSignal | undefined;
  predict.mockImplementation((_prompt: string, signal: AbortSignal) => {
    capturedSignal = signal;
    return new Promise(() => {}); // never resolves — stays in flight
  });

  const { unmount } = renderHook((p: any) => useAutocomplete(p), { initialProps: opts() });

  // Wait past the debounce until the prediction is in flight
  await waitFor(() => expect(predict).toHaveBeenCalledTimes(1));
  expect(capturedSignal!.aborted).toBe(false);

  unmount();

  expect(capturedSignal!.aborted).toBe(true);
});
