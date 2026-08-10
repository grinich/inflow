import { useCallback, useState } from 'react';
import { db } from '@/db/database';
import { useAISession } from './useAISession';
import { summarizeConversation } from '@/lib/connection-conversation-summary';
import type { Connection } from '@/types/connection';
import type { Conversation } from '@/types/conversation';

export interface ConversationSummaryState {
  /** True while a summary is being generated. */
  summarizing: boolean;
  /** Human-readable last error, if any. */
  error: string | null;
  /** Whether the AI provider is configured. */
  available: boolean;
  /** Generate (or regenerate) the conversation summary for a connection. */
  summarize: (connection: Connection, conversation: Conversation) => Promise<void>;
}

/**
 * User-triggered AI recap of a connection's message thread. Loads the thread's
 * messages, summarizes them, and writes the result back onto the connection row
 * (stamped with the thread's lastActivityAt so staleness can be detected later).
 */
export function useConversationSummary(): ConversationSummaryState {
  const { available, predict } = useAISession();
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summarize = useCallback(
    async (connection: Connection, conversation: Conversation) => {
      if (!db || !available) return;
      setSummarizing(true);
      setError(null);
      try {
        const messages = await db.messages
          .where('conversationId')
          .equals(conversation.id)
          .sortBy('createdAt');
        if (messages.length === 0) {
          setError('No messages to summarize yet.');
          return;
        }
        const summary = await summarizeConversation(connection.fullName, messages, predict);
        if (!summary) {
          setError('Could not summarize — the AI may be rate-limited or the key invalid.');
          return;
        }
        await db.connections.update(connection.profileUrn, {
          conversationSummary: summary,
          conversationSummaryAt: Date.now(),
          conversationSummaryLastMsgAt: conversation.lastActivityAt,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to summarize conversation');
      } finally {
        setSummarizing(false);
      }
    },
    [available, predict],
  );

  return { summarizing, error, available, summarize };
}
