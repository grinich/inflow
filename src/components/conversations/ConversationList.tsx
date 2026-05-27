import { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';
import { ConversationListHeader } from './ConversationListHeader';
import { ConversationRow } from './ConversationRow';
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
}

export function ConversationList({ conversations, isLoading, isDiscovering, category, isSearching, hasMoreSearchResults, onLoadMoreSearch, onOpenDebug }: ConversationListProps) {
  const selectedConversationId = useUIStore((s) => s.selectedConversationId);
  const openThread = useUIStore((s) => s.openThread);
  const { markRead, archiveConversation } = useOptimisticAction();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef(0);
  const prefetchedRef = useRef<Set<string>>(new Set());
  const inboxTab = useUIStore((s) => s.inboxTab);

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
  }, [isDiscovering, category, hasMoreSearchResults, onLoadMoreSearch]);

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
      sendBridgeMessage({ type: 'PREFETCH_MESSAGES', conversationIds: uncached }).catch(() => {});
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

    sendBridgeMessage({ type: 'PREFETCH_MESSAGES', conversationIds: uncached }).catch(() => {});
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

  function handleRowClick(conv: Conversation, index: number) {
    if (conv.draft === 1) {
      const store = useUIStore.getState();
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
    openThread(conv.id, index);
    markRead(conv.id);
  }

  const [accountName, setAccountName] = useState<string | undefined>();
  useEffect(() => {
    try {
      setAccountName(localStorage.getItem('inflow-account-name') || undefined);
    } catch {}
  }, []);


  return (
    <div className="flex h-full flex-col">
      <ConversationListHeader conversationCount={conversations.length} />
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto overscroll-contain">
        {conversations.length === 0 ? null : (
          <>
            {conversations.map((conv, i) => (
              <ConversationRow
                key={conv.id}
                conversation={conv}
                selected={conv.id === selectedConversationId}
                onClick={() => handleRowClick(conv, i)}
                // onArchive={() => archiveConversation(conv)}
              />
            ))}
            <div ref={sentinelRef} className="h-1" />
            {(isSearching || isDiscovering) && (
              <div className="flex items-center justify-center gap-2 py-3 text-xs text-fg-faint">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="8" cy="8" r="6" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
                </svg>
                {isSearching ? 'Searching LinkedIn...' : 'Loading more...'}
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-edge px-4 py-2 text-xs text-fg-faint">
        <button
          onClick={() => useUIStore.getState().toggleShortcutOverlay()}
          className="flex items-center gap-1.5 text-fg-faint transition-colors hover:text-fg-muted"
        >
          Keyboard Shortcuts
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px]">shift</kbd>
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px]">?</kbd>
        </button>
        <SyncStatusIndicator accountName={accountName} onOpenDebug={onOpenDebug} />
      </div>
    </div>
  );
}
