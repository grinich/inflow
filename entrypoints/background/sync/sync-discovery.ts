import { fetchConversationsPage, type InboxCategory } from '../api/conversations';
import { getMemberUrn } from '../auth/session';
import { normalizeConversations } from '@/lib/voyager-normalizer';
import { debugLog } from '@/lib/debug-log';
import { db, mergeProfiles, type SyncQueueItem } from '@/db/database';
import { mergeConversation } from './merge-conversation';
import { getBackfillCutoff } from '@/lib/sync-settings';
import type { ServerConversation } from '@/types/conversation';
import type { Profile } from '@/types/profile';

export interface DiscoveryResult {
  conversations: ServerConversation[];
  profiles: Profile[];
  isLastPage: boolean;
  nextCursor: string | null;
}

/**
 * Discover one page of conversations for a category using cursor pagination.
 *
 * @param category - The inbox category to discover
 * @param cursor - The cursor string from a previous page, or null for page 1
 * @returns Normalized conversations/profiles, whether this is the last page,
 *          and the nextCursor to pass for the following page.
 */
export async function discoverPage(
  category: InboxCategory,
  cursor: string | null
): Promise<DiscoveryResult> {
  const memberUrn = await getMemberUrn();

  const { response: raw, nextCursor } = await fetchConversationsPage(category, cursor);
  const { conversations: allConversations, profiles: allProfiles } = normalizeConversations(raw, memberUrn);

  const isLastPage = !nextCursor;

  debugLog(
    'info',
    `[DISCOVERY] ${category}: ${allConversations.length} conversations, cursor=${cursor ? '...' + cursor.slice(-12) : 'null'}, isLastPage=${isLastPage}`
  );

  // Store conversations and profiles to main tables.
  // Use merge logic to avoid overwriting existing data with empty values.
  if (allConversations.length > 0 || allProfiles.length > 0) {
    const profileMap = new Map<string, Profile>();
    for (const p of allProfiles) {
      profileMap.set(p.urn, p);
    }
    const dedupedProfiles = [...profileMap.values()];

    await db.transaction('rw', [db.conversations, db.profiles, db.pendingActions, db.tombstones], async () => {
      if (dedupedProfiles.length > 0) {
        await mergeProfiles(dedupedProfiles);
      }
      for (const conv of allConversations) {
        await mergeConversation(conv);
      }
    });
  }


  return { conversations: allConversations, profiles: allProfiles, isLastPage, nextCursor };
}

/**
 * For each discovered conversation, insert or update its sync queue entry.
 * - New conversations: insert with status 'pending'
 * - Existing but stale (new activity since last message sync): reset to 'pending'
 * - Already up-to-date: skip
 */
export async function enqueueConversations(
  conversations: ServerConversation[],
  category: InboxCategory
): Promise<{ enqueued: number; skipped: number }> {
  let enqueued = 0;
  let skipped = 0;

  // Get cutoff timestamp — conversations older than this skip message backfill
  const cutoff = await getBackfillCutoff();

  await db.transaction('rw', db.syncQueue, async () => {
    for (const conv of conversations) {
      const existing = await db.syncQueue.get(conv.id);
      const tooOld = cutoff > 0 && conv.lastActivityAt < cutoff;
      // Prefer the conversation's OWN category over the category being
      // discovered — a conversation can be seen by several discoveries, and
      // stamping the discoverer's category churned queue items between
      // categories and skewed per-category completion accounting.
      // Legacy 'INBOX' rows normalize to PRIMARY_INBOX.
      const itemCategory =
        conv.category === 'INBOX' ? 'PRIMARY_INBOX' : conv.category || category;

      if (!existing) {
        // New conversation — add to queue
        const item: SyncQueueItem = {
          conversationId: conv.id,
          category: itemCategory,
          lastActivityAt: conv.lastActivityAt,
          messagesSyncedAt: 0,
          status: tooOld ? 'done' : 'pending',
          failCount: 0,
          lastFailedAt: 0,
          priority: Number.MAX_SAFE_INTEGER - conv.lastActivityAt,
        };
        await db.syncQueue.put(item);
        if (tooOld) skipped++;
        else enqueued++;
      } else if (
        conv.lastActivityAt > existing.messagesSyncedAt &&
        existing.status !== 'pending' &&
        existing.status !== 'syncing' &&
        !tooOld
      ) {
        // Conversation has new activity since last message sync — re-queue with
        // a fresh retry budget (a previously-failed item gets its full retries again).
        await db.syncQueue.update(conv.id, {
          status: 'pending',
          lastActivityAt: conv.lastActivityAt,
          priority: Number.MAX_SAFE_INTEGER - conv.lastActivityAt,
          category: itemCategory,
          failCount: 0,
          lastFailedAt: 0,
        });
        enqueued++;
      } else {
        // Update lastActivityAt if newer, but don't re-queue
        if (conv.lastActivityAt > existing.lastActivityAt) {
          await db.syncQueue.update(conv.id, {
            lastActivityAt: conv.lastActivityAt,
            category: itemCategory,
          });
        }
        skipped++;
      }
    }
  });

  debugLog(
    'info',
    `[DISCOVERY] Enqueued ${enqueued}, skipped ${skipped} for ${category}`
  );
  return { enqueued, skipped };
}
