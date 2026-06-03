// @vitest-environment jsdom
// useAISession previously registered a chrome.storage.local.onChanged listener
// and re-resolved the Gemini key inside every hook instance. It now uses a
// module-level singleton: one listener for the whole app, key resolved once, and
// a stable module-scoped predict() identity. These tests lock that in.
import '../dom-setup';

const getGeminiApiKey = vi.fn();
vi.mock('@/lib/ai-settings', () => ({
  getGeminiApiKey: () => getGeminiApiKey(),
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useAISession } from '@/hooks/useAISession';

beforeEach(() => {
  getGeminiApiKey.mockReset();
  getGeminiApiKey.mockResolvedValue('test-key');
  (chrome.storage.local.onChanged.addListener as any).mockClear?.();
});

it('registers a single storage listener no matter how many hook instances mount', async () => {
  const a = renderHook(() => useAISession());
  const b = renderHook(() => useAISession());
  const c = renderHook(() => useAISession());

  await waitFor(() => expect(a.result.current.available).toBe(true));

  // One listener total across all instances (the singleton init is idempotent).
  expect(chrome.storage.local.onChanged.addListener).toHaveBeenCalledTimes(1);
  expect(b.result.current.available).toBe(true);
  expect(c.result.current.available).toBe(true);
});

it('exposes a stable predict identity across instances and renders', () => {
  const a = renderHook(() => useAISession());
  const b = renderHook(() => useAISession());
  const firstPredict = a.result.current.predict;
  a.rerender();
  expect(a.result.current.predict).toBe(firstPredict);
  expect(b.result.current.predict).toBe(firstPredict);
});
