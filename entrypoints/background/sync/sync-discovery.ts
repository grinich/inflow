import { fetchConversationsPage, type InboxCategory } from '../api/conversations';
import { getMemberUrn } from '../auth/session';
import { normalizeConversations } from '@/lib/voyager-normalizer';
import { debugLog } from '@/lib/debug-log';
import { db, mergeProfiles, type SyncQueueItem } from '@/db/database';
import { getBackfillCutoff } from '@/lib/sync-settings';
import type { Conversation } from '@/types/conversation';
import type { Profile } from '@/types/profile';

export interface DiscoveryResult {
  conversations: Conversation[];
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

  const isLastPage = allConversations.length === 0 || !nextCursor;

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

    await db.transaction('rw', [db.conversations, db.profiles], async () => {
      if (dedupedProfiles.length > 0) {
        await mergeProfiles(dedupedProfiles);
      }
      for (const conv of allConversations) {
        const existing = await db.conversations.get(conv.id);
        if (existing) {
          // Merge: only update fields that have meaningful values, preserve local-only fields
          await db.conversations.update(conv.id, {
            participantUrns: conv.participantUrns.length > 0 ? conv.participantUrns : existing.participantUrns,
            participantNames: conv.participantNames.length > 0 ? conv.participantNames : existing.participantNames,
            participantPictures: conv.participantPictures.length > 0 ? conv.participantPictures : existing.participantPictures,
            lastMessage: conv.lastMessage || existing.lastMessage,
            lastActivityAt: Math.max(conv.lastActivityAt, existing.lastActivityAt),
            category: conv.category,
            archived: conv.archived,
            starred: existing.starred,
            read: conv.read,
          });
        } else {
          await db.conversations.put(conv);
        }
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
  conversations: Conversation[],
  category: InboxCategory
): Promise<{ enqueued: number; skipped: number }> {
  let enqueued = 0;
  let skipped = 0;

  // Get cutoff timestamp — conversations older than this skip message backfill
  const cutoff = await getBackfillCutoff();

  for (const conv of conversations) {
    const existing = await db.syncQueue.get(conv.id);
    const tooOld = cutoff > 0 && conv.lastActivityAt < cutoff;

    if (!existing) {
      // New conversation — add to queue
      const item: SyncQueueItem = {
        conversationId: conv.id,
        category,
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
      // Conversation has new activity since last message sync — re-queue
      await db.syncQueue.update(conv.id, {
        status: 'pending',
        lastActivityAt: conv.lastActivityAt,
        priority: Number.MAX_SAFE_INTEGER - conv.lastActivityAt,
        category,
      });
      enqueued++;
    } else {
      // Update lastActivityAt if newer, but don't re-queue
      if (conv.lastActivityAt > existing.lastActivityAt) {
        await db.syncQueue.update(conv.id, {
          lastActivityAt: conv.lastActivityAt,
          category,
        });
      }
      skipped++;
    }
  }

  debugLog(
    'info',
    `[DISCOVERY] Enqueued ${enqueued}, skipped ${skipped} for ${category}`
  );
  return { enqueued, skipped };
}
