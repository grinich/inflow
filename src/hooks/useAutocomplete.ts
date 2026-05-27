import { useState, useRef, useEffect, useCallback } from 'react';
import { useAISession } from './useAISession';
import { buildAutocompletePrompt } from '@/lib/autocomplete-prompt';
import { ENABLE_AI_AUTOCOMPLETE } from '@/lib/feature-flags';
import type { Message } from '@/types/message';

const DEBOUNCE_MS = 80;
const MIN_BODY_LENGTH = 5;

interface UseAutocompleteOptions {
  body: string;
  cursorAtEnd: boolean;
  emojiOpen: boolean;
  messages: Message[];
  participantNames: string[];
  conversationId: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  setBody: (value: string) => void;
}

interface UseAutocompleteResult {
  suggestion: string | null;
  accept: () => void;
  dismiss: () => void;
  isOpen: boolean;
  isLoading: boolean;
}

export function useAutocomplete({
  body,
  cursorAtEnd,
  emojiOpen,
  messages,
  participantNames,
  conversationId,
  textareaRef,
  setBody,
}: UseAutocompleteOptions): UseAutocompleteResult {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const aiSession = useAISession();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const justAcceptedRef = useRef(false);

  // Clear suggestion when conversation changes
  useEffect(() => {
    setSuggestion(null);
  }, [conversationId]);

  // On body change: clear suggestion and debounce a new prediction
  useEffect(() => {
    // Clear any existing suggestion immediately
    setSuggestion(null);
    setIsLoading(false);

    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    // Clear pending timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // Skip prediction right after accepting a suggestion
    if (justAcceptedRef.current) {
      justAcceptedRef.current = false;
      return;
    }

    // Don't predict if feature is off or API unavailable
    if (!ENABLE_AI_AUTOCOMPLETE || !aiSession.available) return;

    // Preconditions
    if (body.length < MIN_BODY_LENGTH) return;
    if (!cursorAtEnd) return;
    if (emojiOpen) return;

    timerRef.current = setTimeout(async () => {
      const prompt = buildAutocompletePrompt(messages, participantNames, body);
      if (!prompt) return;

      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      const result = await aiSession.predict(prompt, controller.signal);
      if (controller.signal.aborted) return;

      setIsLoading(false);
      if (result) {
        // Ensure a space between the current text and the suggestion
        const needsSpace = body.length > 0 && !body.endsWith(' ') && !result.startsWith(' ');
        setSuggestion(needsSpace ? ' ' + result : result);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [body, cursorAtEnd, emojiOpen, aiSession.available]);

  const accept = useCallback(() => {
    if (!suggestion) return;
    justAcceptedRef.current = true;
    const ta = textareaRef.current;
    const newBody = body + suggestion;
    setBody(newBody);
    setSuggestion(null);

    // Move cursor to end after insertion
    if (ta) {
      requestAnimationFrame(() => {
        ta.focus();
        const len = newBody.length;
        ta.setSelectionRange(len, len);
      });
    }
  }, [suggestion, body, setBody, textareaRef]);

  const dismiss = useCallback(() => {
    setSuggestion(null);
  }, []);

  return {
    suggestion,
    accept,
    dismiss,
    isOpen: suggestion !== null,
    isLoading,
  };
}
