import { useState, useEffect, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import { sendBridgeMessage } from '@/lib/bridge';
import { useUIStore } from '@/store/ui-store';
import type { Conversation } from '@/types/conversation';

/**
 * Hook that performs remote LinkedIn search with debounce and pagination.
 *
 * When searchQuery changes: resets state, waits 400ms, fires SEARCH_CONVERSATIONS.
 * Provides loadMore() for cursor-based pagination.
 * Reads results from IndexedDB (the background handler stores them there).
 */
export function useRemoteSearch() {
  const searchQuery = useUIStore((s) => s.searchQuery);
  const dbGen = useDbGeneration();
  const [resultIds, setResultIds] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const searchIdRef = useRef(0);

  // Reset and fire search when query changes
  useEffect(() => {
    // Reset state
    setResultIds([]);
    setIsSearching(false);
    setHasMore(false);
    cursorRef.current = null;

    if (!searchQuery) return;

    const currentSearchId = ++searchIdRef.current;
    setIsSearching(true);

    const timer = setTimeout(async () => {
      try {
        const res = await sendBridgeMessage({
          type: 'SEARCH_CONVERSATIONS',
          query: searchQuery,
        });
        // Stale check: if user typed more, discard this result
        if (searchIdRef.current !== currentSearchId) return;

        if (res.success && res.data) {
          setResultIds(res.data.conversationIds);
          cursorRef.current = res.data.nextCursor;
          setHasMore(!!res.data.nextCursor);
        }
      } catch {
        // Search failed — silently ignore
      } finally {
        if (searchIdRef.current === currentSearchId) {
          setIsSearching(false);
        }
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load next page of results — use a ref to guard against concurrent calls
  // so we don't need isSearching in the dependency array (which would make
  // the callback identity unstable on every search cycle).
  const isLoadingMoreRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (!searchQuery || !cursorRef.current || isLoadingMoreRef.current) return;

    const currentSearchId = searchIdRef.current;
    isLoadingMoreRef.current = true;
    setIsSearching(true);

    try {
      const res = await sendBridgeMessage({
        type: 'SEARCH_CONVERSATIONS',
        query: searchQuery,
        cursor: cursorRef.current,
      });
      if (searchIdRef.current !== currentSearchId) return;

      if (res.success && res.data) {
        setResultIds((prev) => {
          const existing = new Set(prev);
          const newIds = res.data.conversationIds.filter((id: string) => !existing.has(id));
          return [...prev, ...newIds];
        });
        cursorRef.current = res.data.nextCursor;
        setHasMore(!!res.data.nextCursor);
      }
    } catch {
      // Pagination failed — silently ignore
    } finally {
      isLoadingMoreRef.current = false;
      if (searchIdRef.current === currentSearchId) {
        setIsSearching(false);
      }
    }
  }, [searchQuery]);

  // Read the actual Conversation objects from IndexedDB by their IDs
  const remoteResults = useLiveQuery(async () => {
    if (resultIds.length === 0 || !db) return [];
    const convs = await db.conversations.bulkGet(resultIds);
    return convs.filter((c): c is Conversation => c !== undefined);
  }, [resultIds, dbGen]) ?? [];

  return { remoteResults, isSearching, hasMore, loadMore };
}
