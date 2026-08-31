import { create } from 'zustand';
import type { Message } from '@/types/message';
import { isDemoMode as checkDemoMode } from '@/lib/demo-mode';
import { publishRouteToShell } from '@/lib/shell-messages';
import {
  readAppRouteFromLocation,
  writeAppRouteToLocation,
  subscribeToAppRouteHash,
  appRouteToHash,
  locationHasRoute,
  queryHasUnread,
  setUnreadInQuery,
  type AppRoute,
  type AppView,
} from '@/lib/app-route';

export type ViewMode = 'list' | 'thread';
export type Theme = 'light' | 'dark' | 'system';
export type InboxTab = 'focused' | 'other' | 'archived' | 'spam';
export type { AppView };
export type NetworkTab = 'invitations' | 'sent' | 'connections';

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
  /**
   * The conversation whose reply box should take the cursor as soon as it
   * mounts, or null.
   *
   * Focus used to be applied by polling the DOM for any `[data-compose-input]`
   * and focusing the first hit. That focuses whichever composer happens to be
   * mounted — not necessarily the conversation we jumped to — and it is a
   * one-shot: a composer replaced afterwards (which is exactly what the
   * placeholder → real thread swap does) comes back unfocused. Naming the
   * conversation instead lets the right composer claim the cursor whenever it
   * appears, however many times the tree is rebuilt underneath it.
   */
  composerFocusFor: string | null;
  /**
   * A pending "keep what is typed" handover between two conversations.
   *
   * The accept flow replaces a placeholder thread with the real one the moment
   * it syncs. Copying the text across meant snapshotting the box before the
   * swap and reloading it after — so anything typed in between was thrown
   * away, which is what happened to anyone still typing when the thread
   * arrived. The composer is re-rendered rather than remounted, so it can
   * simply hold on to what it has while the conversation under it changes.
   */
  draftCarry: { from: string; to: string } | null;
  composeNewActive: boolean;
  toast: Toast | null;
  lastUndoAction: (() => void) | null;
  lastUndoConversationId: string | null;
  searchQuery: string;
  theme: Theme;
  inboxTab: InboxTab;
  appView: AppView;
  networkTab: NetworkTab;
  networkSelectedIndex: number;
  lightboxImageUrl: string | null;
  lightboxVideoUrl: string | null;
  deleteConfirmId: string | null;
  spamConfirmId: string | null;
  demoMode: boolean;
  replyingTo: Message | null;
  aiSetupOpen: boolean;
  agentAccessOpen: boolean;
  /** Pairing code from a ?pair= launch link, consumed by the Agent Access modal. */
  agentAccessPrefillCode: string | null;
  tabMemory: Partial<Record<InboxTab, TabMemory>>;
  _pendingRestore: TabMemory | null;

  setDemoMode: (active: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setSelectedIndex: (index: number) => void;
  setSelectedConversationId: (id: string | null) => void;
  togglePalette: () => void;
  setPaletteOpen: (open: boolean) => void;
  toggleShortcutOverlay: () => void;
  setShortcutOverlayOpen: (open: boolean) => void;
  setComposeActive: (active: boolean) => void;
  /** Ask for the cursor in this conversation's reply box once it exists. */
  requestComposerFocus: (conversationId: string) => void;
  /** Called by the composer that took it. */
  clearComposerFocus: (conversationId: string) => void;
  /** Ask the composer to keep its text as it moves between conversations. */
  carryDraftAcross: (from: string, to: string) => void;
  /** Claim a handover into this conversation; returns the one it came from. */
  takeDraftCarry: (to: string) => string | null;
  setComposeNewActive: (active: boolean) => void;
  showToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: () => void;
  clearLastUndo: () => void;
  setSearchQuery: (query: string) => void;
  setInboxTab: (tab: InboxTab) => void;
  setAppView: (view: AppView) => void;
  setNetworkTab: (tab: NetworkTab) => void;
  setNetworkSelectedIndex: (index: number) => void;
  openLightbox: (url: string) => void;
  closeLightbox: () => void;
  openVideoLightbox: (url: string) => void;
  closeVideoLightbox: () => void;
  setDeleteConfirmId: (id: string | null) => void;
  setSpamConfirmId: (id: string | null) => void;
  setReplyingTo: (msg: Message | null) => void;
  setAISetupOpen: (open: boolean) => void;
  setAgentAccessOpen: (open: boolean) => void;
  setAgentAccessPrefill: (code: string | null) => void;
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
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return; // no DOM (e.g. node test/service worker)
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

// The nav state — the top-level view, which inbox tab, and whether the unread
// filter is on — is routed by the URL hash (see lib/app-route). Read it on load
// so a reload or a deep link lands exactly where it left off. The URL wins over
// the localStorage-restored tab when it carries one; a bare `app.html` falls
// back to the stored tab.
const initialRoute = readAppRouteFromLocation();
const initialAppView = initialRoute.view;
const initialInboxTab = locationHasRoute() ? initialRoute.inboxTab : initialView.inboxTab;
const initialSearchQuery = initialRoute.unread ? 'is:unread' : '';

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
  composerFocusFor: null,
  draftCarry: null,
  composeNewActive: false,
  toast: null,
  lastUndoAction: null,
  lastUndoConversationId: null,
  searchQuery: initialSearchQuery,
  theme: initialTheme,
  inboxTab: initialInboxTab,
  appView: initialAppView,
  networkTab: 'invitations',
  networkSelectedIndex: 0,
  lightboxImageUrl: null,
  lightboxVideoUrl: null,
  deleteConfirmId: null,
  spamConfirmId: null,
  demoMode: checkDemoMode(),
  replyingTo: null,
  aiSetupOpen: false,
  agentAccessOpen: false,
  agentAccessPrefillCode: null,
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
  requestComposerFocus: (conversationId) =>
    set({ composeActive: true, composerFocusFor: conversationId }),
  // Only the composer that was asked for may clear the request; a different
  // one unmounting must not cancel a focus meant for the thread arriving next.
  clearComposerFocus: (conversationId) =>
    set((s) => (s.composerFocusFor === conversationId ? { composerFocusFor: null } : {})),
  carryDraftAcross: (from, to) => set({ draftCarry: { from, to } }),
  takeDraftCarry: (to) => {
    const carry = get().draftCarry;
    if (carry?.to !== to) return null;
    set({ draftCarry: null });
    return carry.from;
  },
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
  setAppView: (view) => {
    if (view === get().appView) return;
    set({ appView: view, networkSelectedIndex: 0 });
  },
  setNetworkTab: (tab) => {
    if (tab === get().networkTab) return;
    set({ networkTab: tab, networkSelectedIndex: 0 });
  },
  setNetworkSelectedIndex: (index) => set({ networkSelectedIndex: Math.max(0, index) }),
  openLightbox: (url) => set({ lightboxImageUrl: url }),
  closeLightbox: () => set({ lightboxImageUrl: null }),
  openVideoLightbox: (url) => set({ lightboxVideoUrl: url }),
  closeVideoLightbox: () => set({ lightboxVideoUrl: null }),
  setDeleteConfirmId: (id) => set({ deleteConfirmId: id }),
  setSpamConfirmId: (id) => set({ spamConfirmId: id }),
  setReplyingTo: (msg) => set({ replyingTo: msg }),
  setAISetupOpen: (open) => set({ aiSetupOpen: open }),
  setAgentAccessOpen: (open) => set({ agentAccessOpen: open }),
  setAgentAccessPrefill: (code) => set({ agentAccessPrefillCode: code }),

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
    const order: Theme[] = ['dark', 'light', 'system'];
    const current = get().theme;
    const next = order[(order.indexOf(current) + 1) % order.length];
    applyTheme(next);
    set({ theme: next });
  },
}));

// ── URL ↔ store ────────────────────────────────────────────────────────────
// One place owns every hash write. Doing it per-setter means each new piece of
// nav state has to remember to route itself, and setSearchQuery — which the
// unread filter rides on — fires on every keystroke.

function routeOf(state: { appView: AppView; inboxTab: InboxTab; searchQuery: string }): AppRoute {
  return {
    view: state.appView,
    inboxTab: state.inboxTab,
    unread: queryHasUnread(state.searchQuery),
  };
}

function syncRoute(route: AppRoute, opts: { replace?: boolean; force?: boolean }) {
  writeAppRouteToLocation(route, opts);
  // Inside the inflow.im/app iframe the hash above is on a URL nobody sees and
  // that a reload rebuilds from scratch — the shell has to mirror it.
  publishRouteToShell(appRouteToHash(route));
}

// Put the route in the URL on first load, so a bare `app.html` still shows
// where you are and a reload keeps it. Replaces, so it adds no history entry.
syncRoute(routeOf(useUIStore.getState()), { replace: true, force: true });

useUIStore.subscribe((state, prev) => {
  const route = routeOf(state);
  const previous = routeOf(prev);
  if (appRouteToHash(route) === appRouteToHash(previous)) return;
  // A view or tab change is a destination and belongs in history. Toggling
  // unread only filters the tab you are already on, and typing in the search
  // box can flip it repeatedly — so it replaces rather than stacking up.
  const onlyUnreadChanged = route.view === previous.view && route.inboxTab === previous.inboxTab;
  syncRoute(route, { replace: onlyUnreadChanged });
});

// Back/forward, or an edited URL, changes the hash without going through the
// setters — mirror it back into the store. The writes above no-op when the
// hash already matches, so this never ping-pongs.
subscribeToAppRouteHash((route) => {
  const store = useUIStore.getState();
  if (route.view !== store.appView) store.setAppView(route.view);
  if (route.view === 'inbox') {
    if (route.inboxTab !== store.inboxTab) store.setInboxTab(route.inboxTab);
    // Read after setInboxTab, which clears the query on a tab change.
    const current = useUIStore.getState().searchQuery;
    if (route.unread !== queryHasUnread(current)) {
      store.setSearchQuery(setUnreadInQuery(current, route.unread));
    }
  }
});
