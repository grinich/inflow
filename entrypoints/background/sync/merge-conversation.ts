import { db } from '@/db/database';
import { hasPendingAction } from './pending-guard';
import { isMutationSuppressed, shouldSuppressConversationUpdate } from '../realtime/mark-read-suppression';
import type { Conversation } from '@/types/conversation';

/**
 * Merge a server-fetched conversation into the local DB.
 * Preserves local-only fields, respects pending optimistic actions.
 *
 * When a pending action exists (archive, star, move, etc.), we skip
 * overwriting category/archived/read/starred so the optimistic state
 * isn't clobbered by stale server data.
 */
export async function mergeConversation(conv: Conversation): Promise<void> {
  const existing = await db.conversations.get(conv.id);
  if (!existing) {
    await db.conversations.put(conv);
    return;
  }

  // Skip overwriting optimistic fields when (a) an action is still in-flight,
  // (b) we recently mutated category/archived/starred, or (c) we recently marked
  // it read. Otherwise a stale server page clobbers already-confirmed optimistic
  // state (e.g. an archive that pops back into Focused after the action settles).
  const guarded =
    (await hasPendingAction(conv.id)) ||
    isMutationSuppressed(conv.id) ||
    shouldSuppressConversationUpdate(conv.id);

  await db.conversations.update(conv.id, {
    participantUrns: conv.participantUrns?.length > 0 ? conv.participantUrns : existing.participantUrns,
    participantNames: conv.participantNames?.length > 0 ? conv.participantNames : existing.participantNames,
    participantPictures: conv.participantPictures?.length > 0 ? conv.participantPictures : existing.participantPictures,
    lastMessage: conv.lastMessage || existing.lastMessage,
    lastActivityAt: Math.max(conv.lastActivityAt, existing.lastActivityAt),
    ...(guarded ? {} : {
      category: conv.category,
      archived: conv.archived,
      read: conv.read,
      starred: conv.starred ?? existing.starred,
    }),
  });
}
