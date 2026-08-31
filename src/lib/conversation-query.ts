/**
 * The conversation-list query pipeline, extracted from useConversations so it
 * can run outside React (agent tools, tests). The hook composes these; the
 * per-tab queries here are the authority that belongsToTab (inbox-filters)
 * mirrors. Behavior is pinned by test/unit/conversation-query.test.ts — any
 * change here must keep the hook's semantics bit-for-bit.
 */

import Dexie from 'dexie';
import type { InflowDatabase } from '@/db/database';
import { isFocusedCategory } from '@/lib/inbox-filters';
import type { Conversation } from '@/types/conversation';
import type { InboxTab } from '@/store/ui-store';

/** The tab's conversations, newest first, before dedup and search filtering. */
export async function queryTabConversations(
  db: InflowDatabase,
  tab: InboxTab
): Promise<Conversation[]> {
  if (tab === 'focused') {
    // Use the original proven index for Focused inbox
    const results = await db.conversations
      .where('[archived+lastActivityAt]')
      .between([0, Dexie.minKey], [0, Dexie.maxKey])
      .reverse()
      .toArray();
    // Further filter out conversations that are in Other (SECONDARY_INBOX).
    // Shared with the toolbar badge (see inbox-filters) so counts agree.
    return results.filter((c) => isFocusedCategory(c.category));
  }
  if (tab === 'other') {
    return db.conversations
      .where('[category+lastActivityAt]')
      .between(['SECONDARY_INBOX', Dexie.minKey], ['SECONDARY_INBOX', Dexie.maxKey])
      .reverse()
      .toArray();
  }
  if (tab === 'archived') {
    return db.conversations
      .where('[archived+lastActivityAt]')
      .between([1, Dexie.minKey], [1, Dexie.maxKey])
      .reverse()
      .toArray();
  }
  if (tab === 'spam') {
    return db.conversations
      .where('[category+lastActivityAt]')
      .between(['SPAM', Dexie.minKey], ['SPAM', Dexie.maxKey])
      .reverse()
      .toArray();
  }
  return [];
}

/**
 * Deduplicate 1:1 conversations that share the same participant URN.
 * LinkedIn can create multiple threads with the same person (InMail,
 * message requests, system migrations). Merge them into the most recent one.
 *
 * Mutates the surviving row in place (read/starred propagation, mergedIds) —
 * same semantics the list has always had.
 */
export function mergeDuplicateConversations(results: Conversation[]): Conversation[] {
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
    return results.filter((_, i) => !toRemove.has(i));
  }
  return results;
}

/**
 * IDs of the other 1:1 threads with the same person — the rows
 * mergeDuplicateConversations would fold into this one. Uses the multiEntry
 * participantUrns index (v15), so it's a lookup, not a scan.
 */
export async function findMergedSiblingIds(
  db: InflowDatabase,
  conversation: Conversation
): Promise<string[]> {
  if (conversation.participantUrns.length !== 1) return []; // groups never merge
  const twins = await db.conversations
    .where('participantUrns')
    .equals(conversation.participantUrns[0])
    .toArray();
  return twins
    .filter((c) => c.id !== conversation.id && c.participantUrns.length === 1)
    .map((c) => c.id);
}

export interface ParsedSearch {
  /** Free text left after stripping filter tokens, spaces collapsed. */
  text: string;
  filters: {
    attachments?: true;
    unread?: true;
    starred?: true;
    read?: true;
    group?: true;
    draft?: true;
    fromName?: string;
    afterTs?: number;
    beforeTs?: number;
  };
}

/**
 * Parse the search grammar: free text plus `has:draft`, `has:attachment`,
 * `is:unread`, `is:starred`, `is:read`, `is:group`, `from:<name>`,
 * `after:`/`before:YYYY-MM-DD`, `newer:`/`older:<N>d`. Case-insensitive.
 * `now` exists so relative-date tokens are testable.
 */
export function parseSearchQuery(raw: string, now = Date.now()): ParsedSearch {
  let q = raw;
  const filters: ParsedSearch['filters'] = {};

  if (/has:draft/i.test(q)) {
    filters.draft = true;
    q = q.replace(/has:draft/gi, '').trim();
  }

  if (/has:attachment/i.test(q)) {
    filters.attachments = true;
    q = q.replace(/has:attachment/gi, '').trim();
  }

  if (/is:unread/i.test(q)) {
    filters.unread = true;
    q = q.replace(/is:unread/gi, '').trim();
  }

  if (/is:starred/i.test(q)) {
    filters.starred = true;
    q = q.replace(/is:starred/gi, '').trim();
  }

  if (/is:read/i.test(q)) {
    filters.read = true;
    q = q.replace(/is:read/gi, '').trim();
  }

  if (/is:group/i.test(q)) {
    filters.group = true;
    q = q.replace(/is:group/gi, '').trim();
  }

  const fromMatch = q.match(/from:(\S+)/i);
  if (fromMatch) {
    filters.fromName = fromMatch[1].toLowerCase();
    q = q.replace(/from:\S+/gi, '').trim();
  }

  const afterMatch = q.match(/after:(\d{4}-\d{2}-\d{2})/i);
  if (afterMatch) {
    const t = Date.parse(afterMatch[1]);
    if (!Number.isNaN(t)) filters.afterTs = t; // ignore impossible dates (e.g. 2026-13-40)
    q = q.replace(/after:\d{4}-\d{2}-\d{2}/gi, '').trim();
  }

  const beforeMatch = q.match(/before:(\d{4}-\d{2}-\d{2})/i);
  if (beforeMatch) {
    const t = Date.parse(beforeMatch[1]);
    if (!Number.isNaN(t)) filters.beforeTs = t;
    q = q.replace(/before:\d{4}-\d{2}-\d{2}/gi, '').trim();
  }

  const newerMatch = q.match(/newer:(\d+)d/i);
  if (newerMatch) {
    filters.afterTs = now - parseInt(newerMatch[1], 10) * 86400000;
    q = q.replace(/newer:\d+d/gi, '').trim();
  }

  const olderMatch = q.match(/older:(\d+)d/i);
  if (olderMatch) {
    filters.beforeTs = now - parseInt(olderMatch[1], 10) * 86400000;
    q = q.replace(/older:\d+d/gi, '').trim();
  }

  // Token strips above leave doubled internal spaces ("project is:unread
  // update" → "project  update"); collapse them like stripFilterTokens
  // does, or a mid-query token makes the free-text match nothing while
  // the highlighter (which uses stripFilterTokens) highlights it anyway.
  q = q.replace(/\s+/g, ' ').trim();

  return { text: q, filters };
}

/**
 * Apply a parsed search to a result list, in the exact order the list always
 * has (each step narrows the input to the next).
 *
 * The unread filter has snapshot semantics owned by the CALLER: pass
 * `unreadIdSet` to keep showing a previously-captured set (so rows don't
 * vanish mid-browse as they're read); omit it to filter `read === 0` fresh —
 * the ids that matched come back as `unreadIds` for the caller to snapshot.
 */
export async function applySearchFilters(
  db: InflowDatabase,
  results: Conversation[],
  parsed: ParsedSearch,
  opts?: { unreadIdSet?: Set<string> }
): Promise<{ results: Conversation[]; unreadIds: Set<string> | null }> {
  const { filters } = parsed;
  let unreadIds: Set<string> | null = null;

  if (filters.attachments) {
    results = results.filter((c) => c.hasAttachments === 1);
  }

  if (filters.draft) {
    const allDrafts = await db.draftAttachments.toArray();
    const draftIds = new Set(
      allDrafts
        .filter((d) => (d.text && d.text.length > 0) || (d.files && d.files.length > 0))
        .map((d) => d.conversationId)
    );
    results = results.filter((c) => draftIds.has(c.id));
  }

  if (filters.unread) {
    const snapIds = opts?.unreadIdSet;
    if (snapIds) {
      // Use snapshotted IDs so the list stays stable while browsing
      results = results.filter((c) => snapIds.has(c.id));
    } else {
      results = results.filter((c) => c.read === 0);
      unreadIds = new Set(results.map((c) => c.id));
    }
  }

  if (filters.starred) {
    results = results.filter((c) => c.starred === 1);
  }

  if (filters.read) {
    results = results.filter((c) => c.read === 1);
  }

  if (filters.group) {
    results = results.filter((c) => c.participantUrns.length >= 2);
  }

  if (filters.fromName) {
    const name = filters.fromName;
    results = results.filter((c) =>
      c.participantNames.some((n) => n.toLowerCase().includes(name))
    );
  }

  if (filters.afterTs !== undefined) {
    const ts = filters.afterTs;
    results = results.filter((c) => c.lastActivityAt >= ts);
  }

  if (filters.beforeTs !== undefined) {
    const ts = filters.beforeTs;
    results = results.filter((c) => c.lastActivityAt < ts);
  }

  if (parsed.text) {
    const lower = parsed.text.toLowerCase();
    results = results.filter(
      (c) =>
        c.participantNames.some((n) => n.toLowerCase().includes(lower)) ||
        c.lastMessage.toLowerCase().includes(lower)
    );
  }

  return { results, unreadIds };
}
