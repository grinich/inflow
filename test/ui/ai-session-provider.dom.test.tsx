// @vitest-environment jsdom
// useAISession routes predict() to the configured provider, and — for
// Anthropic — maps the requested tier to the configured model.
import '../dom-setup';

const predictAnthropic = vi.fn(async () => 'claude says hi');
vi.mock('@/lib/anthropic-client', () => ({
  predictAnthropic: (...args: any[]) => predictAnthropic(...args),
}));

vi.mock('@/lib/ai-settings', () => ({
  getGeminiApiKey: async () => null,
  getAIProvider: async () => 'anthropic',
  getAnthropicApiKey: async () => 'sk-ant-test',
  getAnthropicModel: async (tier: string) =>
    tier === 'quality' ? 'claude-opus-5' : 'claude-haiku-4-5',
}));

import { renderHook, waitFor } from '@testing-library/react';
import { useAISession } from '@/hooks/useAISession';

beforeEach(() => predictAnthropic.mockClear());

it('reports available when the Anthropic key is set', async () => {
  const { result } = renderHook(() => useAISession());
  await waitFor(() => expect(result.current.available).toBe(true));
});

it('routes the fast tier (default) to the fast model', async () => {
  const { result } = renderHook(() => useAISession());
  await waitFor(() => expect(result.current.available).toBe(true));

  const out = await result.current.predict('classify these', { maxTokens: 900 });
  expect(out).toBe('claude says hi');
  const [prompt, key, model] = predictAnthropic.mock.calls[0];
  expect(prompt).toBe('classify these');
  expect(key).toBe('sk-ant-test');
  expect(model).toBe('claude-haiku-4-5');
});

it('routes the quality tier to the quality model', async () => {
  const { result } = renderHook(() => useAISession());
  await waitFor(() => expect(result.current.available).toBe(true));

  await result.current.predict('write a message', { tier: 'quality', maxTokens: 200 });
  expect(predictAnthropic.mock.calls[0][2]).toBe('claude-opus-5');
});
