// @vitest-environment jsdom
// Behavioral coverage for useAutocomplete: debounced prediction, preconditions
// (length / cursor-at-end / emoji-open), the leading-space insertion rule, accept
// (append + skip-next-prediction), and dismiss.
import '../dom-setup';

const predict = vi.fn();
vi.mock('@/hooks/useAISession', () => ({
  useAISession: () => ({ available: true, predict }),
}));

import { renderHook, act, waitFor } from '@testing-library/react';
import { useAutocomplete } from '@/hooks/useAutocomplete';
import { makeMessage } from '../fixtures/factories';

const textareaRef = { current: null } as any;

function opts(over: any = {}) {
  return {
    body: 'hello',
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

beforeEach(() => predict.mockReset());

it('predicts after debounce and prepends a space when needed', async () => {
  predict.mockResolvedValue('world');
  const { result } = renderHook((p: any) => useAutocomplete(p), { initialProps: opts() });
  await waitFor(() => expect(result.current.suggestion).toBe(' world'));
  expect(result.current.isOpen).toBe(true);
});

it('does not add a space when the body already ends with one', async () => {
  predict.mockResolvedValue('world');
  const { result } = renderHook((p: any) => useAutocomplete(p), { initialProps: opts({ body: 'hello ' }) });
  await waitFor(() => expect(result.current.suggestion).toBe('world'));
});

it('skips prediction below MIN_BODY_LENGTH', async () => {
  const { result } = renderHook((p: any) => useAutocomplete(p), { initialProps: opts({ body: 'hi' }) });
  await new Promise((r) => setTimeout(r, 150));
  expect(predict).not.toHaveBeenCalled();
  expect(result.current.suggestion).toBeNull();
});

it('skips prediction when the cursor is not at the end', async () => {
  renderHook((p: any) => useAutocomplete(p), { initialProps: opts({ cursorAtEnd: false }) });
  await new Promise((r) => setTimeout(r, 150));
  expect(predict).not.toHaveBeenCalled();
});

it('skips prediction while the emoji picker is open', async () => {
  renderHook((p: any) => useAutocomplete(p), { initialProps: opts({ emojiOpen: true }) });
  await new Promise((r) => setTimeout(r, 150));
  expect(predict).not.toHaveBeenCalled();
});

it('accept() appends the suggestion, clears it, and skips the next prediction', async () => {
  predict.mockResolvedValue('world');
  const setBody = vi.fn();
  const { result, rerender } = renderHook((p: any) => useAutocomplete(p), {
    initialProps: opts({ body: 'hello', setBody }),
  });
  await waitFor(() => expect(result.current.suggestion).toBe(' world'));

  act(() => result.current.accept());
  expect(setBody).toHaveBeenCalledWith('hello world');
  expect(result.current.suggestion).toBeNull();
  expect(result.current.isOpen).toBe(false);

  // The body changes to the accepted text — this must NOT trigger a new prediction.
  predict.mockClear();
  rerender(opts({ body: 'hello world', setBody }));
  await new Promise((r) => setTimeout(r, 150));
  expect(predict).not.toHaveBeenCalled();
});

it('dismiss() clears the current suggestion', async () => {
  predict.mockResolvedValue('world');
  const { result } = renderHook((p: any) => useAutocomplete(p), { initialProps: opts() });
  await waitFor(() => expect(result.current.suggestion).toBe(' world'));
  act(() => result.current.dismiss());
  expect(result.current.suggestion).toBeNull();
});
