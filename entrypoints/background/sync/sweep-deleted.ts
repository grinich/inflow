import { db } from '@/db/database';
import { hasPendingAction } from './pending-guard';
import { isMutationSuppressed } from '../realtime/mark-read-suppression';
import { debugLog } from '@/lib/debug-log';

/**
 * A conversation must be missed by this many CONSECUTIVE completed discoveries
 * before it is deleted locally. One flaky/incomplete page must not mass-delete
 * real conversations — a single miss only records a strike, and any server
 * merge (mergeConversation) resets the counter.
 */
const STRIKES_BEFORE_DELETE = 2;

/**
 * Remove local conversations the server stopped returning (deleted on another
 * device / the LinkedIn website). Called after a category's discovery has
 * FULLY paginated (genuine last page reached).
 *
 * A row of the swept category is a candidate only when:
 * - it was not stamped by a server merge since the discovery started
 *   (mergeConversation sets seenInSyncAt on every merge), and
 * - it has no local activity newer than the discovery start (protects
 *   conversations created by SSE while discovery was running), and
 * - it isn't a draft and has no in-flight/suppressed optimistic action.
 *
 * Candidates accrue a strike per completed discovery; at STRIKES_BEFORE_DELETE
 * the conversation and its messages + sync-queue row are removed.
 */
export async function sweepDeletedConversations(
  category: string,
  discoveryStartedAt: number
): Promise<number> {
  if (!discoveryStartedAt) return 0;

  const rows = await db.conversations.where('category').equals(category).toArray();
  let deleted = 0;

  for (const conv of rows) {
    if ((conv.seenInSyncAt ?? 0) >= discoveryStartedAt) {
      // Server still returns it — clear any stale strikes.
      if (conv.missedSyncCycles) {
        await db.conversations.update(conv.id, { missedSyncCycles: 0 });
      }
      continue;
    }
    if (conv.draft === 1) continue;
    if (conv.lastActivityAt >= discoveryStartedAt) continue;
    if (await hasPendingAction(conv.id)) continue;
    if (isMutationSuppressed(conv.id)) continue;

    const missed = (conv.missedSyncCycles ?? 0) + 1;
    if (missed >= STRIKES_BEFORE_DELETE) {
      await db.transaction('rw', [db.conversations, db.messages, db.syncQueue], async () => {
        await db.conversations.delete(conv.id);
        await db.messages.where('conversationId').equals(conv.id).delete();
        await db.syncQueue.delete(conv.id);
      });
      deleted++;
      debugLog(
        'info',
        `[SWEEP] Removed conversation ${conv.id.substring(0, 20)}... (absent from ${missed} completed ${category} discoveries)`
      );
    } else {
      await db.conversations.update(conv.id, { missedSyncCycles: missed });
    }
  }

  if (deleted > 0) {
    debugLog('info', `[SWEEP] ${category}: removed ${deleted} server-deleted conversation(s)`);
  }
  return deleted;
}
