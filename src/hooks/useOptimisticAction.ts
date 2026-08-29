import Dexie from 'dexie';
import { nanoid } from 'nanoid';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import { useUIStore } from '@/store/ui-store';
import { registerSendObjectUrls } from '@/lib/send-object-urls';
import type { Conversation } from '@/types/conversation';
import type { Message, ReactionSummary } from '@/types/message';
import type { PendingAction } from '@/db/database';

/**
 * Queue a pending action for later replay instead of rolling back.
 * Writes the bridgeMessage payload so the background drainer can replay it.
 */
async function queueAction(actionId: string, bridgeMessage: any): Promise<void> {
  await db.pendingActions.update(actionId, {
    status: 'queued' as const,
    timestamp: Date.now(),
    bridgeMessage,
  });
}

/**
 * Create a pending action record with 'queued' status for actions that
 * don't normally create pendingActions (markRead, star, delete, editMessage).
 */
async function createQueuedAction(
  opts: Pick<PendingAction, 'type' | 'conversationId' | 'rollbackData' | 'bridgeMessage' | 'tempMessageId'>
): Promise<string> {
  const id = nanoid();
  await db.pendingActions.put({
    id,
    type: opts.type,
    conversationId: opts.conversationId,
    status: 'queued',
    timestamp: Date.now(),
    rollbackData: opts.rollbackData,
    bridgeMessage: opts.bridgeMessage,
    tempMessageId: opts.tempMessageId,
  });
  return id;
}

async function createPendingAction(
  opts: Pick<PendingAction, 'type' | 'conversationId' | 'rollbackData' | 'bridgeMessage' | 'tempMessageId'>
): Promise<string> {
  const id = nanoid();
  await db.pendingActions.put({
    id,
    type: opts.type,
    conversationId: opts.conversationId,
    status: 'pending',
    timestamp: Date.now(),
    rollbackData: opts.rollbackData,
    bridgeMessage: opts.bridgeMessage,
    tempMessageId: opts.tempMessageId,
  });
  return id;
}

export function useOptimisticAction() {
  const showToast = useUIStore((s) => s.showToast);

  /**
   * Every LinkedIn thread this row stands for.
   *
   * LinkedIn keeps more than one 1:1 thread with the same person (an old InMail
   * plus the thread an accepted invitation-with-a-note creates, say).
   * useConversations folds them into a single row and lists the rest in
   * `mergedIds`; `conversation.id` is merely whichever of them has the latest
   * activity. An action that touches only that one leaves the others behind —
   * archive the row and the twin stays in Focused, bringing the conversation
   * straight back on the next render.
   */
  function threadIdsOf(conversation: Conversation): string[] {
    return conversation.mergedIds?.length
      ? [conversation.id, ...conversation.mergedIds]
      : [conversation.id];
  }

  /**
   * The threads to actually act on: those we hold a row for.
   *
   * `mergedIds` is display state recomputed on every query, so it can name a
   * thread this client no longer stores. Acting on one would fire a server call
   * for a conversation we know nothing about, so those are dropped — and the
   * primary is always kept, or an action would target nothing at all.
   */
  async function storedThreadIds(conversation: Conversation): Promise<string[]> {
    const ids = threadIdsOf(conversation);
    if (ids.length === 1) return ids;
    const present = await Promise.all(
      ids.map(async (id) => ((await db.conversations.get(id)) ? id : null))
    );
    const kept = present.filter(Boolean) as string[];
    return kept.length ? kept : [conversation.id];
  }

  /** Send the same bridge message for each thread; false if any of them failed. */
  async function sendToThreads(
    type: 'ARCHIVE' | 'UNARCHIVE' | 'DELETE_CONVERSATION' | 'STAR' | 'UNSTAR'
      | 'MOVE_TO_FOCUSED' | 'MOVE_TO_OTHER' | 'MOVE_TO_SPAM',
    ids: string[]
  ): Promise<boolean> {
    const results = await Promise.all(
      ids.map((conversationId) =>
        sendBridgeMessage({ type, conversationId } as any).catch(() => ({ success: false }))
      )
    );
    return results.every((r: any) => r?.success);
  }

  async function archiveConversation(conversation: Conversation) {
    const actionId = nanoid();
    const previousCategory = conversation.category || 'PRIMARY_INBOX';
    // Roll back to the archived flag we saw — hardcoding archived: 0 with a
    // previousCategory of 'ARCHIVE' produces a row no tab query matches, and
    // the conversation vanishes from the UI until a sync heals it.
    const previousArchived = conversation.archived ?? 0;
    // Every thread the row stands for, not just the primary (see threadIdsOf).
    const ids = await storedThreadIds(conversation);
    // Snapshot each stored row: a twin can sit in a different category, so one
    // shared rollback value would put it back somewhere it never was.
    const before = new Map<string, { archived: number; category: string }>();
    for (const id of ids) {
      const row = await db.conversations.get(id);
      if (row) before.set(id, { archived: row.archived ?? 0, category: row.category || 'PRIMARY_INBOX' });
    }
    const restoreAll = async () => {
      for (const [id, prev] of before) await db.conversations.update(id, prev);
    };
    const bridgeMsg = { type: 'ARCHIVE' as const, conversationId: conversation.id };

    // Optimistically update IndexedDB
    for (const id of ids) {
      await db.conversations.update(id, { archived: 1, category: 'ARCHIVE' });
    }
    await db.pendingActions.put({
      id: actionId,
      type: 'archive',
      conversationId: conversation.id,
      status: 'pending',
      timestamp: Date.now(),
      rollbackData: { archived: previousArchived, category: previousCategory },
    });

    // Show undo toast
    showToast({
      message: 'Conversation archived',
      undoConversationId: conversation.id,
      undoAction: async () => {
        await restoreAll();
        await db.pendingActions.delete(actionId);
        if (navigator.onLine) {
          sendToThreads('UNARCHIVE', ids).catch(() => {});
        }
      },
    });

    // If offline, queue for later
    if (!navigator.onLine) {
      await queueAction(actionId, bridgeMsg);
      return;
    }

    // Fire and forget to API — once per thread, or the twin stays in the
    // inbox on LinkedIn and the next sync pulls the row back.
    sendToThreads('ARCHIVE', ids)
      .then(async (ok) => {
        if (ok) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          await restoreAll();
          await db.pendingActions.update(actionId, { status: 'failed' });
          showToast({ message: 'Failed to archive — rolled back' });
        }
      })
      .catch(async () => {
        // If we went offline during the call, queue instead of rolling back
        if (!navigator.onLine) {
          await queueAction(actionId, bridgeMsg);
          return;
        }
        await restoreAll();
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: 'Failed to archive — rolled back' });
      })
        .catch(() => {}); // fire-and-forget: never surface as unhandled
  }

  /**
   * Mark a conversation read. `mergedIds` are duplicate threads the list
   * display-merged into this one (see useConversations) — their messages were
   * shown in this thread's view, and their unread flag surfaces on this row,
   * so any unread twin must be cleared too or the row stays unread forever
   * (the twin isn't in the list, so nothing else can ever mark it).
   */
  async function markRead(conversationId: string, mergedIds?: string[]) {
    if (mergedIds?.length) {
      for (const id of mergedIds) {
        const twin = await db.conversations.get(id);
        if (twin && twin.read === 0) await markRead(id);
      }
    }
    await db.conversations.update(conversationId, { read: 1 });

    const bridgeMsg = { type: 'MARK_READ' as const, conversationId };

    if (!navigator.onLine) {
      await createQueuedAction({
        type: 'markRead',
        conversationId,
        rollbackData: { read: 0 },
        bridgeMessage: bridgeMsg,
      });
      return;
    }

    const actionId = await createPendingAction({
      type: 'markRead',
      conversationId,
      rollbackData: { read: 0 },
      bridgeMessage: bridgeMsg,
    });
    const queueMarkRead = () => queueAction(actionId, bridgeMsg);
    sendBridgeMessage(bridgeMsg)
      // The router resolves {success:false} on a server error (never rejects), so
      // queue a retry on !success too — not only on a thrown rejection.
      .then(async (res) => {
        if (res.success) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          await queueMarkRead();
        }
      })
      .catch(() => queueMarkRead());
  }

  async function markUnread(conversationId: string) {
    await db.conversations.update(conversationId, { read: 0 });

    const bridgeMsg = { type: 'MARK_UNREAD' as const, conversationId };

    if (!navigator.onLine) {
      await createQueuedAction({
        type: 'markUnread',
        conversationId,
        rollbackData: { read: 1 },
        bridgeMessage: bridgeMsg,
      });
      return;
    }

    const actionId = await createPendingAction({
      type: 'markUnread',
      conversationId,
      rollbackData: { read: 1 },
      bridgeMessage: bridgeMsg,
    });
    const rollbackUnread = async () => {
      await db.conversations.update(conversationId, { read: 1 });
      await db.pendingActions.update(actionId, { status: 'failed' });
      showToast({ message: 'Failed to mark unread — rolled back' });
    };
    sendBridgeMessage(bridgeMsg)
      // Server errors resolve {success:false} (no rejection), so roll back on that too.
      .then(async (res) => {
        if (res.success) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          await rollbackUnread();
        }
      })
      .catch(async () => {
        if (!navigator.onLine) {
          await queueAction(actionId, bridgeMsg);
          return;
        }
        await rollbackUnread();
      });
  }

  async function sendMessage(conversationId: string, body: string, files?: File[], replyTo?: { messageUrn: string; senderUrn: string; senderName: string; sentAt: number; body: string }): Promise<boolean> {
    const tempId = `temp-${nanoid()}`;

    // Build display attachments from files so the bubble renders them immediately
    const objectUrls: string[] = [];
    const displayAttachments = files?.length
      ? files.map((f) => {
          if (f.type.startsWith('image/')) {
            const url = URL.createObjectURL(f);
            objectUrls.push(url);
            return { type: 'image' as const, imageUrl: url };
          }
          return {
            type: 'file' as const,
            fileName: f.name,
            fileSize: f.size,
            mimeType: f.type,
          };
        })
      : undefined;

    // Optimistic insert — use 'queued' status if offline, 'sending' if online
    const initialStatus = navigator.onLine ? 'sending' : 'queued';
    await db.messages.put({
      id: tempId,
      conversationId,
      senderUrn: 'me',
      senderName: 'You',
      senderPicture: '',
      body,
      createdAt: Date.now(),
      isFromMe: true,
      status: initialStatus,
      attachments: displayAttachments,
      ...(replyTo ? { repliedMessage: { senderName: replyTo.senderName, body: replyTo.body, messageId: replyTo.messageUrn, senderUrn: replyTo.senderUrn, sentAt: replyTo.sentAt } } : {}),
    });

    // Register preview object URLs against the temp id. They're revoked by the
    // app-root reaper once this temp message leaves the DB (sent + cleaned up,
    // deleted, or retried) — covering the offline-queue path the inline success/
    // fail revokes never reached, and keeping the blob alive while it's on screen.
    registerSendObjectUrls(tempId, objectUrls);

    // Stash files in IndexedDB so retry/drainer can recover them
    if (files?.length) {
      await db.draftAttachments.put({
        conversationId: tempId,  // keyed by temp message ID, not conversation
        files: files as Blob[],
        names: files.map((f) => f.name),
        types: files.map((f) => f.type),
      }).catch(() => {});
    }

    // Update conversation preview
    await db.conversations.update(conversationId, {
      lastMessage: body || (files?.length ? `Sent ${files.length} file(s)` : ''),
      lastActivityAt: Date.now(),
      read: 1,
    });

    // Build bridge-compatible replyTo (without senderName which is UI-only)
    const bridgeReplyTo = replyTo ? { messageUrn: replyTo.messageUrn, senderUrn: replyTo.senderUrn, sentAt: replyTo.sentAt, body: replyTo.body } : undefined;

    // If offline, queue the action (without base64 — drainer reads from draftAttachments)
    if (!navigator.onLine) {
      await createQueuedAction({
        type: 'send',
        conversationId,
        bridgeMessage: { type: 'SEND_MESSAGE', conversationId, body, ...(bridgeReplyTo ? { replyTo: bridgeReplyTo } : {}) },
        tempMessageId: tempId,
      });
      return true; // optimistic success
    }

    try {
      // Convert File objects to base64 for bridge serialization
      let attachments: { name: string; type: string; size: number; dataBase64: string }[] | undefined;
      if (files?.length) {
        attachments = await Promise.all(
          files.map(
            (f) =>
              new Promise<{ name: string; type: string; size: number; dataBase64: string }>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const base64 = (reader.result as string).split(',')[1] || '';
                  resolve({ name: f.name, type: f.type, size: f.size, dataBase64: base64 });
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(f);
              })
          )
        );
      }

      const res = await sendBridgeMessage({
        type: 'SEND_MESSAGE',
        conversationId,
        body,
        attachments,
        ...(bridgeReplyTo ? { replyTo: bridgeReplyTo } : {}),
      });

      if (res.success) {
        await db.messages.update(tempId, { status: 'sent' });
        // Clean up stashed files; the reaper revokes the preview URLs once the
        // temp message is replaced by the canonical one.
        await db.draftAttachments.delete(tempId).catch(() => {});
        return true;
      } else {
        const failReason = res.error || undefined;
        await db.messages.update(tempId, { status: 'failed', failReason });
        document.dispatchEvent(new CustomEvent('inflow:failed-change', { detail: conversationId }));
        return false;
      }
    } catch {
      // If we went offline during the call, queue instead of failing
      if (!navigator.onLine) {
        await db.messages.update(tempId, { status: 'queued' });
        await createQueuedAction({
          type: 'send',
          conversationId,
          bridgeMessage: { type: 'SEND_MESSAGE', conversationId, body, ...(bridgeReplyTo ? { replyTo: bridgeReplyTo } : {}) },
          tempMessageId: tempId,
        });
        return true; // optimistic success
      }
      await db.messages.update(tempId, { status: 'failed' });
      document.dispatchEvent(new CustomEvent('inflow:failed-change', { detail: conversationId }));
      return false;
    }
  }

  /**
   * Send a message and archive the conversation in one atomic UI action.
   */
  async function sendAndArchive(
    conversationId: string,
    body: string,
    files?: File[],
    replyTo?: { messageUrn: string; senderUrn: string; senderName: string; sentAt: number; body: string }
  ): Promise<void> {
    const conv = await db.conversations.get(conversationId);
    if (!conv) return;

    const actionId = nanoid();
    const previousCategory = conv.category || 'PRIMARY_INBOX';
    // See archiveConversation: rolling back to archived: 0 with category
    // 'ARCHIVE' (sending from an already-archived thread) matches no tab
    // query and the conversation vanishes from the UI.
    const previousArchived = conv.archived ?? 0;
    const archiveBridgeMsg = { type: 'ARCHIVE' as const, conversationId };

    // 1. Archive optimistically FIRST
    await db.conversations.update(conversationId, { archived: 1, category: 'ARCHIVE' });
    await db.pendingActions.put({
      id: actionId,
      type: 'archive',
      conversationId,
      status: 'pending',
      timestamp: Date.now(),
      rollbackData: { archived: previousArchived, category: previousCategory },
    });

    // 2. Show undo toast
    showToast({
      message: 'Message sent & archived',
      undoConversationId: conversationId,
      undoAction: async () => {
        await db.conversations.update(conversationId, { archived: previousArchived, category: previousCategory });
        await db.pendingActions.delete(actionId);
        if (navigator.onLine) {
          sendBridgeMessage({ type: 'UNARCHIVE', conversationId }).catch(() => {});
        }
      },
    });

    // 3. Send message, then archive AFTER send succeeds.
    //    If we archive concurrently with the send, LinkedIn moves the
    //    conversation back to PRIMARY_INBOX when the new message arrives.
    if (!navigator.onLine) {
      await sendMessage(conversationId, body, files, replyTo);
      await queueAction(actionId, archiveBridgeMsg);
      return;
    }

    const ok = await sendMessage(conversationId, body, files, replyTo);
    if (!ok) {
      // The archive was optimistic on a send that never happened — undo it and
      // retire the action, or the stranded 'pending' row would guard the
      // conversation from server merges indefinitely.
      await db.conversations.update(conversationId, { archived: previousArchived, category: previousCategory });
      await db.pendingActions.update(actionId, { status: 'failed' });
      showToast({ message: 'Failed to send message' });
      return;
    }
    try {
      const res = await sendBridgeMessage(archiveBridgeMsg);
      if (res.success) {
        await db.pendingActions.update(actionId, { status: 'confirmed' });
      } else {
        await db.conversations.update(conversationId, { archived: previousArchived, category: previousCategory });
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: 'Failed to archive — rolled back' });
      }
    } catch {
      if (!navigator.onLine) {
        await queueAction(actionId, archiveBridgeMsg);
        return;
      }
      await db.conversations.update(conversationId, { archived: previousArchived, category: previousCategory });
      await db.pendingActions.update(actionId, { status: 'failed' });
      showToast({ message: 'Failed to archive — rolled back' });
    }
  }

  // Bridge action that restores a conversation to a given category (used by undo).
  const RESTORE_BRIDGE: Record<string, 'ARCHIVE' | 'MOVE_TO_OTHER' | 'MOVE_TO_SPAM' | 'MOVE_TO_FOCUSED'> = {
    ARCHIVE: 'ARCHIVE',
    SECONDARY_INBOX: 'MOVE_TO_OTHER',
    SPAM: 'MOVE_TO_SPAM',
    PRIMARY_INBOX: 'MOVE_TO_FOCUSED',
  };

  /**
   * Shared optimistic category-move flow for moveToFocused/Other/Spam.
   * Applies the optimistic patch, records a pending action, shows an undo toast
   * (whose undo restores the previous category and fires the inverse bridge),
   * and reconciles with the server — queueing for replay when offline and
   * rolling back on failure.
   */
  async function categoryMove(
    conversation: Conversation,
    opts: {
      type: PendingAction['type'];
      bridgeType: 'MOVE_TO_FOCUSED' | 'MOVE_TO_OTHER' | 'MOVE_TO_SPAM';
      patch: Partial<Conversation>;
      toastMessage: string;
      failMessage: string;
    }
  ) {
    const actionId = nanoid();
    const previousCategory = conversation.category || 'PRIMARY_INBOX';
    const ids = await storedThreadIds(conversation);
    const bridgeMsg = { type: opts.bridgeType, conversationId: conversation.id };

    // Restore the previous category; also restore archived iff the patch touched it.
    const rollbackData: Partial<Conversation> =
      'archived' in opts.patch
        ? { archived: conversation.archived, category: previousCategory }
        : { category: previousCategory };

    // Per-thread snapshot: a twin can sit in a different category, and one
    // shared rollback would put it back somewhere it never was.
    const before = new Map<string, Partial<Conversation>>();
    for (const id of ids) {
      const row = await db.conversations.get(id);
      if (!row) continue;
      before.set(id, 'archived' in opts.patch
        ? { archived: row.archived, category: row.category || 'PRIMARY_INBOX' }
        : { category: row.category || 'PRIMARY_INBOX' });
    }
    const restoreAll = async () => {
      for (const [id, prev] of before) await db.conversations.update(id, prev);
    };

    for (const id of ids) await db.conversations.update(id, opts.patch);
    await db.pendingActions.put({
      id: actionId,
      type: opts.type,
      conversationId: conversation.id,
      status: 'pending',
      timestamp: Date.now(),
      rollbackData,
    });

    showToast({
      message: opts.toastMessage,
      undoConversationId: conversation.id,
      undoAction: async () => {
        await restoreAll();
        await db.pendingActions.delete(actionId);
        if (!navigator.onLine) return;
        const restoreType = RESTORE_BRIDGE[previousCategory] || 'MOVE_TO_FOCUSED';
        sendToThreads(restoreType as any, ids).catch(() => {});
      },
    });

    if (!navigator.onLine) {
      await queueAction(actionId, bridgeMsg);
      return;
    }

    const rollback = async () => {
      await restoreAll();
      await db.pendingActions.update(actionId, { status: 'failed' });
      showToast({ message: opts.failMessage });
    };

    sendToThreads(opts.bridgeType, ids)
      .then(async (ok) => {
        if (ok) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          await rollback();
        }
      })
      .catch(async () => {
        if (!navigator.onLine) {
          await queueAction(actionId, bridgeMsg);
          return;
        }
        await rollback();
      })
        .catch(() => {}); // fire-and-forget: never surface as unhandled
  }

  function moveToFocused(conversation: Conversation) {
    return categoryMove(conversation, {
      type: 'move_to_focused',
      bridgeType: 'MOVE_TO_FOCUSED',
      patch: { archived: 0, category: 'PRIMARY_INBOX' },
      toastMessage: 'Moved to Focused',
      failMessage: 'Failed to move — rolled back',
    });
  }

  function moveToOther(conversation: Conversation) {
    return categoryMove(conversation, {
      type: 'move_to_other',
      bridgeType: 'MOVE_TO_OTHER',
      // Clear archived like moveToFocused does — LinkedIn's category move
      // replaces ARCHIVE, and leaving the flag set would show the conversation
      // in BOTH the Other and Archived tabs (flag and category disagree).
      patch: { archived: 0, category: 'SECONDARY_INBOX' },
      toastMessage: 'Moved to Other',
      failMessage: 'Failed to move — rolled back',
    });
  }

  function moveToSpam(conversation: Conversation) {
    return categoryMove(conversation, {
      type: 'move_to_spam',
      bridgeType: 'MOVE_TO_SPAM',
      patch: { archived: 0, category: 'SPAM' },
      toastMessage: 'Marked as spam',
      failMessage: 'Failed to mark as spam — rolled back',
    });
  }

  async function deleteConversation(conversation: Conversation) {
    // Snapshot the STORED row for rollback — the caller's object is the
    // display-merged copy from useConversations (mergedIds plus read/starred
    // overlaid at query time) and must never be persisted back.
    const ids = await storedThreadIds(conversation);
    // Snapshot every thread: leaving a twin behind resurrects the conversation
    // as its own row the moment the list re-merges.
    const storedConvs = (await Promise.all(ids.map((id) => db.conversations.get(id))))
      .filter(Boolean) as Conversation[];
    const storedConv = storedConvs.find((c) => c.id === conversation.id) ?? conversation;
    // Save messages + syncQueue rows for rollback before deleting
    const savedMessages = await db.messages.where('conversationId').anyOf(ids).toArray();
    const savedQueueItems = (await Promise.all(
      ids.map((id) => db.syncQueue.get(id).catch(() => undefined))
    )).filter(Boolean) as any[];
    const bridgeMsg = { type: 'DELETE_CONVERSATION' as const, conversationId: conversation.id };

    // Remove from IndexedDB immediately (atomic transaction). The tombstone
    // stops a server page fetched BEFORE this delete from re-inserting the
    // conversation when it merges afterwards.
    await db.transaction('rw', [db.conversations, db.messages, db.syncQueue, db.tombstones], async () => {
      for (const id of ids) {
        await db.conversations.delete(id);
        await db.messages.where('conversationId').equals(id).delete();
        await db.syncQueue.delete(id).catch(() => {});
        await db.tombstones.put({ conversationId: id, deletedAt: Date.now() });
      }
    });

    if (!navigator.onLine) {
      await createQueuedAction({
        type: 'delete',
        conversationId: conversation.id,
        rollbackData: { conversation: storedConv, messages: savedMessages },
        bridgeMessage: bridgeMsg,
      });
      return;
    }

    const actionId = await createPendingAction({
      type: 'delete',
      conversationId: conversation.id,
      rollbackData: { conversation: storedConv, messages: savedMessages },
      bridgeMessage: bridgeMsg,
    });
    const restoreDeleted = async () => {
      for (const id of ids) await db.tombstones.delete(id).catch(() => {});
      await db.conversations.bulkPut(storedConvs);
      if (savedMessages.length > 0) await db.messages.bulkPut(savedMessages);
      for (const q of savedQueueItems) await db.syncQueue.put(q).catch(() => {});
      await db.pendingActions.update(actionId, { status: 'failed' });
      showToast({ message: 'Failed to delete — restored' });
    };

    sendToThreads('DELETE_CONVERSATION', ids)
      .then(async (ok) => {
        if (ok) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          await restoreDeleted();
        }
      })
      .catch(async () => {
        if (!navigator.onLine) {
          await queueAction(actionId, bridgeMsg);
          return;
        }
        await restoreDeleted();
      })
        .catch(() => {}); // fire-and-forget: never surface as unhandled
  }

  async function starConversation(conversation: Conversation) {
    // Branch on the STORED row, not the render snapshot — and make the
    // read-modify-write atomic: two rapid presses whose `get`s both resolve
    // before either `update` commits would otherwise both take the star
    // branch (like reactToMessage, the transaction serializes them).
    const ids = await storedThreadIds(conversation);
    let isStarred = false;
    await db.transaction('rw', db.conversations, async () => {
      const stored = await db.conversations.get(conversation.id);
      // The merged row reads as starred if ANY thread is (useConversations ORs
      // them), so the toggle has to follow the same rule — otherwise unstarring
      // leaves a starred twin and the star visibly refuses to turn off.
      const rows = (await Promise.all(ids.map((id) => db.conversations.get(id)))).filter(Boolean);
      isStarred = rows.length
        ? rows.some((r: any) => r.starred === 1)
        : (stored ?? conversation).starred === 1;
      for (const id of ids) await db.conversations.update(id, { starred: isStarred ? 0 : 1 });
    });
    if (isStarred) {
      // Unstar
      showToast({ message: 'Star removed' });

      const bridgeMsg = { type: 'UNSTAR' as const, conversationId: conversation.id };

      if (!navigator.onLine) {
        await createQueuedAction({
          type: 'unstar',
          conversationId: conversation.id,
          rollbackData: { starred: 1 },
          bridgeMessage: bridgeMsg,
        });
        return;
      }

      const actionId = await createPendingAction({
        type: 'unstar',
        conversationId: conversation.id,
        rollbackData: { starred: 1 },
        bridgeMessage: bridgeMsg,
      });
      const restoreStar = async (v: number) => {
        for (const id of ids) await db.conversations.update(id, { starred: v });
      };
      sendToThreads('UNSTAR', ids)
        .then(async (ok) => {
          if (ok) {
            await db.pendingActions.update(actionId, { status: 'confirmed' });
          } else {
            await restoreStar(1);
            await db.pendingActions.update(actionId, { status: 'failed' });
            showToast({ message: 'Failed to unstar — rolled back' });
          }
        })
        .catch(async () => {
          if (!navigator.onLine) {
            await queueAction(actionId, bridgeMsg);
            return;
          }
          await restoreStar(1);
          await db.pendingActions.update(actionId, { status: 'failed' });
          showToast({ message: 'Failed to unstar — rolled back' });
        })
          .catch(() => {}); // fire-and-forget: never surface as unhandled
    } else {
      // Star
      showToast({ message: 'Conversation starred' });

      const bridgeMsg = { type: 'STAR' as const, conversationId: conversation.id };

      if (!navigator.onLine) {
        await createQueuedAction({
          type: 'star',
          conversationId: conversation.id,
          rollbackData: { starred: 0 },
          bridgeMessage: bridgeMsg,
        });
        return;
      }

      const actionId = await createPendingAction({
        type: 'star',
        conversationId: conversation.id,
        rollbackData: { starred: 0 },
        bridgeMessage: bridgeMsg,
      });
      const restoreStar = async (v: number) => {
        for (const id of ids) await db.conversations.update(id, { starred: v });
      };
      sendToThreads('STAR', ids)
        .then(async (ok) => {
          if (ok) {
            await db.pendingActions.update(actionId, { status: 'confirmed' });
          } else {
            await restoreStar(0);
            await db.pendingActions.update(actionId, { status: 'failed' });
            showToast({ message: 'Failed to star — rolled back' });
          }
        })
        .catch(async () => {
          if (!navigator.onLine) {
            await queueAction(actionId, bridgeMsg);
            return;
          }
          await restoreStar(0);
          await db.pendingActions.update(actionId, { status: 'failed' });
          showToast({ message: 'Failed to star — rolled back' });
        })
          .catch(() => {}); // fire-and-forget: never surface as unhandled
    }
  }

  async function editMessage(conversationId: string, messageId: string, newBody: string): Promise<boolean> {
    const oldMessage = await db.messages.get(messageId);
    if (!oldMessage) return false;

    const bridgeMsg = { type: 'EDIT_MESSAGE' as const, conversationId, messageId, body: newBody };

    // Optimistically update local DB. Mentions are cleared (undefined deletes
    // the key in Dexie) — their offsets only fit the pre-edit body.
    await db.messages.update(messageId, { body: newBody, editedAt: Date.now(), mentions: undefined });

    // Rollback = revert only if OUR write is still in place — a rapid second
    // edit may have landed since, and restoring the pre-THIS-edit body would
    // clobber it.
    const rollbackEdit = async () => {
      await db.transaction('rw', db.messages, async () => {
        const cur = await db.messages.get(messageId);
        if (!cur || cur.body !== newBody) return;
        await db.messages.update(messageId, { body: oldMessage.body, editedAt: oldMessage.editedAt, mentions: oldMessage.mentions });
      });
    };

    if (!navigator.onLine) {
      await createQueuedAction({
        type: 'edit_message',
        conversationId,
        rollbackData: { messageId, body: oldMessage.body, editedAt: oldMessage.editedAt, mentions: oldMessage.mentions },
        bridgeMessage: bridgeMsg,
      });
      return true;
    }

    const actionId = await createPendingAction({
      type: 'edit_message',
      conversationId,
      rollbackData: { messageId, body: oldMessage.body, editedAt: oldMessage.editedAt, mentions: oldMessage.mentions },
      bridgeMessage: bridgeMsg,
    });
    try {
      const res = await sendBridgeMessage(bridgeMsg);

      if (!res.success) {
        await rollbackEdit();
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: res.error || 'Failed to edit message' });
        return false;
      }
      await db.pendingActions.update(actionId, { status: 'confirmed' });
      return true;
    } catch {
      if (!navigator.onLine) {
        await queueAction(actionId, bridgeMsg);
        return true;
      }
      await rollbackEdit();
      await db.pendingActions.update(actionId, { status: 'failed' });
      showToast({ message: 'Failed to edit message' });
      return false;
    }
  }

  async function reactToMessage(conversationId: string, messageId: string, emoji: string): Promise<void> {
    // Serialize the read-modify-write in a transaction so two rapid reactions on
    // the same message can't both read the old reactions and clobber each other.
    let oldReactions: ReactionSummary[] = [];
    let found = false;
    let appliedViewerReaction = false;
    await db.transaction('rw', db.messages, async () => {
      const msg = await db.messages.get(messageId);
      if (!msg) return;
      found = true;
      oldReactions = msg.reactions || [];
      const existingIdx = oldReactions.findIndex(r => r.emoji === emoji);
      let newReactions: ReactionSummary[];

      if (existingIdx >= 0 && oldReactions[existingIdx].viewerReacted) {
        // Toggle off — decrement count or remove pill
        const existing = oldReactions[existingIdx];
        if (existing.count <= 1) {
          newReactions = oldReactions.filter((_, i) => i !== existingIdx);
        } else {
          newReactions = oldReactions.map((r, i) =>
            i === existingIdx ? { ...r, count: r.count - 1, viewerReacted: false } : r
          );
        }
      } else if (existingIdx >= 0) {
        // Emoji exists but viewer hasn't reacted — increment
        appliedViewerReaction = true;
        newReactions = oldReactions.map((r, i) =>
          i === existingIdx ? { ...r, count: r.count + 1, viewerReacted: true } : r
        );
      } else {
        // New reaction
        appliedViewerReaction = true;
        newReactions = [...oldReactions, { emoji, count: 1, firstReactedAt: Date.now(), viewerReacted: true }];
      }

      // Optimistic DB update
      await db.messages.update(messageId, { reactions: newReactions.length > 0 ? newReactions : undefined });
    });
    if (!found) return;

    // Rollback = undo only THIS call's delta against CURRENT state — never
    // write the pre-call snapshot back wholesale, which would clobber a
    // concurrent reaction that succeeded in the meantime.
    const rollbackReaction = async () => {
      await db.transaction('rw', db.messages, async () => {
        const msg = await db.messages.get(messageId);
        if (!msg) return;
        const current = msg.reactions || [];
        const idx = current.findIndex((r) => r.emoji === emoji);
        let next: ReactionSummary[];
        if (appliedViewerReaction) {
          // We added our reaction — remove it, but only if it's still there.
          if (idx < 0 || !current[idx].viewerReacted) return;
          next = current[idx].count <= 1
            ? current.filter((_, i) => i !== idx)
            : current.map((r, i) => (i === idx ? { ...r, count: r.count - 1, viewerReacted: false } : r));
        } else {
          // We removed our reaction — re-add it, unless it's back already.
          if (idx >= 0 && current[idx].viewerReacted) return;
          next = idx < 0
            ? [...current, { emoji, count: 1, firstReactedAt: Date.now(), viewerReacted: true }]
            : current.map((r, i) => (i === idx ? { ...r, count: r.count + 1, viewerReacted: true } : r));
        }
        await db.messages.update(messageId, { reactions: next.length > 0 ? next : undefined });
      });
    };

    const bridgeMsg = { type: 'REACT_EMOJI' as const, conversationId, messageId, emoji };

    if (!navigator.onLine) {
      await createQueuedAction({
        type: 'react_emoji',
        conversationId,
        rollbackData: { messageId, reactions: oldReactions.length > 0 ? oldReactions : undefined },
        bridgeMessage: bridgeMsg,
      });
      return;
    }

    const actionId = await createPendingAction({
      type: 'react_emoji',
      conversationId,
      rollbackData: { messageId, reactions: oldReactions.length > 0 ? oldReactions : undefined },
      bridgeMessage: bridgeMsg,
    });
    sendBridgeMessage(bridgeMsg)
      .then(async (res) => {
        if (res.success) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          await rollbackReaction();
          await db.pendingActions.update(actionId, { status: 'failed' });
          showToast({ message: 'Failed to react' });
        }
      })
      .catch(async () => {
        if (!navigator.onLine) {
          await queueAction(actionId, bridgeMsg);
          return;
        }
        await rollbackReaction();
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: 'Failed to react' });
      });
  }

  async function recallMessage(conversationId: string, messageId: string): Promise<void> {
    const msg = await db.messages.get(messageId);
    if (!msg) return;

    // Snapshot the conversation preview so a failed recall can restore it along
    // with the message (the optimistic delete below rewinds it to the prior msg).
    const prevConv = await db.conversations.get(conversationId);
    const restorePreview = async () => {
      if (prevConv) {
        await db.conversations.update(conversationId, {
          lastMessage: prevConv.lastMessage,
          lastActivityAt: prevConv.lastActivityAt,
        });
      }
    };

    // Optimistic delete
    await db.messages.delete(messageId);

    // Update conversation preview to show the previous message
    try {
      const remaining = await db.messages
        .where('[conversationId+createdAt]')
        .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
        .reverse()
        .first();
      if (remaining) {
        await db.conversations.update(conversationId, {
          lastMessage: remaining.body || '',
          lastActivityAt: remaining.createdAt,
        });
      }
      // If no remaining messages, keep the existing conversation preview
    } catch {}

    showToast({ message: 'Message unsent' });

    const bridgeMsg = { type: 'RECALL_MESSAGE' as const, conversationId, messageId };

    if (!navigator.onLine) {
      await createQueuedAction({
        type: 'recall_message',
        conversationId,
        rollbackData: { message: msg },
        bridgeMessage: bridgeMsg,
      });
      return;
    }

    const actionId = await createPendingAction({
      type: 'recall_message',
      conversationId,
      rollbackData: { message: msg },
      bridgeMessage: bridgeMsg,
    });
    sendBridgeMessage(bridgeMsg)
      .then(async (res) => {
        if (res.success) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          await db.messages.put(msg);
          await restorePreview();
          await db.pendingActions.update(actionId, { status: 'failed' });
          showToast({ message: res.error || 'Failed to unsend — message restored' });
        }
      })
      .catch(async () => {
        if (!navigator.onLine) {
          await queueAction(actionId, bridgeMsg);
          return;
        }
        await db.messages.put(msg);
        await restorePreview();
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: 'Failed to unsend — message restored' });
      });
  }

  return { archiveConversation, sendAndArchive, moveToFocused, moveToOther, moveToSpam, markRead, markUnread, sendMessage, deleteConversation, starConversation, editMessage, reactToMessage, recallMessage };
}
