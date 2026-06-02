import { useState, useEffect, useRef, useCallback } from 'react';
import { useAISession } from './useAISession';
import { buildReplySuggestionsPrompt, REPLY_SUGGESTIONS_SYSTEM_PROMPT } from '@/lib/reply-suggestions-prompt';
import { ENABLE_AI_AUTOCOMPLETE } from '@/lib/feature-flags';
import { getAISuggestionsEnabled } from '@/lib/ai-settings';
import type { Message } from '@/types/message';

interface UseReplySuggestionsOptions {
  conversationId: string;
  messages: Message[];
  participantNames: string[];
  body: string;
}

interface UseReplySuggestionsResult {
  suggestions: string[];
  isLoading: boolean;
  clear: () => void;
}

/** Module-level cache: conversationId → { suggestions, messageCount } */
const cache = new Map<string, { suggestions: string[]; messageCount: number }>();
const CACHE_MAX = 50;

/** Bounded insert — evicts the oldest entry so the cache can't grow unbounded. */
function cacheSet(id: string, value: { suggestions: string[]; messageCount: number }): void {
  cache.delete(id); // re-insert so it counts as most-recent
  cache.set(id, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

export function useReplySuggestions({
  conversationId,
  messages,
  participantNames,
  body,
}: UseReplySuggestionsOptions): UseReplySuggestionsResult {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const aiSession = useAISession();
  const abortRef = useRef<AbortController | null>(null);
  const dismissedRef = useRef<string | null>(null);
  const fetchedRef = useRef<string | null>(null);

  // Load and listen for toggle changes
  useEffect(() => {
    getAISuggestionsEnabled().then(setEnabled);
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('aiSuggestionsEnabled' in changes) {
        setEnabled(changes.aiSuggestionsEnabled.newValue !== false);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  // Clear when user starts typing
  useEffect(() => {
    if (body.length > 0) {
      setSuggestions([]);
    }
  }, [body]);

  // Reset state and abort in-flight request when conversation changes
  useEffect(() => {
    fetchedRef.current = null;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    // Clear the spinner too — an aborted request's .catch skips setIsLoading(false)
    // when aborted, so without this isLoading stays true on the new conversation.
    setIsLoading(false);
  }, [conversationId]);

  // Fetch suggestions when conversation changes or messages become available
  useEffect(() => {
    // Already fetched or fetching for this conversation
    if (fetchedRef.current === conversationId) return;

    if (!ENABLE_AI_AUTOCOMPLETE || !aiSession.available || !enabled) return;
    if (body.length > 0) return;
    if (dismissedRef.current === conversationId) return;
    if (messages.length === 0) return;
    if (messages[messages.length - 1].isFromMe) return;
    // Skip attachment-only last messages (no text to reply to).
    if (!messages[messages.length - 1].body.trim()) return;

    // Serve from cache if message count hasn't changed
    const cached = cache.get(conversationId);
    if (cached && cached.messageCount === messages.length) {
      fetchedRef.current = conversationId;
      setSuggestions(cached.suggestions);
      return;
    }

    fetchedRef.current = conversationId;

    const controller = new AbortController();
    abortRef.current = controller;

    setSuggestions([]);
    setIsLoading(true);

    aiSession.predict(
      buildReplySuggestionsPrompt(messages, participantNames) ?? '',
      {
        signal: controller.signal,
        fullResponse: true,
        maxTokens: 100,
        systemPrompt: REPLY_SUGGESTIONS_SYSTEM_PROMPT,
        temperature: 0.7,
      },
    ).then((result) => {
      if (controller.signal.aborted) return;
      setIsLoading(false);

      console.log('[inflow] reply suggestions raw:', JSON.stringify(result));

      if (!result) return;

      const parsed = result
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      console.log('[inflow] reply suggestions parsed:', parsed);

      // Cache whatever we got (even <3) so we don't re-request the same state on
      // every render; show up to 3.
      const items = parsed.slice(0, 3);
      cacheSet(conversationId, { suggestions: items, messageCount: messages.length });
      if (items.length > 0) setSuggestions(items);
    }).catch(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });

  }, [conversationId, messages.length, aiSession.available, enabled]);

  const clear = useCallback(() => {
    dismissedRef.current = conversationId;
    setSuggestions([]);
  }, [conversationId]);

  return { suggestions, isLoading, clear };
}
