import { useRef } from 'react';
import Dexie from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { isFocusedCategory } from '@/lib/inbox-filters';
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
    let results: Conversation[];

    if (inboxTab === 'focused') {
      // Use the original proven index for Focused inbox
      results = await db.conversations
        .where('[archived+lastActivityAt]')
        .between([0, Dexie.minKey], [0, Dexie.maxKey])
        .reverse()
        .toArray();
      // Further filter out conversations that are in Other (SECONDARY_INBOX).
      // Shared with the toolbar badge (see inbox-filters) so counts agree.
      results = results.filter((c) => isFocusedCategory(c.category));
    } else if (inboxTab === 'other') {
      results = await db.conversations
        .where('[category+lastActivityAt]')
        .between(['SECONDARY_INBOX', Dexie.minKey], ['SECONDARY_INBOX', Dexie.maxKey])
        .reverse()
        .toArray();
    } else if (inboxTab === 'archived') {
      results = await db.conversations
        .where('[archived+lastActivityAt]')
        .between([1, Dexie.minKey], [1, Dexie.maxKey])
        .reverse()
        .toArray();
    } else if (inboxTab === 'spam') {
      results = await db.conversations
        .where('[category+lastActivityAt]')
        .between(['SPAM', Dexie.minKey], ['SPAM', Dexie.maxKey])
        .reverse()
        .toArray();
    } else {
      results = [];
    }

    // Deduplicate 1:1 conversations that share the same participant URN.
    // LinkedIn can create multiple threads with the same person (InMail,
    // message requests, system migrations). Merge them into the most recent one.
    {
      const byParticipant = new Map<string, number[]>();
      for (let i = 0; i < results.length; i++) {
        const c = results[i];
        if (c.participantUrns.length !== 1) continue; // skip group convs
        const key = c.participantUrns[0];
        const indices = byParticipant.get(key);
        if (indices) indices.push(i);
        else byParticipant.set(key, [i]);
      }

      const toRemove = new Set<number>();
      for (const indices of byParticipant.values()) {
        if (indices.length < 2) continue;
        // Sort by lastActivityAt descending — first one wins
        indices.sort((a, b) => results[b].lastActivityAt - results[a].lastActivityAt);
        const primary = results[indices[0]];
        const mergedIds: string[] = [];
        for (let j = 1; j < indices.length; j++) {
          const other = results[indices[j]];
          mergedIds.push(other.id);
          // Preserve unread/starred from merged conversations
          if (other.read === 0) primary.read = 0;
          if (other.starred === 1) primary.starred = 1;
        }
        primary.mergedIds = mergedIds;
        for (let j = 1; j < indices.length; j++) toRemove.add(indices[j]);
      }

      if (toRemove.size > 0) {
        results = results.filter((_, i) => !toRemove.has(i));
      }
    }

    if (searchQuery) {
      let q = searchQuery;
      let requireAttachments = false;
      let requireUnread = false;
      let requireStarred = false;
      let requireRead = false;
      let requireGroup = false;
      let requireDraft = false;
      let fromName: string | null = null;
      let companyFilter: string | null = null;
      let afterTs: number | null = null;
      let beforeTs: number | null = null;

      // Parse has:draft filter (case-insensitive)
      if (/has:draft/i.test(q)) {
        requireDraft = true;
        q = q.replace(/has:draft/gi, '').trim();
      }

      // Parse has:attachment filter (case-insensitive)
      if (/has:attachment/i.test(q)) {
        requireAttachments = true;
        q = q.replace(/has:attachment/gi, '').trim();
      }

      // Parse is:unread filter (case-insensitive)
      if (/is:unread/i.test(q)) {
        requireUnread = true;
        q = q.replace(/is:unread/gi, '').trim();
      }

      // Parse is:starred filter
      if (/is:starred/i.test(q)) {
        requireStarred = true;
        q = q.replace(/is:starred/gi, '').trim();
      }

      // Parse is:read filter
      if (/is:read/i.test(q)) {
        requireRead = true;
        q = q.replace(/is:read/gi, '').trim();
      }

      // Parse is:group filter
      if (/is:group/i.test(q)) {
        requireGroup = true;
        q = q.replace(/is:group/gi, '').trim();
      }

      // Parse from:name filter
      const fromMatch = q.match(/from:(\S+)/i);
      if (fromMatch) {
        fromName = fromMatch[1].toLowerCase();
        q = q.replace(/from:\S+/gi, '').trim();
      }

      // Parse company:name filter
      const companyMatch = q.match(/company:(\S+)/i);
      if (companyMatch) {
        companyFilter = companyMatch[1].toLowerCase();
        q = q.replace(/company:\S+/gi, '').trim();
      }

      // Parse after:YYYY-MM-DD filter
      const afterMatch = q.match(/after:(\d{4}-\d{2}-\d{2})/i);
      if (afterMatch) {
        const t = Date.parse(afterMatch[1]);
        if (!Number.isNaN(t)) afterTs = t; // ignore impossible dates (e.g. 2026-13-40)
        q = q.replace(/after:\d{4}-\d{2}-\d{2}/gi, '').trim();
      }

      // Parse before:YYYY-MM-DD filter
      const beforeMatch = q.match(/before:(\d{4}-\d{2}-\d{2})/i);
      if (beforeMatch) {
        const t = Date.parse(beforeMatch[1]);
        if (!Number.isNaN(t)) beforeTs = t;
        q = q.replace(/before:\d{4}-\d{2}-\d{2}/gi, '').trim();
      }

      // Parse newer:Nd filter (e.g. newer:7d)
      const newerMatch = q.match(/newer:(\d+)d/i);
      if (newerMatch) {
        afterTs = Date.now() - parseInt(newerMatch[1], 10) * 86400000;
        q = q.replace(/newer:\d+d/gi, '').trim();
      }

      // Parse older:Nd filter (e.g. older:30d)
      const olderMatch = q.match(/older:(\d+)d/i);
      if (olderMatch) {
        beforeTs = Date.now() - parseInt(olderMatch[1], 10) * 86400000;
        q = q.replace(/older:\d+d/gi, '').trim();
      }

      if (requireAttachments) {
        results = results.filter((c) => c.hasAttachments === 1);
      }

      if (requireDraft) {
        const allDrafts = await db.draftAttachments.toArray();
        const draftIds = new Set(
          allDrafts
            .filter((d) => (d.text && d.text.length > 0) || (d.files && d.files.length > 0))
            .map((d) => d.conversationId)
        );
        results = results.filter((c) => draftIds.has(c.id));
      }

      if (requireUnread) {
        const snap = filterSnapshotRef.current;
        if (snap && snap.query === searchQuery && snap.tab === inboxTab) {
          // Use snapshotted IDs so the list stays stable while browsing
          results = results.filter((c) => snap.ids.has(c.id));
        } else {
          results = results.filter((c) => c.read === 0);
          filterSnapshotRef.current = {
            query: searchQuery,
            tab: inboxTab,
            ids: new Set(results.map((c) => c.id)),
          };
        }
      }

      if (requireStarred) {
        results = results.filter((c) => c.starred === 1);
      }

      if (requireRead) {
        results = results.filter((c) => c.read === 1);
      }

      if (requireGroup) {
        results = results.filter((c) => c.participantUrns.length >= 2);
      }

      if (fromName) {
        const name = fromName;
        results = results.filter((c) =>
          c.participantNames.some((n) => n.toLowerCase().includes(name))
        );
      }

      if (companyFilter) {
        const co = companyFilter;
        // Look up profiles for each conversation's participants to check company
        const allUrns = results.flatMap((c) => c.participantUrns);
        const profiles = await db.profiles.where('urn').anyOf(allUrns).toArray();
        const urnToCompany = new Map<string, string>();
        for (const p of profiles) {
          if (p.company) urnToCompany.set(p.urn, p.company.toLowerCase());
        }
        results = results.filter((c) =>
          c.participantUrns.some((urn) => urnToCompany.get(urn)?.includes(co))
        );
      }

      if (afterTs !== null) {
        const ts = afterTs;
        results = results.filter((c) => c.lastActivityAt >= ts);
      }

      if (beforeTs !== null) {
        const ts = beforeTs;
        results = results.filter((c) => c.lastActivityAt < ts);
      }

      if (q) {
        const lower = q.toLowerCase();
        results = results.filter(
          (c) =>
            c.participantNames.some((n) => n.toLowerCase().includes(lower)) ||
            c.lastMessage.toLowerCase().includes(lower)
        );
      }
    }

    return results;
  }, [searchQuery, inboxTab]);

  // Check if discovery is in progress for the current tab's category
  const category = TAB_TO_CATEGORY[inboxTab];
  const isDiscovering = useLiveQuery(async () => {
    if (!db) return false;
    const state = await db.syncState.get(category);
    return state?.phase === 'discovering';
  }, [category]);

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
  }

  return {
    conversations: effective ?? [],
    isLoading: effective === undefined,
    isDiscovering: isDiscovering ?? false,
    category,
  };
}
