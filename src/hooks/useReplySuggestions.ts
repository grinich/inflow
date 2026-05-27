import { useState, useEffect, useRef, useCallback } from 'react';
import { useAISession } from './useAISession';
import { buildReplySuggestionsPrompt } from '@/lib/reply-suggestions-prompt';
import { ENABLE_AI_AUTOCOMPLETE } from '@/lib/feature-flags';
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

export function useReplySuggestions({
  conversationId,
  messages,
  participantNames,
  body,
}: UseReplySuggestionsOptions): UseReplySuggestionsResult {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const aiSession = useAISession();
  const abortRef = useRef<AbortController | null>(null);
  const dismissedRef = useRef<string | null>(null);
  const fetchedRef = useRef<string | null>(null);

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
  }, [conversationId]);

  // Fetch suggestions when conversation changes or messages become available
  useEffect(() => {
    // Already fetched or fetching for this conversation
    if (fetchedRef.current === conversationId) return;

    if (!ENABLE_AI_AUTOCOMPLETE || !aiSession.available) return;
    if (body.length > 0) return;
    if (dismissedRef.current === conversationId) return;
    if (messages.length === 0) return;
    if (messages[messages.length - 1].isFromMe) return;

    fetchedRef.current = conversationId;

    const controller = new AbortController();
    abortRef.current = controller;

    setSuggestions([]);
    setIsLoading(true);

    aiSession.predict(
      buildReplySuggestionsPrompt(messages, participantNames) ?? '',
      { signal: controller.signal, fullResponse: true, maxTokens: 60 },
    ).then((result) => {
      if (controller.signal.aborted) return;
      setIsLoading(false);

      if (!result) return;

      const parsed = result
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Take exactly 3
      if (parsed.length >= 3) {
        setSuggestions(parsed.slice(0, 3));
      }
    }).catch(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });

  }, [conversationId, messages.length, aiSession.available]);

  const clear = useCallback(() => {
    dismissedRef.current = conversationId;
    setSuggestions([]);
  }, [conversationId]);

  return { suggestions, isLoading, clear };
}
