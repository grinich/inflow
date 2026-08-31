import { useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import {
  applySearchFilters,
  mergeDuplicateConversations,
  parseSearchQuery,
  queryTabConversations,
} from '@/lib/conversation-query';
import { useUIStore, type InboxTab } from '@/store/ui-store';
import type { Conversation } from '@/types/conversation';

/** Map UI tab to LinkedIn API category for sync state lookup. */
const TAB_TO_CATEGORY: Record<InboxTab, string> = {
  focused: 'PRIMARY_INBOX',
  other: 'SECONDARY_INBOX',
  archived: 'ARCHIVE',
  spam: 'SPAM',
};

export function useConversations() {
  const searchQuery = useUIStore((s) => s.searchQuery);
  const inboxTab = useUIStore((s) => s.inboxTab);
  // Re-subscribe queries when the DB opens/switches — a query that ran while
  // `db` was null observed no tables and would stay blank forever otherwise.
  const dbGen = useDbGeneration();

  // Snapshot filter results so the list stays stable while browsing.
  // e.g. `is:unread` captures matching IDs on first run; subsequent live-query
  // re-runs (triggered by markRead) keep showing those same conversations.
  const filterSnapshotRef = useRef<{ query: string; tab: InboxTab; ids: Set<string> } | null>(null);

  // Per-tab result memory: on a tab switch, useLiveQuery keeps returning the
  // PREVIOUS tab's rows until the fresh query resolves — the list briefly
  // showed the wrong folder's content. Detect that stale window (tab changed
  // but the value identity hasn't) and serve the target tab's own previous
  // results synchronously instead. Not used while searching.
  const lastResultsRef = useRef(new Map<InboxTab, Conversation[]>());
  const lastSeenRef = useRef<{ tab: InboxTab; value: Conversation[] | undefined }>({
    tab: inboxTab,
    value: undefined,
  });

  const conversations = useLiveQuery(async () => {
    if (!db) return [];
    // Drop any stale is:unread snapshot once the search box is cleared, so a
    // later identical 'is:unread' query rebuilds a fresh set instead of reusing
    // conversations that have since been read.
    if (!searchQuery) filterSnapshotRef.current = null;

    let results = mergeDuplicateConversations(await queryTabConversations(db, inboxTab));

    if (searchQuery) {
      const parsed = parseSearchQuery(searchQuery);
      // The unread snapshot lives here, not in conversation-query: only the
      // hook knows the query/tab it was captured for and when to invalidate.
      const snap = filterSnapshotRef.current;
      const useSnapshot =
        parsed.filters.unread && snap && snap.query === searchQuery && snap.tab === inboxTab;
      const filtered = await applySearchFilters(
        db,
        results,
        parsed,
        useSnapshot ? { unreadIdSet: snap.ids } : undefined
      );
      if (filtered.unreadIds) {
        filterSnapshotRef.current = { query: searchQuery, tab: inboxTab, ids: filtered.unreadIds };
      }
      results = filtered.results;
    }

    return results;
  }, [searchQuery, inboxTab, dbGen]);

  // Check if discovery is in progress for the current tab's category
  const category = TAB_TO_CATEGORY[inboxTab];
  const isDiscovering = useLiveQuery(async () => {
    if (!db) return false;
    const state = await db.syncState.get(category);
    return state?.phase === 'discovering';
  }, [category, dbGen]);

  let effective = conversations;
  if (!searchQuery) {
    const stale =
      lastSeenRef.current.tab !== inboxTab && conversations === lastSeenRef.current.value;
    if (stale) {
      // The live query hasn't caught up with the tab switch yet — the current
      // value belongs to the previous tab. Show this tab's own last results.
      effective = lastResultsRef.current.get(inboxTab);
    } else {
      lastSeenRef.current = { tab: inboxTab, value: conversations };
      if (conversations !== undefined) lastResultsRef.current.set(inboxTab, conversations);
    }
  } else {
    // Keep the identity tracker current while searching too — but never store
    // search results as a tab's own content. setInboxTab clears the query and
    // switches the tab in ONE update; with a tracker frozen at the pre-search
    // value, the first post-switch render compared the still-pending SEARCH
    // results against it, read "not stale", and showed the old tab's search
    // leftovers as the new tab's content.
    lastSeenRef.current = { tab: inboxTab, value: conversations };
  }

  return {
    conversations: effective ?? [],
    isLoading: effective === undefined,
    isDiscovering: isDiscovering ?? false,
    category,
  };
}
