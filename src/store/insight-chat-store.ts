import { create } from 'zustand';
import type { ChatMessage } from '@/lib/connection-chat';

/**
 * Shared state for the "Ask your network" chat — held in a store (not a hook's
 * local state) so the compact card and the expanded overlay show the SAME active
 * conversation. Persistence lives in IndexedDB (insightChats); this holds the
 * in-session working copy of the active thread.
 */
interface InsightChatStore {
  /** Active persisted chat id, or null for an unsaved new chat. */
  activeId: string | null;
  /** Working transcript for the active chat. */
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  setActiveId: (id: string | null) => void;
  setMessages: (m: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Start a fresh, unsaved conversation. */
  reset: () => void;
}

export const useInsightChatStore = create<InsightChatStore>((set) => ({
  activeId: null,
  messages: [],
  loading: false,
  error: null,
  setActiveId: (activeId) => set({ activeId }),
  setMessages: (m) => set((s) => ({ messages: typeof m === 'function' ? m(s.messages) : m })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set({ activeId: null, messages: [], error: null }),
}));
