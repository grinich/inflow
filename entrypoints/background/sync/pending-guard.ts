import { db } from '@/db/database';

/**
 * Returns true if the conversation has an in-flight optimistic action
 * (pending API call or queued for offline drain). Callers should skip
 * overwriting category/archived/read/starred from the server when true.
 *
 * Only guards 'pending' and 'queued' — 'failed' actions have already
 * been rolled back, so server state should take precedence.
 *
 * Uses filter() instead of where() because conversationId is not indexed
 * on pendingActions. The table is small (typically <10 rows) so this is fine.
 */
export async function hasPendingAction(conversationId: string): Promise<boolean> {
  const count = await db.pendingActions
    .filter((a) =>
      a.conversationId === conversationId &&
      (a.status === 'pending' || a.status === 'queued')
    )
    .count();
  return count > 0;
}
