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
  isDiscovering?: boolean;
  category: string;
  isSearching?: boolean;
  hasMoreSearchResults?: boolean;
  onLoadMoreSearch?: () => void;
  onOpenDebug?: () => void;
}

export function ConversationList({ conversations, isDiscovering, category, isSearching, hasMoreSearchResults, onLoadMoreSearch, onOpenDebug }: ConversationListProps) {
  const selectedConversationId = useUIStore((s) => s.selectedConversationId);
  const openThread = useUIStore((s) => s.openThread);
  const theme = useUIStore((s) => s.theme);
  const cycleTheme = useUIStore((s) => s.cycleTheme);
  const { markRead, archiveConversation } = useOptimisticAction();
  const [errorCount, setErrorCount] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastTriggerRef = useRef(0);
  const prefetchedRef = useRef<Set<string>>(new Set());

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

  // Poll for error count from background logs
  useEffect(() => {
    const check = async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'GET_DEBUG_LOGS' });
        if (res?.success) {
          setErrorCount((res.data || []).filter((l: any) => l.level === 'error').length);
        }
      } catch {}
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, []);

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

  const themeIcon = theme === 'dark' ? '\u263E' : theme === 'light' ? '\u2600' : '\u25D0';
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System';

  return (
    <div className="flex h-full flex-col">
      <ConversationListHeader conversationCount={conversations.length} />
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-fg-muted">
            <p className="text-sm">No conversations</p>
            <p className="mt-1 text-xs">Your LinkedIn messages will appear here</p>
          </div>
        ) : (
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
        <SyncStatusIndicator />
        <div className="flex items-center gap-3">
          <button
            onClick={cycleTheme}
            className="text-fg-faint transition-colors hover:text-fg-secondary"
            title={`Theme: ${themeLabel}`}
          >
            {themeIcon} theme
          </button>
          {onOpenDebug && (
            <button
              onClick={onOpenDebug}
              className={`flex items-center gap-1 transition-colors ${
                errorCount > 0
                  ? 'text-red-400 hover:text-red-300'
                  : 'text-fg-faint hover:text-fg-secondary'
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 5v3.5" />
                <circle cx="8" cy="11" r="0.5" fill="currentColor" />
              </svg>
              {errorCount > 0 ? `${errorCount} error${errorCount !== 1 ? 's' : ''}` : 'debug'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
