import type { ChatMessage } from '@/lib/connection-chat';

/**
 * A saved "Ask your network" conversation. Persisted per-account so the user can
 * revisit and continue previous chats (like the Claude chat history sidebar).
 */
export interface InsightChat {
  /** Stable id (uuid). */
  id: string;
  /** Short title, derived from the first question. */
  title: string;
  /** Full transcript, oldest first. */
  messages: ChatMessage[];
  createdAt: number;
  /** Bumped on every message; drives the recency-sorted sidebar. */
  updatedAt: number;
}
