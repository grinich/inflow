import { create } from 'zustand';
import type { Message } from '@/types/message';
import type { ConnectionRole } from '@/types/connection';
import { isDemoMode as checkDemoMode } from '@/lib/demo-mode';
import { type InboxLabels, DEFAULT_INBOX_LABELS, normalizeInboxLabels, DEFAULT_INBOX_SECTION_LABEL, normalizeSectionLabel } from '@/lib/inbox-labels';

export type ViewMode = 'list' | 'thread';
export type Theme = 'light' | 'dark' | 'system' | 'purple';
export type InboxTab = 'focused' | 'other' | 'inmail' | 'archived' | 'spam' | 'drafts' | 'scheduled';
export type AppSection = 'inbox' | 'connections' | 'invitations' | 'insights' | 'chat' | 'outbox';
import {
  getConfirmRecipient,
  setConfirmRecipient as persistConfirmRecipient,
  getAutoSendScheduled,
  setAutoSendScheduled as persistAutoSendScheduled,
  getConfirmDelete,
  setConfirmDelete as persistConfirmDelete,
} from '@/lib/send-settings';

export type SettingsSection = 'ai' | 'chat' | 'sending' | 'appearance' | 'backup' | 'advanced' | 'about';

/**
 * Active filter over the connections list (shared so Insights can drive it).
 * Multi-select: empty arrays mean "no constraint". A connection matches when its
 * role is one of `roles` (or `roles` is empty) AND it has one of `interests`
 * (or `interests` is empty) — OR within a facet, AND across facets.
 */
export interface ConnectionFilter {
  roles: ConnectionRole[];
  interests: string[];
}

/** The empty filter — everything shows. */
export const EMPTY_CONNECTION_FILTER: ConnectionFilter = { roles: [], interests: [] };

/** Connection state of the local MCP bridge (companion ↔ inflow). */
export type McpStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** One line in the MCP activity feed — what Claude just did. */
export interface McpActivityEntry {
  id: string;
  at: number;
  text: string;
}

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
  /** User-renamable labels for the Focused/Other tabs (persisted). */
  inboxLabels: InboxLabels;
  /** User-renamable name for the Inbox nav section itself (persisted). */
  inboxSectionLabel: string;
  lightboxImageUrl: string | null;
  deleteConfirmId: string | null;
  spamConfirmId: string | null;
  demoMode: boolean;
  replyingTo: Message | null;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  whatsNewOpen: boolean;
  activeSection: AppSection;
  /** Back/forward stacks for section navigation (browser-style arrows). */
  sectionHistory: AppSection[];
  sectionForward: AppSection[];
  navRailCollapsed: boolean;
  outboxView: 'grid' | 'list';
  setOutboxView: (v: 'grid' | 'list') => void;
  /** Require opening the recipient's profile before an InMail draft can send. */
  confirmRecipient: boolean;
  setConfirmRecipient: (on: boolean) => void;
  /** Send scheduled messages at their time with no click. */
  autoSendScheduled: boolean;
  setAutoSendScheduled: (on: boolean) => void;
  /** Ask before discarding a draft from the Outbox. */
  confirmDelete: boolean;
  setConfirmDelete: (on: boolean) => void;
  selectedConnectionUrn: string | null;
  connectionsFilter: ConnectionFilter;
  connectionsSearch: string;
  tabMemory: Partial<Record<InboxTab, TabMemory>>;
  _pendingRestore: TabMemory | null;

  // --- MCP (Claude co-worker) connection status + live activity feed ---------
  mcpStatus: McpStatus;
  mcpError: string | null;
  mcpActivity: McpActivityEntry[];
  /** Which provider keys the connected companion holds (advertised on connect).
   * Lets Settings show a key as "active in the companion" vs. in the browser. */
  mcpKeys: { anthropic: boolean; gemini: boolean };

  setDemoMode: (active: boolean) => void;
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
  setInboxLabels: (labels: InboxLabels) => void;
  setInboxSectionLabel: (label: string) => void;
  openLightbox: (url: string) => void;
  closeLightbox: () => void;
  setDeleteConfirmId: (id: string | null) => void;
  setSpamConfirmId: (id: string | null) => void;
  setReplyingTo: (msg: Message | null) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  setWhatsNewOpen: (open: boolean) => void;
  setActiveSection: (section: AppSection) => void;
  /** Go to the previously visited section (browser back). */
  goBackSection: () => void;
  /** Redo a section navigation undone by goBackSection (browser forward). */
  goForwardSection: () => void;
  setNavRailCollapsed: (collapsed: boolean) => void;
  toggleNavRail: () => void;
  setSelectedConnectionUrn: (urn: string | null) => void;
  setMcpStatus: (status: McpStatus, error?: string | null) => void;
  setMcpKeys: (keys: { anthropic: boolean; gemini: boolean }) => void;
  pushMcpActivity: (text: string) => void;
  clearMcpActivity: () => void;
  setConnectionsFilter: (filter: ConnectionFilter) => void;
  setConnectionsSearch: (query: string) => void;
  /** Jump to Connections applying a filter and/or search (from Insights). */
  showConnections: (opts?: { filter?: ConnectionFilter; search?: string }) => void;
  openThread: (conversationId: string, index: number) => void;
  closeThread: () => void;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('inflow-theme');
    if (stored === 'light' || stored === 'dark' || stored === 'system' || stored === 'purple') return stored;
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

const INBOX_LABELS_KEY = 'inflow-inbox-labels';
const INBOX_SECTION_LABEL_KEY = 'inflow-inbox-section-label';

function getStoredInboxLabels(): InboxLabels {
  try {
    const raw = localStorage.getItem(INBOX_LABELS_KEY);
    if (raw) return normalizeInboxLabels(JSON.parse(raw));
  } catch {}
  return DEFAULT_INBOX_LABELS;
}

function getStoredInboxSectionLabel(): string {
  try {
    return normalizeSectionLabel(localStorage.getItem(INBOX_SECTION_LABEL_KEY));
  } catch {}
  return DEFAULT_INBOX_SECTION_LABEL;
}

function getStoredSection(): AppSection {
  try {
    const stored = localStorage.getItem('inflow-section');
    if (stored === 'inbox' || stored === 'connections' || stored === 'insights' || stored === 'chat') return stored;
  } catch {}
  return 'inbox';
}

/** Grid or list for the Outbox. Grid by default — it fits more on screen. */
function getStoredOutboxView(): 'grid' | 'list' {
  try {
    return localStorage.getItem('inflow-outbox-view') === 'list' ? 'list' : 'grid';
  } catch {}
  return 'grid';
}

function getStoredNavCollapsed(): boolean {
  try {
    return localStorage.getItem('inflow-nav-collapsed') === '1';
  } catch {}
  return false;
}

function resolveTheme(theme: Theme): 'light' | 'dark' | 'purple' {
  if (theme === 'system') {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return; // no DOM (e.g. node test/service worker)
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  // Purple builds on the dark base: apply both so it inherits dark tokens and
  // only overrides the purple-tinted ones. Light applies neither class.
  root.classList.remove('dark', 'theme-purple');
  if (resolved === 'dark') root.classList.add('dark');
  else if (resolved === 'purple') root.classList.add('dark', 'theme-purple');
  try {
    localStorage.setItem('inflow-theme', theme);
  } catch {}
}

// Apply theme on load
const initialTheme = getStoredTheme();
applyTheme(initialTheme);

// Restore view on load
const initialView = getStoredView();

// Listen for system theme changes (guarded — jsdom/node may lack matchMedia)
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = useUIStore.getState().theme;
    if (current === 'system') applyTheme('system');
  });
}

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
  inboxLabels: getStoredInboxLabels(),
  inboxSectionLabel: getStoredInboxSectionLabel(),
  lightboxImageUrl: null,
  deleteConfirmId: null,
  spamConfirmId: null,
  demoMode: checkDemoMode(),
  replyingTo: null,
  settingsOpen: false,
  settingsSection: 'ai',
  whatsNewOpen: false,
  activeSection: getStoredSection(),
  sectionHistory: [],
  sectionForward: [],
  navRailCollapsed: getStoredNavCollapsed(),
  outboxView: getStoredOutboxView(),
  // These mirror chrome.storage, hydrated on startup (see hydrateSendSettings).
  // Until that resolves they hold the defaults, which match the real ones.
  confirmRecipient: true,
  autoSendScheduled: true,
  confirmDelete: true,
  selectedConnectionUrn: null,
  connectionsFilter: { roles: [], interests: [] },
  connectionsSearch: '',
  mcpStatus: 'disconnected',
  mcpError: null,
  mcpActivity: [],
  mcpKeys: { anthropic: false, gemini: false },
  tabMemory: {},
  _pendingRestore: null,

  setDemoMode: (active) => set({ demoMode: active }),
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
  setInboxLabels: (labels) => {
    const normalized = normalizeInboxLabels(labels);
    try { localStorage.setItem(INBOX_LABELS_KEY, JSON.stringify(normalized)); } catch {}
    set({ inboxLabels: normalized });
  },
  setInboxSectionLabel: (label) => {
    const normalized = normalizeSectionLabel(label);
    try { localStorage.setItem(INBOX_SECTION_LABEL_KEY, normalized); } catch {}
    set({ inboxSectionLabel: normalized });
  },
  openLightbox: (url) => set({ lightboxImageUrl: url }),
  closeLightbox: () => set({ lightboxImageUrl: null }),
  setDeleteConfirmId: (id) => set({ deleteConfirmId: id }),
  setSpamConfirmId: (id) => set({ spamConfirmId: id }),
  setReplyingTo: (msg) => set({ replyingTo: msg }),
  openSettings: (section) => set(section ? { settingsOpen: true, settingsSection: section } : { settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setWhatsNewOpen: (open) => set({ whatsNewOpen: open }),
  setActiveSection: (section) => {
    const cur = get().activeSection;
    try {
      localStorage.setItem('inflow-section', section);
    } catch {}
    // Leaving a section closes the composer so it can't linger over the new view.
    // Record the prior section for the back/forward arrows (fresh nav clears forward).
    if (cur === section) {
      set({ activeSection: section, composeNewActive: false });
    } else {
      set({
        activeSection: section,
        composeNewActive: false,
        sectionHistory: [...get().sectionHistory, cur].slice(-50),
        sectionForward: [],
      });
    }
  },
  goBackSection: () => {
    const { sectionHistory, activeSection } = get();
    if (sectionHistory.length === 0) return;
    const prev = sectionHistory[sectionHistory.length - 1];
    try {
      localStorage.setItem('inflow-section', prev);
    } catch {}
    set({
      activeSection: prev,
      sectionHistory: sectionHistory.slice(0, -1),
      sectionForward: [activeSection, ...get().sectionForward].slice(0, 50),
      composeNewActive: false,
    });
  },
  goForwardSection: () => {
    const { sectionForward, activeSection } = get();
    if (sectionForward.length === 0) return;
    const next = sectionForward[0];
    try {
      localStorage.setItem('inflow-section', next);
    } catch {}
    set({
      activeSection: next,
      sectionForward: sectionForward.slice(1),
      sectionHistory: [...get().sectionHistory, activeSection].slice(-50),
      composeNewActive: false,
    });
  },
  setOutboxView: (v) => {
    try {
      localStorage.setItem('inflow-outbox-view', v);
    } catch {}
    set({ outboxView: v });
  },
  setNavRailCollapsed: (collapsed) => {
    try {
      localStorage.setItem('inflow-nav-collapsed', collapsed ? '1' : '0');
    } catch {}
    set({ navRailCollapsed: collapsed });
  },
  toggleNavRail: () => {
    const next = !get().navRailCollapsed;
    try {
      localStorage.setItem('inflow-nav-collapsed', next ? '1' : '0');
    } catch {}
    set({ navRailCollapsed: next });
  },
  setConfirmRecipient: (on) => {
    void persistConfirmRecipient(on);
    set({ confirmRecipient: on });
  },
  setAutoSendScheduled: (on) => {
    void persistAutoSendScheduled(on);
    set({ autoSendScheduled: on });
  },
  setConfirmDelete: (on) => {
    void persistConfirmDelete(on);
    set({ confirmDelete: on });
  },
  setSelectedConnectionUrn: (urn) => set({ selectedConnectionUrn: urn }),
  setMcpStatus: (status, error = null) =>
    set({
      mcpStatus: status,
      mcpError: status === 'error' ? error : null,
      // Advertised keys are only meaningful while connected; drop them otherwise.
      ...(status === 'connected' ? {} : { mcpKeys: { anthropic: false, gemini: false } }),
    }),
  setMcpKeys: (keys) => set({ mcpKeys: keys }),
  pushMcpActivity: (text) =>
    set((s) => ({
      // Cap the feed so it can't grow unbounded during a long session.
      mcpActivity: [{ id: crypto.randomUUID(), at: Date.now(), text }, ...s.mcpActivity].slice(0, 50),
    })),
  clearMcpActivity: () => set({ mcpActivity: [] }),
  setConnectionsFilter: (filter) => set({ connectionsFilter: filter }),
  setConnectionsSearch: (query) => set({ connectionsSearch: query }),
  showConnections: (opts) => {
    const cur = get().activeSection;
    try {
      localStorage.setItem('inflow-section', 'connections');
    } catch {}
    set({
      activeSection: 'connections',
      composeNewActive: false,
      connectionsFilter: opts?.filter ?? { roles: [], interests: [] },
      connectionsSearch: opts?.search ?? '',
      // A fresh drill-in shouldn't keep a previously selected person highlighted.
      selectedConnectionUrn: null,
      // Record history so Back returns to where the drill-in came from.
      ...(cur !== 'connections'
        ? { sectionHistory: [...get().sectionHistory, cur].slice(-50), sectionForward: [] }
        : {}),
    });
  },

  showToast: (toast) => {
    if (toastTimeout) clearTimeout(toastTimeout);
    const id = Date.now().toString();
    set({
      toast: { ...toast, id },
      lastUndoAction: toast.undoAction ?? null,
      lastUndoConversationId: toast.undoConversationId ?? null,
    });
    toastTimeout = setTimeout(() => {
      // Clear the undo state alongside the toast so a later 'z' press can't fire
      // a stale undo for an action whose toast disappeared long ago.
      set((s) => (s.toast?.id === id ? { toast: null, lastUndoAction: null, lastUndoConversationId: null } : {}));
    }, 2000);
  },

  dismissToast: () => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({ toast: null, lastUndoAction: null, lastUndoConversationId: null });
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
    const order: Theme[] = ['dark', 'light', 'system', 'purple'];
    const current = get().theme;
    const next = order[(order.indexOf(current) + 1) % order.length];
    applyTheme(next);
    set({ theme: next });
  },
}));

/**
 * Pull the send settings out of chrome.storage into the store. They live there
 * rather than localStorage because the background worker needs them too, and a
 * service worker has no localStorage — but the Outbox reads them on every
 * render, so the store keeps a synchronous mirror. Called once at app start.
 */
export async function hydrateSendSettings(): Promise<void> {
  const [confirmRecipient, autoSendScheduled, confirmDelete] = await Promise.all([
    getConfirmRecipient(),
    getAutoSendScheduled(),
    getConfirmDelete(),
  ]);
  useUIStore.setState({ confirmRecipient, autoSendScheduled, confirmDelete });
}
