import { fetchAllMessages } from '../api/messages';
import { getMemberUrn } from '../auth/session';
import { normalizeMessages } from '@/lib/voyager-normalizer';
import { prefetchSharedPosts } from './prefetch-posts';
import { debugLog } from '@/lib/debug-log';
import { db, getDbGeneration } from '@/db/database';

/** Small delay between backfill conversations to yield the event loop. */
function backfillDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, 100));
}
const MAX_RETRIES = 3;
let _backfillRunning = false;

/**
 * Fetch messages for a batch of queued conversations.
 * Processes items ordered by priority (newest conversations first).
 * Paginates through all message pages per conversation.
 */
export async function backfillBatch(batchSize = 10, onProgress?: () => void): Promise<number> {
  if (_backfillRunning) return 0;
  _backfillRunning = true;
  try {
  return await _backfillBatchInner(batchSize, onProgress);
  } finally {
    _backfillRunning = false;
  }
}

async function _backfillBatchInner(batchSize: number, onProgress?: () => void): Promise<number> {
  const memberUrn = await getMemberUrn();

  // Get pending items ordered by priority (lowest = newest)
  const pending = await db.syncQueue
    .where('[status+priority]')
    .between(['pending', Dexie.minKey], ['pending', Dexie.maxKey])
    .limit(batchSize)
    .toArray();

  if (pending.length === 0) return 0;

  debugLog('info', `[BACKFILL] Processing batch of ${pending.length} conversations`);

  let completed = 0;
  const gen = getDbGeneration();

  for (const item of pending) {
    if (getDbGeneration() !== gen) break; // account switched mid-backfill — don't write into the new DB
    // Mark as syncing before API call (crash recovery: will be reset on startup)
    await db.syncQueue.update(item.conversationId, { status: 'syncing' });

    try {
      // Fetch all pages of messages for this conversation
      const pages = await fetchAllMessages(item.conversationId, 10, { skipJitter: true });
      let totalMessages = 0;

      for (const raw of pages) {
        const messages = normalizeMessages(raw, item.conversationId);

        for (const msg of messages) {
          if (msg.senderUrn === memberUrn) {
            msg.isFromMe = true;
          }
        }

        // Preserve SSE-written fields the pagination API doesn't return, so a
        // re-sync doesn't wipe read receipts / reactions / edits already stored
        // on the canonical message rows.
        const existingRows = await db.messages.bulkGet(messages.map((m) => m.id));
        for (let i = 0; i < messages.length; i++) {
          const prev = existingRows[i];
          if (!prev) continue;
          if (prev.seenAt && !messages[i].seenAt) messages[i].seenAt = prev.seenAt;
          if (prev.reactions?.length && !messages[i].reactions?.length) messages[i].reactions = prev.reactions;
          if (prev.editedAt && !messages[i].editedAt) messages[i].editedAt = prev.editedAt;
        }
        await db.messages.bulkPut(messages);

        // Update hasAttachments flag
        if (messages.some((m) => m.attachments && m.attachments.length > 0)) {
          await db.conversations.update(item.conversationId, {
            hasAttachments: 1,
          });
        }

        // Pre-fetch shared posts in background (non-blocking)
        prefetchSharedPosts(messages).catch(() => {});

        totalMessages += messages.length;
      }

      // Clean up SSE duplicate messages — only delete SSE-format entries
      // (fsd_message / fs_event) that have a canonical replacement (msg_message)
      // with the same body + sender + timestamp. Preserve editedAt and reactions
      // from the SSE entry onto the canonical version (the Messenger API doesn't
      // return these fields).
      const allMsgs = await db.messages
        .where('conversationId')
        .equals(item.conversationId)
        .toArray();
      const canonicalKeys = new Set<string>();
      for (const m of allMsgs) {
        if (m.id.startsWith('urn:li:msg_message:')) {
          canonicalKeys.add(`${m.body}|${m.senderUrn}|${m.createdAt}`);
        }
      }
      const sseOrphans = allMsgs.filter((m) =>
        (m.id.startsWith('urn:li:fsd_message:') || m.id.startsWith('urn:li:fs_event:')) &&
        canonicalKeys.has(`${m.body}|${m.senderUrn}|${m.createdAt}`)
      );
      if (sseOrphans.length > 0) {
        // Preserve editedAt and reactions from SSE entries onto canonical versions
        for (const stale of sseOrphans) {
          if (!stale.editedAt && !stale.reactions?.length) continue;
          const canonical = allMsgs.find(m =>
            m.id.startsWith('urn:li:msg_message:') &&
            m.body === stale.body &&
            m.senderUrn === stale.senderUrn &&
            m.createdAt === stale.createdAt
          );
          if (canonical) {
            const updates: Record<string, any> = {};
            if (stale.editedAt && !canonical.editedAt) updates.editedAt = stale.editedAt;
            if (stale.reactions?.length && !canonical.reactions?.length) updates.reactions = stale.reactions;
            if (Object.keys(updates).length > 0) {
              await db.messages.update(canonical.id, updates);
            }
          }
        }
        await db.messages.bulkDelete(sseOrphans.map((m) => m.id));
      }

      // Mark as done
      await db.syncQueue.update(item.conversationId, {
        status: 'done',
        messagesSyncedAt: Date.now(),
      });

      completed++;
      debugLog(
        'info',
        `[BACKFILL] Synced ${totalMessages} messages (${pages.length} pages) for ${item.conversationId.substring(0, 20)}...`
      );
      onProgress?.();
    } catch (err) {
      const newFailCount = item.failCount + 1;
      const newStatus = newFailCount >= MAX_RETRIES ? 'failed' : 'pending';

      await db.syncQueue.update(item.conversationId, {
        status: newStatus as 'pending' | 'failed',
        failCount: newFailCount,
        lastFailedAt: Date.now(),
      });

      debugLog(
        'error',
        `[BACKFILL] Failed for ${item.conversationId} (attempt ${newFailCount}/${MAX_RETRIES}): ${err}`
      );
    }

    // Rate limit delay between conversations
    if (pending.indexOf(item) < pending.length - 1) {
      await backfillDelay();
    }
  }

  return completed;
}

/**
 * On startup, reset any items stuck in 'syncing' state back to 'pending'.
 * These were in-flight when the service worker was killed.
 */
export async function recoverStuckItems(): Promise<number> {
  const stuck = await db.syncQueue.where('status').equals('syncing').toArray();

  if (stuck.length === 0) return 0;

  debugLog(
    'info',
    `[BACKFILL] Recovering ${stuck.length} stuck items from previous session`
  );

  for (const item of stuck) {
    // Count the interrupted attempt instead of resetting to 0, so a conversation
    // that repeatedly crashes the worker eventually reaches MAX_RETRIES and stops
    // rather than retrying (and re-crashing) forever.
    const newFailCount = item.failCount + 1;
    const newStatus = newFailCount >= MAX_RETRIES ? 'failed' : 'pending';
    await db.syncQueue.update(item.conversationId, { status: newStatus, failCount: newFailCount });
  }

  return stuck.length;
}

// Need Dexie import for minKey/maxKey
import Dexie from 'dexie';
