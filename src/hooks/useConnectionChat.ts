import { useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useConnections } from './useConnections';
import { useAISession } from './useAISession';
import { useDbGeneration } from './useDbGeneration';
import { db } from '@/db/database';
import { useInsightChatStore } from '@/store/insight-chat-store';
import { answerConnectionQuestion, type ChatMessage } from '@/lib/connection-chat';
import type { InsightChat } from '@/types/insight-chat';

export interface ConnectionChatState {
  /** Transcript of the active conversation. */
  messages: ChatMessage[];
  loading: boolean;
  available: boolean;
  error: string | null;
  connectionCount: number;
  /** All saved conversations, most recent first (for the history sidebar). */
  chats: InsightChat[];
  /** The active conversation's id (null = unsaved new chat). */
  activeId: string | null;
  ask: (question: string) => Promise<void>;
  /** Start a new, empty conversation. */
  newChat: () => void;
  /** Load a saved conversation into the active view. */
  selectChat: (id: string) => Promise<void>;
  /** Delete a saved conversation. */
  deleteChat: (id: string) => Promise<void>;
  /** Alias of newChat (kept for older call sites). */
  clear: () => void;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `chat-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

/** Upsert a chat, preserving createdAt/title unless explicitly set. */
async function persist(id: string, messages: ChatMessage[], title?: string): Promise<void> {
  if (!db) return;
  const now = Date.now();
  const existing = await db.insightChats.get(id);
  await db.insightChats.put({
    id,
    title: title ?? existing?.title ?? 'New chat',
    messages,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * Persistent, multi-conversation chat for "Ask your network". The active thread
 * lives in a shared store (so the card and the expanded overlay stay in sync);
 * every turn is written to IndexedDB so past conversations show in the sidebar
 * and can be resumed. Answers are grounded in the connection list + the AI
 * summaries we generate (see buildConnectionContext).
 */
export function useConnectionChat(): ConnectionChatState {
  const { connections } = useConnections();
  const { available, predict } = useAISession();
  const dbGen = useDbGeneration();
  const { messages, loading, error, activeId } = useInsightChatStore();

  const chats = useLiveQuery(async () => {
    if (!db) return [] as InsightChat[];
    return db.insightChats.orderBy('updatedAt').reverse().toArray();
  }, [dbGen]) ?? [];

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      const store = useInsightChatStore.getState();
      if (!question || store.loading) return;
      store.setError(null);

      // Resolve (or create) the active chat.
      let id = store.activeId;
      let title: string | undefined;
      if (!id) {
        id = newId();
        title = question.length > 60 ? question.slice(0, 60) + '…' : question;
        store.setActiveId(id);
      }

      const history = store.messages;
      const withUser: ChatMessage[] = [...history, { role: 'user', content: question }];
      store.setMessages(withUser);
      store.setLoading(true);
      await persist(id, withUser, title);

      try {
        const answer = await answerConnectionQuestion(connections, question, predict, history);
        const withAnswer: ChatMessage[] = [
          ...withUser,
          { role: 'assistant', content: answer || "I couldn't find an answer in your connections." },
        ];
        useInsightChatStore.getState().setMessages(withAnswer);
        await persist(id, withAnswer);
      } catch (e: any) {
        useInsightChatStore.getState().setError(e?.message || 'Something went wrong');
        const withErr: ChatMessage[] = [
          ...withUser,
          { role: 'assistant', content: 'Sorry — that request failed. Please try again.' },
        ];
        useInsightChatStore.getState().setMessages(withErr);
        await persist(id, withErr);
      } finally {
        useInsightChatStore.getState().setLoading(false);
      }
    },
    [connections, predict],
  );

  const newChat = useCallback(() => {
    useInsightChatStore.getState().reset();
  }, []);

  const selectChat = useCallback(async (id: string) => {
    if (!db) return;
    const chat = await db.insightChats.get(id);
    if (!chat) return;
    const store = useInsightChatStore.getState();
    store.setActiveId(id);
    store.setMessages(chat.messages || []);
    store.setError(null);
  }, []);

  const deleteChat = useCallback(async (id: string) => {
    if (!db) return;
    await db.insightChats.delete(id);
    if (useInsightChatStore.getState().activeId === id) useInsightChatStore.getState().reset();
  }, []);

  return {
    messages,
    loading,
    available,
    error,
    connectionCount: connections.length,
    chats,
    activeId,
    ask,
    newChat,
    selectChat,
    deleteChat,
    clear: newChat,
  };
}
