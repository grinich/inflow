import { useEffect, useState } from 'react';
import {
  getGeminiApiKey,
  getAIProvider,
  getAnthropicApiKey,
  getAnthropicModel,
  type AIProvider,
  type AIModelTier,
} from '@/lib/ai-settings';
import { predictAnthropic } from '@/lib/anthropic-client';

const SYSTEM_PROMPT =
  'You are an autocomplete assistant. Given conversation history and a partial message, predict the next few words. Output ONLY the completion text. Keep it short (2-8 words). If unsure, output nothing.';

const GEMINI_STREAM_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:streamGenerateContent';

interface PredictOptions {
  signal?: AbortSignal;
  /** Read the full streamed response instead of bailing after the first chunk. */
  fullResponse?: boolean;
  /** Override maxOutputTokens (default: 20). */
  maxTokens?: number;
  /** Override the system prompt. */
  systemPrompt?: string;
  /** Override temperature (default: 0.3). Ignored by the Anthropic provider. */
  temperature?: number;
  /** Model tier — 'fast' (default) or 'quality'. Only Anthropic honors it. */
  tier?: AIModelTier;
}

interface AISession {
  available: boolean;
  predict: (prompt: string, options?: AbortSignal | PredictOptions) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Module-level singleton: resolve the provider + keys once and register a
// single chrome.storage listener for the whole app, rather than one per hook.
// Hooks subscribe for `available` updates; `predict` reads the cached config.
// ---------------------------------------------------------------------------

interface AIConfig {
  provider: AIProvider;
  geminiKey: string | null;
  anthropicKey: string | null;
  fastModel: string;
  qualityModel: string;
}

// Cache config in memory so we don't hit chrome.storage on every keystroke.
const config: AIConfig = {
  provider: 'gemini',
  geminiKey: null,
  anthropicKey: null,
  fastModel: 'claude-haiku-4-5',
  qualityModel: 'claude-sonnet-5',
};
let initialized = false;
const availabilitySubscribers = new Set<(available: boolean) => void>();

/** True when the *active* provider has a usable API key. */
function isAvailable(): boolean {
  return config.provider === 'anthropic' ? !!config.anthropicKey : !!config.geminiKey;
}

function notifyAvailability(): void {
  const available = isAvailable();
  for (const cb of availabilitySubscribers) cb(available);
}

/** Reload all AI settings into the in-memory cache, then notify subscribers. */
async function reloadConfig(): Promise<void> {
  const [provider, geminiKey, anthropicKey, fastModel, qualityModel] = await Promise.all([
    getAIProvider(),
    getGeminiApiKey(),
    getAnthropicApiKey(),
    getAnthropicModel('fast'),
    getAnthropicModel('quality'),
  ]);
  config.provider = provider;
  config.geminiKey = geminiKey;
  config.anthropicKey = anthropicKey;
  config.fastModel = fastModel;
  config.qualityModel = qualityModel;
  notifyAvailability();
}

/** Lazily resolve config and attach the single storage listener (idempotent). */
function ensureConfigSync(): void {
  if (initialized) return;
  initialized = true;

  reloadConfig();

  // Any AI-related storage change re-reads config; one listener serves every hook.
  const WATCHED = [
    'aiProvider',
    'geminiApiKey',
    'anthropicApiKey',
    'anthropicFastModel',
    'anthropicQualityModel',
  ];
  chrome?.storage?.local?.onChanged?.addListener?.(
    (changes: Record<string, chrome.storage.StorageChange>) => {
      if (WATCHED.some((k) => k in changes)) reloadConfig();
    },
  );
}

export function useAISession(): AISession {
  const [available, setAvailable] = useState(isAvailable());

  useEffect(() => {
    ensureConfigSync();
    const cb = (a: boolean) => setAvailable(a);
    availabilitySubscribers.add(cb);
    // Sync immediately in case config already resolved before this mount.
    cb(isAvailable());
    return () => {
      availabilitySubscribers.delete(cb);
    };
  }, []);

  return { available, predict };
}

/**
 * Run a prediction against the active provider. Module-scoped (reads only the
 * cached config), so its identity is stable across renders. Supports both the
 * legacy AbortSignal argument and the newer options object.
 */
async function predict(prompt: string, options?: AbortSignal | PredictOptions): Promise<string | null> {
  const isOpts = options && !(options instanceof AbortSignal);
  const signal = isOpts ? options.signal : (options as AbortSignal | undefined);
  const fullResponse = isOpts ? options.fullResponse ?? false : false;
  const maxTokens = isOpts ? options.maxTokens ?? 20 : 20;
  const systemPrompt = isOpts ? options.systemPrompt ?? SYSTEM_PROMPT : SYSTEM_PROMPT;
  const temperature = isOpts ? options.temperature ?? 0.3 : 0.3;
  const tier: AIModelTier = isOpts ? options.tier ?? 'fast' : 'fast';

  if (config.provider === 'anthropic') {
    if (!config.anthropicKey) return null;
    const model = tier === 'quality' ? config.qualityModel : config.fastModel;
    return predictAnthropic(prompt, config.anthropicKey, model, { signal, maxTokens, systemPrompt });
  }

  return predictGemini(prompt, { signal, fullResponse, maxTokens, systemPrompt, temperature });
}

/** Gemini streaming prediction (the original provider). */
async function predictGemini(
  prompt: string,
  opts: {
    signal?: AbortSignal;
    fullResponse: boolean;
    maxTokens: number;
    systemPrompt: string;
    temperature: number;
  },
): Promise<string | null> {
  try {
    const key = config.geminiKey;
    if (!key) return null;

    const res = await fetch(`${GEMINI_STREAM_URL}?alt=sse&key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: opts.systemPrompt }] },
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: opts.maxTokens, temperature: opts.temperature },
      }),
    });

    if (!res.ok || !res.body) return null;

    // Read SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const json = JSON.parse(line.slice(6));
            const part = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (part) text += part;
          } catch {
            // skip malformed SSE lines
          }
        }

        // For autocomplete we only need a few words — bail after first meaningful text
        if (!opts.fullResponse && text.trim().length > 0) {
          reader.cancel().catch(() => {});
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    return text.trim() || null;
  } catch (e: any) {
    if (e?.name === 'AbortError') return null;
    console.warn('[inflow] AI autocomplete error:', e);
    return null;
  }
}
