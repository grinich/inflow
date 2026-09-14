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
  const loadingMoreSearchIdRef = useRef<number | null>(null);

  // Reset and fire search when query changes
  useEffect(() => {
    const currentSearchId = ++searchIdRef.current;
    // Reset state
    setResultIds([]);
    setIsSearching(false);
    setHasMore(false);
    cursorRef.current = null;
    loadingMoreSearchIdRef.current = null;

    if (!searchQuery) return;

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

    return () => {
      clearTimeout(timer);
      // Also invalidate requests that have already passed the debounce. Clearing
      // search, switching accounts, or unmounting must discard their responses.
      searchIdRef.current++;
    };
  }, [searchQuery, dbGen]);

  // Load next page of results — use a ref to guard against concurrent calls
  // so we don't need isSearching in the dependency array (which would make
  // the callback identity unstable on every search cycle).
  const loadMore = useCallback(async () => {
    const currentSearchId = searchIdRef.current;
    if (!searchQuery || !cursorRef.current || loadingMoreSearchIdRef.current === currentSearchId) return;

    loadingMoreSearchIdRef.current = currentSearchId;
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
          return [...new Set([...prev, ...res.data.conversationIds])];
        });
        cursorRef.current = res.data.nextCursor;
        setHasMore(!!res.data.nextCursor);
      }
    } catch {
      // Pagination failed — silently ignore
    } finally {
      if (loadingMoreSearchIdRef.current === currentSearchId) {
        loadingMoreSearchIdRef.current = null;
      }
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
