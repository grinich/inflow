/**
 * Provider + model-tier settings: defaults, persistence, and model validation.
 */
import { resetChromeMock } from '../mocks/chrome';
import {
  getAIProvider,
  setAIProvider,
  getAnthropicApiKey,
  setAnthropicApiKey,
  clearAnthropicApiKey,
  getAnthropicModel,
  setAnthropicModel,
  DEFAULT_ANTHROPIC_FAST_MODEL,
  DEFAULT_ANTHROPIC_QUALITY_MODEL,
  ANTHROPIC_MODELS,
} from '@/lib/ai-settings';

beforeEach(() => {
  resetChromeMock();
});

describe('AI provider setting', () => {
  it('defaults to gemini and round-trips anthropic', async () => {
    expect(await getAIProvider()).toBe('gemini');
    await setAIProvider('anthropic');
    expect(await getAIProvider()).toBe('anthropic');
  });

  it('falls back to gemini for an unknown stored value', async () => {
    await chrome.storage.local.set({ aiProvider: 'openai' as any });
    expect(await getAIProvider()).toBe('gemini');
  });
});

describe('Anthropic API key', () => {
  it('round-trips and clears', async () => {
    expect(await getAnthropicApiKey()).toBeNull();
    await setAnthropicApiKey('sk-ant-123');
    expect(await getAnthropicApiKey()).toBe('sk-ant-123');
    await clearAnthropicApiKey();
    expect(await getAnthropicApiKey()).toBeNull();
  });
});

describe('Anthropic model tiers', () => {
  it('defaults fast → Haiku and quality → Sonnet', async () => {
    expect(await getAnthropicModel('fast')).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);
    expect(await getAnthropicModel('quality')).toBe(DEFAULT_ANTHROPIC_QUALITY_MODEL);
    expect(DEFAULT_ANTHROPIC_FAST_MODEL).toBe('claude-haiku-4-5');
    expect(DEFAULT_ANTHROPIC_QUALITY_MODEL).toBe('claude-sonnet-5');
  });

  it('persists a chosen model per tier independently', async () => {
    await setAnthropicModel('fast', 'claude-sonnet-5');
    await setAnthropicModel('quality', 'claude-opus-5');
    expect(await getAnthropicModel('fast')).toBe('claude-sonnet-5');
    expect(await getAnthropicModel('quality')).toBe('claude-opus-5');
  });

  it('ignores an unknown model id on write and falls back on read', async () => {
    await setAnthropicModel('fast', 'gpt-5' as any);
    expect(await getAnthropicModel('fast')).toBe(DEFAULT_ANTHROPIC_FAST_MODEL);

    await chrome.storage.local.set({ anthropicQualityModel: 'bogus-model' });
    expect(await getAnthropicModel('quality')).toBe(DEFAULT_ANTHROPIC_QUALITY_MODEL);
  });

  it('offers Haiku, Sonnet, and Opus in the picker, cheapest first', () => {
    expect(ANTHROPIC_MODELS.map((m) => m.id)).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-5',
      'claude-opus-5',
    ]);
  });
});
