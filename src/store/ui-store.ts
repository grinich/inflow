import { create } from 'zustand';
import type { Message } from '@/types/message';

export type ViewMode = 'list' | 'thread';
export type Theme = 'light' | 'dark' | 'system';
export type InboxTab = 'focused' | 'other' | 'archived' | 'spam';

export interface Toast {
  id: string;
  message: string;
  undoAction?: () => void;
  undoConversationId?: string;
}

interface TabMemory {
  conversationId: string | null;
  index: number;
}

interface UIState {
  viewMode: ViewMode;
  selectedIndex: number;
  selectedConversationId: string | null;
  paletteOpen: boolean;
  shortcutOverlayOpen: boolean;
  composeActive: boolean;
  composeNewActive: boolean;
  toast: Toast | null;
  lastUndoAction: (() => void) | null;
  lastUndoConversationId: string | null;
  searchQuery: string;
  theme: Theme;
  inboxTab: InboxTab;
  lightboxImageUrl: string | null;
  deleteConfirmId: string | null;
  spamConfirmId: string | null;
  replyingTo: Message | null;
  tabMemory: Partial<Record<InboxTab, TabMemory>>;
  _pendingRestore: TabMemory | null;

  setViewMode: (mode: ViewMode) => void;
  setSelectedIndex: (index: number) => void;
  setSelectedConversationId: (id: string | null) => void;
  togglePalette: () => void;
  setPaletteOpen: (open: boolean) => void;
  toggleShortcutOverlay: () => void;
  setShortcutOverlayOpen: (open: boolean) => void;
  setComposeActive: (active: boolean) => void;
  setComposeNewActive: (active: boolean) => void;
  showToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: () => void;
  clearLastUndo: () => void;
  setSearchQuery: (query: string) => void;
  setInboxTab: (tab: InboxTab) => void;
  openLightbox: (url: string) => void;
  closeLightbox: () => void;
  setDeleteConfirmId: (id: string | null) => void;
  setSpamConfirmId: (id: string | null) => void;
  setReplyingTo: (msg: Message | null) => void;
  openThread: (conversationId: string, index: number) => void;
  closeThread: () => void;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('inflow-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {}
  return 'system';
}

function getStoredView(): { inboxTab: InboxTab; selectedConversationId: string | null; selectedIndex: number; viewMode: ViewMode } {
  try {
    const raw = localStorage.getItem('inflow-view');
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        inboxTab: parsed.inboxTab || 'focused',
        selectedConversationId: parsed.selectedConversationId || null,
        selectedIndex: parsed.selectedIndex ?? 0,
        viewMode: parsed.viewMode || 'list',
      };
    }
  } catch {}
  return { inboxTab: 'focused', selectedConversationId: null, selectedIndex: 0, viewMode: 'list' };
}

function saveView(state: { inboxTab: InboxTab; selectedConversationId: string | null; selectedIndex: number; viewMode: ViewMode }) {
  try {
    localStorage.setItem('inflow-view', JSON.stringify(state));
  } catch {}
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  try {
    localStorage.setItem('inflow-theme', theme);
  } catch {}
}

// Apply theme on load
const initialTheme = getStoredTheme();
applyTheme(initialTheme);

// Restore view on load
const initialView = getStoredView();

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const current = useUIStore.getState().theme;
  if (current === 'system') applyTheme('system');
});

export const useUIStore = create<UIState>((set, get) => ({
  viewMode: initialView.viewMode,
  selectedIndex: initialView.selectedIndex,
  selectedConversationId: initialView.selectedConversationId,
  paletteOpen: false,
  shortcutOverlayOpen: false,
  composeActive: false,
  composeNewActive: false,
  toast: null,
  lastUndoAction: null,
  lastUndoConversationId: null,
  searchQuery: '',
  theme: initialTheme,
  inboxTab: initialView.inboxTab,
  lightboxImageUrl: null,
  deleteConfirmId: null,
  spamConfirmId: null,
  replyingTo: null,
  tabMemory: {},
  _pendingRestore: null,

  setViewMode: (mode) => set({ viewMode: mode }),
  setSelectedIndex: (index) => set({ selectedIndex: Math.max(0, index) }),
  setSelectedConversationId: (id) => set({ selectedConversationId: id }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  toggleShortcutOverlay: () => set((s) => ({ shortcutOverlayOpen: !s.shortcutOverlayOpen })),
  setShortcutOverlayOpen: (open) => set({ shortcutOverlayOpen: open }),
  setComposeActive: (active) => set({ composeActive: active }),
  setComposeNewActive: (active) => set({ composeNewActive: active }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setInboxTab: (tab) => {
    const s = get();
    if (tab === s.inboxTab) return;
    // Save current tab's selection
    const updatedMemory = {
      ...s.tabMemory,
      [s.inboxTab]: { conversationId: s.selectedConversationId, index: s.selectedIndex },
    };
    const restored = updatedMemory[tab] ?? null;
    const newState = {
      inboxTab: tab,
      tabMemory: updatedMemory,
      selectedIndex: restored?.index ?? 0,
      selectedConversationId: restored?.conversationId ?? null,
      _pendingRestore: restored,
      searchQuery: '',
    };
    set(newState);
    saveView({ inboxTab: tab, selectedConversationId: newState.selectedConversationId, selectedIndex: newState.selectedIndex, viewMode: s.viewMode });
  },
  openLightbox: (url) => set({ lightboxImageUrl: url }),
  closeLightbox: () => set({ lightboxImageUrl: null }),
  setDeleteConfirmId: (id) => set({ deleteConfirmId: id }),
  setSpamConfirmId: (id) => set({ spamConfirmId: id }),
  setReplyingTo: (msg) => set({ replyingTo: msg }),

  showToast: (toast) => {
    if (toastTimeout) clearTimeout(toastTimeout);
    const id = Date.now().toString();
    set((s) => ({
      toast: { ...toast, id },
      lastUndoAction: toast.undoAction ?? null,
      lastUndoConversationId: toast.undoConversationId ?? null,
    }));
    toastTimeout = setTimeout(() => {
      set((s) => (s.toast?.id === id ? { toast: null } : {}));
    }, 2000);
  },

  dismissToast: () => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({ toast: null });
  },

  clearLastUndo: () => set({ lastUndoAction: null, lastUndoConversationId: null }),

  openThread: (conversationId, index) => {
    set({
      viewMode: 'thread',
      selectedConversationId: conversationId,
      selectedIndex: index,
      composeActive: false,
      composeNewActive: false,
    });
    saveView({ inboxTab: get().inboxTab, selectedConversationId: conversationId, selectedIndex: index, viewMode: 'thread' });
  },

  closeThread: () => {
    const s = get();
    set({
      viewMode: 'list',
      selectedConversationId: null,
      composeActive: false,
    });
    saveView({ inboxTab: s.inboxTab, selectedConversationId: null, selectedIndex: s.selectedIndex, viewMode: 'list' });
  },

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },

  cycleTheme: () => {
    const order: Theme[] = ['dark', 'light', 'system'];
    const current = get().theme;
    const next = order[(order.indexOf(current) + 1) % order.length];
    applyTheme(next);
    set({ theme: next });
  },
}));
