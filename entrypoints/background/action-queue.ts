/**
 * Action Queue Drainer
 *
 * Reads queued pendingActions from IndexedDB and replays them via the
 * LinkedIn API when connectivity returns. Called on service worker startup
 * and on every 30s sync coordinator tick.
 */

import {
  archiveConversation,
  unarchiveConversation,
  moveToOther,
  moveToFocused,
  moveToSpam,
  markConversationRead,
  markConversationUnread,
  deleteConversation,
  starConversation,
  unstarConversation,
} from './api/conversations';
import { sendMessage, editMessage, reactWithEmoji, recallMessage } from './api/messages';
import { recordMarkRead, recordMutation } from './realtime/mark-read-suppression';
import { debugLog } from '@/lib/debug-log';
import { db, getDbGeneration } from '@/db/database';
import type { PendingAction } from '@/db/database';

let draining = false;

/** Age threshold after which confirmed/failed actions are cleaned up. */
const ACTION_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Remove old confirmed/failed pending actions to prevent unbounded table growth.
 * Called at the start of every drain cycle.
 */
async function cleanupStaleActions(): Promise<void> {
  try {
    const cutoff = Date.now() - ACTION_CLEANUP_AGE_MS;
    const stale = await db.pendingActions
      .filter((a) =>
        (a.status === 'confirmed' || a.status === 'failed') &&
        a.timestamp < cutoff
      )
      .toArray();
    if (stale.length > 0) {
      await db.pendingActions.bulkDelete(stale.map((a) => a.id));
      debugLog('info', `[ACTION-QUEUE] Cleaned up ${stale.length} stale action(s)`);
    }
  } catch (err) {
    debugLog('warn', `[ACTION-QUEUE] Cleanup failed: ${err}`);
  }
}

/**
 * Process all queued actions in timestamp order.
 * Idempotent — safe to call concurrently (second call is a no-op).
 */
export async function drainActionQueue(): Promise<void> {
  if (draining) return;
  draining = true;

  try {
    // Prune old confirmed/failed actions before draining
    await cleanupStaleActions();

    const queued = await db.pendingActions
      .where('status')
      .equals('queued')
      .sortBy('timestamp');

    if (queued.length === 0) return;

    debugLog('info', `[ACTION-QUEUE] Draining ${queued.length} queued action(s)`);

    const gen = getDbGeneration();
    for (const action of queued) {
      if (getDbGeneration() !== gen) break; // account switched mid-drain — don't replay into the new DB
      // Stop if we've gone offline mid-drain
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        debugLog('info', '[ACTION-QUEUE] Went offline — pausing drain');
        break;
      }

      let replayed = false;
      try {
        await replayAction(action);
        replayed = true;
        await db.pendingActions.update(action.id, { status: 'confirmed' });

        // For send actions, update the temp message status
        if (action.type === 'send' && action.tempMessageId) {
          await db.messages.update(action.tempMessageId, { status: 'sent' });
          await db.draftAttachments.delete(action.tempMessageId).catch(() => {});
        }

        debugLog('info', `[ACTION-QUEUE] Replayed ${action.type} for ${action.conversationId}`);
      } catch (err) {
        if (replayed) {
          // The server-side action already succeeded — only the local bookkeeping
          // failed. Rolling back or re-queuing would resend on the next drain
          // (duplicate), so mark confirmed and move on. This MUST precede the
          // offline check below, or going offline here would re-queue it.
          debugLog('warn', `[ACTION-QUEUE] Post-replay bookkeeping failed for ${action.type} (${action.conversationId}): ${err}`);
          await db.pendingActions.update(action.id, { status: 'confirmed' }).catch(() => {});
          continue;
        }

        // If offline again, stop draining — leave remaining as queued
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          debugLog('info', '[ACTION-QUEUE] Went offline during replay — stopping');
          break;
        }

        // Genuine server error — rollback
        debugLog('error', `[ACTION-QUEUE] Failed to replay ${action.type} for ${action.conversationId}: ${err}`);
        await db.pendingActions.update(action.id, { status: 'failed' });
        await rollbackAction(action);
      }
    }
  } catch (err) {
    debugLog('error', `[ACTION-QUEUE] Drain failed: ${err}`);
  } finally {
    draining = false;
  }
}

/**
 * Replay a single queued action by calling the API directly.
 */
async function replayAction(action: PendingAction): Promise<void> {
  const convId = action.conversationId;

  switch (action.type) {
    case 'archive':
      recordMutation(convId);
      await archiveConversation(convId);
      break;
    case 'unarchive':
      recordMutation(convId);
      await unarchiveConversation(convId);
      break;
    case 'move_to_focused':
      recordMutation(convId);
      await moveToFocused(convId);
      break;
    case 'move_to_other':
      recordMutation(convId);
      await moveToOther(convId);
      break;
    case 'move_to_spam':
      recordMutation(convId);
      await moveToSpam(convId);
      break;
    case 'markRead':
      recordMarkRead(convId);
      await markConversationRead(convId);
      break;
    case 'markUnread':
      recordMutation(convId);
      await markConversationUnread(convId);
      break;
    case 'star':
      recordMutation(convId);
      await starConversation(convId);
      break;
    case 'unstar':
      recordMutation(convId);
      await unstarConversation(convId);
      break;
    case 'delete':
      try {
        await deleteConversation(convId);
      } catch (err: any) {
        // 404 = already deleted server-side — treat as success
        if (err?.status === 404 || err?.message?.includes('404')) return;
        throw err;
      }
      break;
    case 'send':
      await replaySend(action);
      break;
    case 'edit_message':
      if (action.bridgeMessage) {
        await editMessage(
          action.bridgeMessage.conversationId,
          action.bridgeMessage.messageId,
          action.bridgeMessage.body
        );
      }
      break;
    case 'react_emoji':
      if (action.bridgeMessage) {
        await reactWithEmoji(
          action.bridgeMessage.messageId,
          action.bridgeMessage.emoji
        );
      }
      break;
    case 'recall_message':
      if (action.bridgeMessage) {
        await recallMessage(action.bridgeMessage.messageId);
        await db.messages.delete(action.bridgeMessage.messageId).catch(() => {});
      }
      break;
    default:
      debugLog('warn', `[ACTION-QUEUE] Unknown action type: ${action.type}`);
  }
}

/**
 * Replay a send action. Reads file blobs from draftAttachments if present.
 */
async function replaySend(action: PendingAction): Promise<void> {
  if (!action.tempMessageId) return;

  // Check the message still has 'queued' status (not retried/deleted by user)
  const msg = await db.messages.get(action.tempMessageId);
  if (!msg || msg.status !== 'queued') return;

  const body = action.bridgeMessage?.body ?? msg.body;
  const convId = action.conversationId;

  // Recover file attachments from draftAttachments table
  let attachments: { name: string; type: string; size: number; dataBase64: string }[] | undefined;
  const draft = await db.draftAttachments.get(action.tempMessageId).catch(() => undefined);
  if (draft && draft.files.length > 0) {
    attachments = await Promise.all(
      draft.files.map(async (blob, i) => {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let j = 0; j < bytes.length; j++) {
          binary += String.fromCharCode(bytes[j]);
        }
        const dataBase64 = btoa(binary);
        return {
          name: draft.names[i] || 'file',
          type: draft.types[i] || 'application/octet-stream',
          size: blob.size,
          dataBase64,
        };
      })
    );
  }

  await sendMessage(convId, body, attachments);
}

/**
 * Rollback a failed action using its stored rollbackData.
 */
async function rollbackAction(action: PendingAction): Promise<void> {
  const data = action.rollbackData;
  if (!data) return;

  switch (action.type) {
    case 'archive':
    case 'unarchive':
    case 'move_to_focused':
    case 'move_to_other':
    case 'move_to_spam':
    case 'markRead':
    case 'markUnread':
    case 'star':
    case 'unstar':
      // rollbackData is a partial conversation update
      await db.conversations.update(action.conversationId, data).catch(() => {});
      break;
    case 'delete':
      // rollbackData is { conversation, messages }
      if (data.conversation) {
        await db.conversations.put(data.conversation).catch(() => {});
      }
      if (data.messages?.length) {
        await db.messages.bulkPut(data.messages).catch(() => {});
      }
      break;
    case 'send':
      // Mark the temp message as failed
      if (action.tempMessageId) {
        await db.messages.update(action.tempMessageId, { status: 'failed' }).catch(() => {});
      }
      break;
    case 'edit_message':
      // rollbackData is { messageId, body, editedAt }
      if (data.messageId) {
        await db.messages.update(data.messageId, {
          body: data.body,
          editedAt: data.editedAt,
        }).catch(() => {});
      }
      break;
    case 'react_emoji':
      // rollbackData is { messageId, reactions }
      if (data.messageId) {
        await db.messages.update(data.messageId, {
          reactions: data.reactions,
        }).catch(() => {});
      }
      break;
    case 'recall_message':
      // rollbackData is { message } — restore the deleted message
      if (data.message) {
        await db.messages.put(data.message).catch(() => {});
      }
      break;
  }
}
