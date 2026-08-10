import { readLocal } from './storage';

const STORAGE_KEY = 'geminiApiKey';
const SUGGESTIONS_KEY = 'aiSuggestionsEnabled';
const INTERESTS_KEY = 'connectionInterests';
const CATEGORIZE_MODE_KEY = 'categorizeMode';
const PROVIDER_KEY = 'aiProvider';
const ANTHROPIC_KEY = 'anthropicApiKey';
const ANTHROPIC_FAST_MODEL_KEY = 'anthropicFastModel';
const ANTHROPIC_QUALITY_MODEL_KEY = 'anthropicQualityModel';

/** Default interest tags the connection classifier matches against. */
export const DEFAULT_CONNECTION_INTERESTS = ['Investors'];

/**
 * Which AI provider powers inference.
 *  - 'gemini'    — Google Gemini (a single model for everything)
 *  - 'anthropic' — Claude, with a two-tier model ladder (see below)
 */
export type AIProvider = 'gemini' | 'anthropic';

/**
 * A "tier" lets us route cheap/bulk work to a small model and reserve a stronger
 * one for writing. Callers pass `tier` on predict; only Anthropic honors it
 * (Gemini uses one model regardless).
 *  - 'fast'    — categorization, summaries, autocomplete (default)
 *  - 'quality' — drafting messages, the insights chat
 */
export type AIModelTier = 'fast' | 'quality';

export interface AnthropicModelOption {
  id: string;
  label: string;
  /** Short cost/quality hint shown in the model picker. */
  blurb: string;
}

/** Claude models offered in Settings, cheapest → most capable. */
export const ANTHROPIC_MODELS: AnthropicModelOption[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', blurb: 'Fastest & cheapest — best for bulk tagging' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', blurb: 'Balanced quality and cost' },
  { id: 'claude-opus-5', label: 'Opus 5', blurb: 'Most capable — best writing' },
];

const ANTHROPIC_MODEL_IDS = new Set(ANTHROPIC_MODELS.map((m) => m.id));

/** Cheap tier default: Haiku for bulk categorization/summaries. */
export const DEFAULT_ANTHROPIC_FAST_MODEL = 'claude-haiku-4-5';
/** Quality tier default: Sonnet for drafting and the insights chat. */
export const DEFAULT_ANTHROPIC_QUALITY_MODEL = 'claude-sonnet-5';

export async function getAIProvider(): Promise<AIProvider> {
  return (await readLocal<AIProvider>(PROVIDER_KEY)) === 'anthropic' ? 'anthropic' : 'gemini';
}

export async function setAIProvider(provider: AIProvider): Promise<void> {
  await chrome.storage.local.set({ [PROVIDER_KEY]: provider });
}

export async function getAnthropicApiKey(): Promise<string | null> {
  return (await readLocal<string>(ANTHROPIC_KEY)) || null;
}

export async function setAnthropicApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [ANTHROPIC_KEY]: key });
}

export async function clearAnthropicApiKey(): Promise<void> {
  await chrome.storage.local.remove(ANTHROPIC_KEY);
}

/** Resolve the configured model for a tier, validating against the known set. */
export async function getAnthropicModel(tier: AIModelTier): Promise<string> {
  const stored = await readLocal<string>(
    tier === 'quality' ? ANTHROPIC_QUALITY_MODEL_KEY : ANTHROPIC_FAST_MODEL_KEY,
  );
  if (stored && ANTHROPIC_MODEL_IDS.has(stored)) return stored;
  return tier === 'quality' ? DEFAULT_ANTHROPIC_QUALITY_MODEL : DEFAULT_ANTHROPIC_FAST_MODEL;
}

export async function setAnthropicModel(tier: AIModelTier, modelId: string): Promise<void> {
  if (!ANTHROPIC_MODEL_IDS.has(modelId)) return;
  await chrome.storage.local.set({
    [tier === 'quality' ? ANTHROPIC_QUALITY_MODEL_KEY : ANTHROPIC_FAST_MODEL_KEY]: modelId,
  });
}

/**
 * How connections get categorized:
 *  - 'auto'   — classify new connections automatically after each sync (default)
 *  - 'manual' — only when the user asks ("Categorize now" / per-connection refresh)
 */
export type CategorizeMode = 'auto' | 'manual';

export async function getCategorizeMode(): Promise<CategorizeMode> {
  return (await readLocal<CategorizeMode>(CATEGORIZE_MODE_KEY)) === 'manual' ? 'manual' : 'auto';
}

export async function setCategorizeMode(mode: CategorizeMode): Promise<void> {
  await chrome.storage.local.set({ [CATEGORIZE_MODE_KEY]: mode });
}

export async function getGeminiApiKey(): Promise<string | null> {
  return (await readLocal<string>(STORAGE_KEY)) || null;
}

export async function setGeminiApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: key });
}

export async function clearGeminiApiKey(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

export async function getAISuggestionsEnabled(): Promise<boolean> {
  // Default to true if not set (and on read error, readLocal yields undefined).
  return (await readLocal<boolean>(SUGGESTIONS_KEY)) !== false;
}

export async function setAISuggestionsEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [SUGGESTIONS_KEY]: enabled });
}

/**
 * The interest tags the AI matches each connection against (e.g. "Investors").
 * Falls back to {@link DEFAULT_CONNECTION_INTERESTS} when unset.
 */
export async function getConnectionInterests(): Promise<string[]> {
  const stored = await readLocal<string[]>(INTERESTS_KEY);
  if (!Array.isArray(stored)) return [...DEFAULT_CONNECTION_INTERESTS];
  // Drop blanks/dupes so a stray empty tag can't reach the prompt.
  return stored.map((t) => t.trim()).filter((t, i, a) => t && a.indexOf(t) === i);
}

export async function setConnectionInterests(interests: string[]): Promise<void> {
  const clean = interests.map((t) => t.trim()).filter((t, i, a) => t && a.indexOf(t) === i);
  await chrome.storage.local.set({ [INTERESTS_KEY]: clean });
}
