import { useEffect, useState } from 'react';
import { getGeminiApiKey } from '@/lib/ai-settings';

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
  /** Override temperature (default: 0.3). */
  temperature?: number;
}

interface AISession {
  available: boolean;
  predict: (prompt: string, options?: AbortSignal | PredictOptions) => Promise<string | null>;
}

// Cache the key in memory so we don't hit chrome.storage on every keystroke
let cachedKey: string | null = null;

export function useAISession(): AISession {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    getGeminiApiKey().then((key) => {
      cachedKey = key;
      setAvailable(!!key);
    });

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('geminiApiKey' in changes) {
        cachedKey = changes.geminiApiKey.newValue ?? null;
        setAvailable(!!cachedKey);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  const predict = async (prompt: string, options?: AbortSignal | PredictOptions): Promise<string | null> => {
    // Support both old (AbortSignal) and new (options object) signatures
    const isOpts = options && !(options instanceof AbortSignal);
    const signal = isOpts ? options.signal : (options as AbortSignal | undefined);
    const fullResponse = isOpts ? options.fullResponse ?? false : false;
    const maxTokens = isOpts ? options.maxTokens ?? 20 : 20;
    const systemPrompt = isOpts ? options.systemPrompt ?? SYSTEM_PROMPT : SYSTEM_PROMPT;
    const temperature = isOpts ? options.temperature ?? 0.3 : 0.3;

    try {
      const key = cachedKey;
      if (!key) return null;

      const res = await fetch(`${GEMINI_STREAM_URL}?alt=sse&key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature },
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
          if (!fullResponse && text.trim().length > 0) {
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
  };

  return { available, predict };
}
