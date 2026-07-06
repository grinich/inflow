import { db } from '@/db/database';

/**
 * How long a CONFIRMED action still guards its conversation. Covers the
 * post-confirm echo window (stale SSE events / polls fetched before the
 * mutation landed). Mirrors the in-memory mutation-suppression TTL, but this
 * one is backed by the durable pendingActions table so it survives MV3
 * service-worker restarts.
 */
const CONFIRMED_GUARD_MS = 15_000;

/**
 * Returns true if the conversation has an in-flight optimistic action
 * (pending API call or queued for offline drain), or one confirmed within the
 * echo window. Callers should skip overwriting category/archived/read/starred
 * from the server when true.
 *
 * 'failed' actions have already been rolled back, so server state takes
 * precedence for those.
 *
 * Uses filter() instead of where() because conversationId is not indexed
 * on pendingActions. The table is small (typically <10 rows) so this is fine.
 */
export async function hasPendingAction(conversationId: string): Promise<boolean> {
  const now = Date.now();
  const count = await db.pendingActions
    .filter((a) =>
      a.conversationId === conversationId &&
      (a.status === 'pending' ||
        a.status === 'queued' ||
        (a.status === 'confirmed' && now - a.timestamp <= CONFIRMED_GUARD_MS))
    )
    .count();
  return count > 0;
}
