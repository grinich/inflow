import { db, TOMBSTONE_TTL_MS } from '@/db/database';
import { hasPendingAction } from './pending-guard';
import { isMutationSuppressed, shouldSuppressConversationUpdate } from '../realtime/mark-read-suppression';
import type { ServerConversation } from '@/types/conversation';

/**
 * Merge a server-fetched conversation into the local DB.
 * Preserves local-only fields, respects pending optimistic actions.
 *
 * When a pending action exists (archive, star, move, etc.), we skip
 * overwriting category/archived/read/starred so the optimistic state
 * isn't clobbered by stale server data.
 *
 * Every merge stamps seenInSyncAt / resets missedSyncCycles — the deletion
 * sweep uses these to detect conversations the server stopped returning.
 */
export async function mergeConversation(conv: ServerConversation): Promise<void> {
  const existing = await db.conversations.get(conv.id);
  if (!existing) {
    // A recent local delete leaves a tombstone: a page fetched before the
    // delete must not resurrect the conversation. Expired tombstones are
    // cleared and no longer block (the server stops returning deleted
    // conversations long before the TTL).
    const tombstone = await db.tombstones.get(conv.id);
    if (tombstone) {
      if (Date.now() - tombstone.deletedAt < TOMBSTONE_TTL_MS) return;
      await db.tombstones.delete(conv.id);
    }
    // Fields a sparse payload omitted get safe defaults on first insert.
    // (Also normalizes starred so a new row is never stored with
    // starred=undefined, which drops it from the starred index.)
    await db.conversations.put({
      ...conv,
      read: conv.read ?? 1,
      archived: conv.archived ?? 0,
      category: conv.category ?? 'PRIMARY_INBOX',
      starred: conv.starred ?? 0,
      seenInSyncAt: Date.now(),
      missedSyncCycles: 0,
    });
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

  // A page older than local state describes the conversation BEFORE whatever
  // moved lastActivityAt forward (e.g. an SSE message that landed while the
  // page was in flight) — its flags and preview are stale. Equal timestamps
  // must still apply: cross-device read changes don't bump lastActivityAt.
  const fresh = conv.lastActivityAt >= existing.lastActivityAt;

  await db.conversations.update(conv.id, {
    participantUrns: conv.participantUrns?.length > 0 ? conv.participantUrns : existing.participantUrns,
    participantNames: conv.participantNames?.length > 0 ? conv.participantNames : existing.participantNames,
    participantPictures: conv.participantPictures?.length > 0 ? conv.participantPictures : existing.participantPictures,
    lastMessage: fresh && conv.lastMessage ? conv.lastMessage : existing.lastMessage,
    lastActivityAt: Math.max(conv.lastActivityAt, existing.lastActivityAt),
    seenInSyncAt: Date.now(),
    missedSyncCycles: 0,
    ...(guarded || !fresh ? {} : {
      // Fields the payload omitted (undefined) are unknown, not falsy —
      // keep the existing local value rather than fabricating state.
      ...(conv.category !== undefined ? { category: conv.category } : {}),
      ...(conv.archived !== undefined ? { archived: conv.archived } : {}),
      ...(conv.read !== undefined ? { read: conv.read } : {}),
      // `starred` is a local-only field (matching the original sync design). A
      // category-filtered server page may omit the STARRED overlay even for a
      // starred thread, so NEVER downgrade a star from a poll — only upgrade
      // 0→1 when the server affirmatively reports it. Un-starring happens via the
      // optimistic STAR/UNSTAR action, never via a server merge.
      starred: conv.starred === 1 ? 1 : existing.starred,
    }),
  });
}
