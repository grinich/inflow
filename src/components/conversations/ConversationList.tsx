import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useUIStore } from '@/store/ui-store';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';
import { computeWindow } from '@/lib/list-window';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import { ConversationListHeader } from './ConversationListHeader';
import { ConversationRow } from './ConversationRow';
import { ConversationContextMenu } from './ConversationContextMenu';
import { SwipeableRow } from './SwipeableRow';
import { SyncStatusIndicator } from '../common/SyncStatusIndicator';
import type { Conversation } from '@/types/conversation';

interface ConversationListProps {
  conversations: Conversation[];
  isLoading?: boolean;
  isDiscovering?: boolean;
  category: string;
  isSearching?: boolean;
  hasMoreSearchResults?: boolean;
  onLoadMoreSearch?: () => void;
  onOpenDebug?: () => void;
  /** Avatar-rail mode (very narrow window): avatars only, no search/tabs/footer. */
  compact?: boolean;
}

/** Fallback row height until the first rendered row is measured. */
const DEFAULT_ROW_HEIGHT = 64;
const OVERSCAN = 8;

interface DraftMeta {
  text: string;
  attachmentCount: number;
}

export function ConversationList({ conversations, isLoading, isDiscovering, category, isSearching, hasMoreSearchResults, onLoadMoreSearch, onOpenDebug, compact }: ConversationListProps) {
  const selectedConversationId = useUIStore((s) => s.selectedConversationId);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef(0);
  const prefetchedRef = useRef<Set<string>>(new Set());
  const inboxTab = useUIStore((s) => s.inboxTab);
  // Re-subscribe the batched metadata queries when the DB opens/switches — a
  // query that ran while `db` was null observed no tables and stays frozen.
  const dbGen = useDbGeneration();

  // ── Batched row metadata ───────────────────────────────────────────────────
  // These used to be three IndexedDB queries PER ROW on mount (draft, failed
  // message, company profile) — ~900 queries when switching to a large folder,
  // plus one live profile subscription per row. Batch them into three
  // list-level queries and pass values down as props.

  const draftsByConv = useLiveQuery(
    async () => {
      const map = new Map<string, DraftMeta>();
      if (!db) return map;
      // Tiny table: one row per conversation with a saved draft.
      for (const row of await db.draftAttachments.toArray()) {
        map.set(row.conversationId, {
          text: row.text || '',
          attachmentCount: row.files?.length || 0,
        });
      }
      return map;
    },
    [dbGen],
    new Map<string, DraftMeta>()
  );

  const failedConvIds = useLiveQuery(
    async () => {
      const set = new Set<string>();
      if (!db) return set;
      // Failed sends are always optimistic temp- rows — an indexed primary-key
      // prefix scan over the handful of temps, not a per-conversation count.
      const temps = await db.messages.where('id').startsWith('temp-').toArray();
      for (const t of temps) {
        if (t.status === 'failed') set.add(t.conversationId);
      }
      return set;
    },
    [dbGen],
    new Set<string>()
  );

  // Minute counter so memoized rows still refresh their relative timestamps.
  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTimeTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  // ── Windowed rendering ─────────────────────────────────────────────────────
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight || 600);
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, []);

  // Measure the real row height from the first rendered row (uniform rows).
  useLayoutEffect(() => {
    const row = scrollContainerRef.current?.querySelector<HTMLElement>('[data-conversation-id]');
    if (row && row.offsetHeight > 0 && Math.abs(row.offsetHeight - rowHeight) > 1) {
      setRowHeight(row.offsetHeight);
    }
  });

  const { start, end, topPad, bottomPad } = computeWindow(
    scrollTop,
    viewportHeight,
    rowHeight,
    conversations.length,
    OVERSCAN
  );
  const visibleRows = conversations.slice(start, end);

  // Keep the selected row mounted/visible: when selection moves outside the
  // rendered window (j/k held down, tab restore), scroll the container so the
  // window includes it. The row's own scrollIntoView fine-tunes once mounted.
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  useEffect(() => {
    if (!selectedConversationId) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const idx = conversationsRef.current.findIndex((c) => c.id === selectedConversationId);
    if (idx === -1) return;
    const rowTop = idx * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < el.scrollTop) {
      el.scrollTop = rowTop;
    } else if (rowBottom > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowBottom - el.clientHeight;
    }
  }, [selectedConversationId, rowHeight]);

  // Clear prefetch cache on tab change or DB reset
  useEffect(() => {
    prefetchedRef.current.clear();
  }, [inboxTab]);

  // Scroll-triggered infinite loading: dual-mode sentinel
  // - Active search with more results → load more search results
  // - Normal browsing with discovery active → burst-discover more conversations
  useEffect(() => {
    if (!sentinelRef.current) return;
    const shouldObserve = (hasMoreSearchResults && onLoadMoreSearch) || isDiscovering;
    if (!shouldObserve) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        if (hasMoreSearchResults && onLoadMoreSearch) {
          // Search pagination — no throttle, loadMore() guards against double-fires
          onLoadMoreSearch();
        } else if (isDiscovering) {
          const now = Date.now();
          if (now - lastTriggerRef.current < 2000) return;
          lastTriggerRef.current = now;
          sendBridgeMessage({ type: 'BURST_DISCOVER', category });
        }
      }
    }, { threshold: 0 });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
    // isSearching / conversations.length gate whether the sentinel node is mounted,
    // so re-run when they change to (re)attach the observer to the live node.
  }, [isDiscovering, category, hasMoreSearchResults, onLoadMoreSearch, isSearching, conversations.length]);

  // Prefetch next 2 conversations after the selected one so j/k navigation feels instant
  useEffect(() => {
    if (!selectedConversationId) return;
    const idx = conversations.findIndex((c) => c.id === selectedConversationId);
    if (idx === -1) return;

    const ahead = conversations.slice(idx + 1, idx + 3).map((c) => c.id);
    if (ahead.length === 0) return;

    const toCheck = ahead.filter((id) => !prefetchedRef.current.has(id));
    if (toCheck.length === 0) return;

    (async () => {
      const uncached: string[] = [];
      for (const id of toCheck) {
        const count = await db.messages.where('conversationId').equals(id).count();
        if (count === 0) uncached.push(id);
      }
      if (uncached.length === 0) return;
      for (const id of uncached) prefetchedRef.current.add(id);
      sendBridgeMessage({ type: 'PREFETCH_MESSAGES', conversationIds: uncached })
      .catch(() => { for (const id of uncached) prefetchedRef.current.delete(id); });
    })();
  }, [selectedConversationId, conversations]);

  // Scroll-idle prefetch: when scrolling stops, find visible unsynced conversations and prefetch messages
  const handleScrollIdle = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const rows = container.querySelectorAll<HTMLElement>('[data-conversation-id]');
    const containerRect = container.getBoundingClientRect();
    const visibleIds: string[] = [];

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
        const id = row.dataset.conversationId;
        if (id && !prefetchedRef.current.has(id)) {
          visibleIds.push(id);
        }
      }
    }
    if (visibleIds.length === 0) return;

    // Batch-check which visible conversations have zero cached messages
    const uncached: string[] = [];
    for (const id of visibleIds) {
      const count = await db.messages.where('conversationId').equals(id).count();
      if (count === 0) uncached.push(id);
    }
    if (uncached.length === 0) return;

    // Mark as requested so we don't re-request
    for (const id of uncached) prefetchedRef.current.add(id);

    sendBridgeMessage({ type: 'PREFETCH_MESSAGES', conversationIds: uncached })
      .catch(() => { for (const id of uncached) prefetchedRef.current.delete(id); });
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(handleScrollIdle, 800);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      container.removeEventListener('scroll', onScroll);
    };
  }, [handleScrollIdle]);

  // Stable click handler (via refs) so memoized rows never re-render because a
  // parent render recreated their onClick closure.
  const actions = useOptimisticAction();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const handleOpen = useCallback((conv: Conversation, index: number) => {
    const store = useUIStore.getState();
    if (conv.draft === 1) {
      if (conv.lastMessage) {
        // Draft with text in ComposeBox → open ThreadView
        store.setSelectedConversationId(conv.id);
        store.setSelectedIndex(index);
        store.setComposeNewActive(false);
      } else {
        // Draft still picking recipients → open composer
        store.setSelectedConversationId(conv.id);
        store.setSelectedIndex(index);
        store.setComposeNewActive(true);
      }
      return;
    }
    store.openThread(conv.id, index);
    actionsRef.current.markRead(conv.id, conv.mergedIds);
  }, []);

  // Right-click context menu: track which conversation + cursor position.
  const [contextMenu, setContextMenu] = useState<{ conversation: Conversation; x: number; y: number } | null>(null);
  const handleContextMenu = useCallback((conv: Conversation, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ conversation: conv, x: e.clientX, y: e.clientY });
  }, []);

  const [accountName, setAccountName] = useState<string | undefined>();
  useEffect(() => {
    try {
      setAccountName(localStorage.getItem('inflow-account-name') || undefined);
    } catch {}
  }, []);


  return (
    <div className="flex h-full flex-col">
      {compact ? (
        <div className="flex justify-center border-b border-edge py-2">
          <button
            onClick={() => useUIStore.getState().setComposeNewActive(true)}
            title="New message (C)"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
        </div>
      ) : (
        <ConversationListHeader conversationCount={conversations.length} />
      )}
      <div
        ref={scrollContainerRef}
        onScroll={(e) => setScrollTop((e.target as HTMLElement).scrollTop)}
        className="flex-1 select-none overflow-x-hidden overflow-y-auto overscroll-contain"
      >
        {topPad > 0 && <div style={{ height: topPad }} aria-hidden />}
        {visibleRows.map((conv, i) => {
          const draft = draftsByConv.get(conv.id);
          const row = (
            <ConversationRow
              key={compact ? conv.id : undefined}
              conversation={conv}
              selected={conv.id === selectedConversationId}
              index={start + i}
              onOpen={handleOpen}
              onContextMenu={handleContextMenu}
              draftText={draft?.text || ''}
              draftAttachmentCount={draft?.attachmentCount || 0}
              hasFailed={failedConvIds.has(conv.id)}
              timeTick={timeTick}
              compact={compact}
            />
          );
          if (compact) return row;
          return (
            <SwipeableRow
              key={conv.id}
              right={{ className: 'bg-amber-500', label: conv.starred ? 'Unstar' : 'Star', icon: STAR_ICON }}
              left={
                inboxTab === 'archived'
                  ? { className: 'bg-blue-600', label: 'Focused', icon: UNARCHIVE_ICON }
                  : { className: 'bg-green-600', label: 'Archive', icon: ARCHIVE_ICON }
              }
              onSwipeRight={() => actionsRef.current.starConversation(conv)}
              onSwipeLeft={() =>
                inboxTab === 'archived'
                  ? actionsRef.current.moveToFocused(conv)
                  : actionsRef.current.archiveConversation(conv)
              }
            >
              {row}
            </SwipeableRow>
          );
        })}
        {bottomPad > 0 && <div style={{ height: bottomPad }} aria-hidden />}
        {/* Keep the infinite-scroll sentinel mounted whenever a search/discovery
            is in flight — even with zero local matches — so pagination can fire
            and the loading state stays visible. */}
        {(conversations.length > 0 || isSearching || isDiscovering) && (
          <div ref={sentinelRef} className="h-1" />
        )}
        {(isSearching || isDiscovering) && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-fg-faint">
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
            </svg>
            {isSearching ? 'Searching LinkedIn...' : 'Loading more...'}
          </div>
        )}
      </div>
      {!compact && <div className="flex items-center justify-between border-t border-edge px-4 py-2 text-xs text-fg-faint">
        <button
          onClick={() => useUIStore.getState().toggleShortcutOverlay()}
          className="flex items-center gap-1.5 text-fg-faint transition-colors hover:text-fg-muted"
        >
          Keyboard Shortcuts
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px]">shift</kbd>
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px]">?</kbd>
        </button>
        <SyncStatusIndicator accountName={accountName} onOpenDebug={onOpenDebug} />
      </div>}
      {contextMenu && (
        <ConversationContextMenu
          conversation={contextMenu.conversation}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

const STAR_ICON = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const ARCHIVE_ICON = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="5" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </svg>
);

const UNARCHIVE_ICON = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="5" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h2" />
    <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
    <path d="m9 15 3-3 3 3" />
    <path d="M12 12v9" />
  </svg>
);
