import Dexie from 'dexie';
import { db } from '@/db/database';
import { planRecalledDeletions } from '@/lib/message-dedup';
import { debugLog } from '@/lib/debug-log';
import type { Message } from '@/types/message';

/**
 * Delete stored canonical messages the server no longer returns within the
 * time range covered by a freshly fetched page — i.e. messages recalled/unsent
 * on LinkedIn. See planRecalledDeletions for the exact (conservative) rules.
 *
 * Runs read + delete in one transaction so a concurrent SSE/backfill write
 * can't interleave between the read and the delete.
 */
export async function reconcileRecalledMessages(
  conversationId: string,
  fetched: Message[]
): Promise<void> {
  if (fetched.length === 0) return;
  await db.transaction('rw', db.messages, async () => {
    const stored = await db.messages
      .where('[conversationId+createdAt]')
      .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
      .toArray();
    const deleteIds = planRecalledDeletions(fetched, stored);
    if (deleteIds.length === 0) return;
    await db.messages.bulkDelete(deleteIds);
    debugLog(
      'info',
      `[RECONCILE] Removed ${deleteIds.length} recalled message(s) from ${conversationId.substring(0, 20)}...`
    );
  });
}
