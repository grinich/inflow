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

export function useOptimisticAction() {
  const showToast = useUIStore((s) => s.showToast);

  async function archiveConversation(conversation: Conversation) {
    const actionId = nanoid();
    const previousCategory = conversation.category || 'PRIMARY_INBOX';
    const bridgeMsg = { type: 'ARCHIVE', conversationId: conversation.id };

    // Optimistically update IndexedDB
    await db.conversations.update(conversation.id, { archived: 1, category: 'ARCHIVE' });
    await db.pendingActions.put({
      id: actionId,
      type: 'archive',
      conversationId: conversation.id,
      status: 'pending',
      timestamp: Date.now(),
      rollbackData: { archived: 0, category: previousCategory },
    });

    // Show undo toast
    showToast({
      message: 'Conversation archived',
      undoConversationId: conversation.id,
      undoAction: async () => {
        await db.conversations.update(conversation.id, { archived: 0, category: previousCategory });
        await db.pendingActions.delete(actionId);
        if (navigator.onLine) {
          sendBridgeMessage({ type: 'UNARCHIVE', conversationId: conversation.id }).catch(() => {});
        }
      },
    });

    // If offline, queue for later
    if (!navigator.onLine) {
      await queueAction(actionId, bridgeMsg);
      return;
    }

    // Fire and forget to API
    sendBridgeMessage(bridgeMsg)
      .then(async (res) => {
        if (res.success) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          // Rollback
          await db.conversations.update(conversation.id, { archived: 0, category: previousCategory });
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
        await db.conversations.update(conversation.id, { archived: 0, category: previousCategory });
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: 'Failed to archive — rolled back' });
      });
  }

  async function markRead(conversationId: string) {
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

    const queueMarkRead = () =>
      createQueuedAction({ type: 'markRead', conversationId, rollbackData: { read: 0 }, bridgeMessage: bridgeMsg });
    sendBridgeMessage(bridgeMsg)
      // The router resolves {success:false} on a server error (never rejects), so
      // queue a retry on !success too — not only on a thrown rejection.
      .then((res) => { if (!res.success) return queueMarkRead(); })
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

    const rollbackUnread = async () => {
      await db.conversations.update(conversationId, { read: 1 });
      showToast({ message: 'Failed to mark unread — rolled back' });
    };
    sendBridgeMessage(bridgeMsg)
      // Server errors resolve {success:false} (no rejection), so roll back on that too.
      .then((res) => { if (!res.success) return rollbackUnread(); })
      .catch(async () => {
        if (!navigator.onLine) {
          await createQueuedAction({
            type: 'markUnread',
            conversationId,
            rollbackData: { read: 1 },
            bridgeMessage: bridgeMsg,
          });
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
    const archiveBridgeMsg = { type: 'ARCHIVE' as const, conversationId };

    // 1. Archive optimistically FIRST
    await db.conversations.update(conversationId, { archived: 1, category: 'ARCHIVE' });
    await db.pendingActions.put({
      id: actionId,
      type: 'archive',
      conversationId,
      status: 'pending',
      timestamp: Date.now(),
      rollbackData: { archived: 0, category: previousCategory },
    });

    // 2. Show undo toast
    showToast({
      message: 'Message sent & archived',
      undoConversationId: conversationId,
      undoAction: async () => {
        await db.conversations.update(conversationId, { archived: 0, category: previousCategory });
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
      showToast({ message: 'Failed to send message' });
      return;
    }
    try {
      const res = await sendBridgeMessage(archiveBridgeMsg);
      if (res.success) {
        await db.pendingActions.update(actionId, { status: 'confirmed' });
      } else {
        await db.conversations.update(conversationId, { archived: 0, category: previousCategory });
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: 'Failed to archive — rolled back' });
      }
    } catch {
      if (!navigator.onLine) {
        await queueAction(actionId, archiveBridgeMsg);
        return;
      }
      await db.conversations.update(conversationId, { archived: 0, category: previousCategory });
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
    const bridgeMsg = { type: opts.bridgeType, conversationId: conversation.id };

    // Restore the previous category; also restore archived iff the patch touched it.
    const rollbackData: Partial<Conversation> =
      'archived' in opts.patch
        ? { archived: conversation.archived, category: previousCategory }
        : { category: previousCategory };

    await db.conversations.update(conversation.id, opts.patch);
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
        await db.conversations.update(conversation.id, rollbackData);
        await db.pendingActions.delete(actionId);
        if (!navigator.onLine) return;
        const restoreType = RESTORE_BRIDGE[previousCategory] || 'MOVE_TO_FOCUSED';
        sendBridgeMessage({ type: restoreType, conversationId: conversation.id }).catch(() => {});
      },
    });

    if (!navigator.onLine) {
      await queueAction(actionId, bridgeMsg);
      return;
    }

    const rollback = async () => {
      await db.conversations.update(conversation.id, rollbackData);
      await db.pendingActions.update(actionId, { status: 'failed' });
      showToast({ message: opts.failMessage });
    };

    sendBridgeMessage(bridgeMsg)
      .then(async (res) => {
        if (res.success) {
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
      });
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
      patch: { category: 'SECONDARY_INBOX' },
      toastMessage: 'Moved to Other',
      failMessage: 'Failed to move — rolled back',
    });
  }

  function moveToSpam(conversation: Conversation) {
    return categoryMove(conversation, {
      type: 'move_to_spam',
      bridgeType: 'MOVE_TO_SPAM',
      patch: { category: 'SPAM' },
      toastMessage: 'Marked as spam',
      failMessage: 'Failed to mark as spam — rolled back',
    });
  }

  async function deleteConversation(conversation: Conversation) {
    // Save messages + syncQueue row for rollback before deleting
    const savedMessages = await db.messages.where('conversationId').equals(conversation.id).toArray();
    const savedQueueItem = await db.syncQueue.get(conversation.id).catch(() => undefined);
    const bridgeMsg = { type: 'DELETE_CONVERSATION' as const, conversationId: conversation.id };

    // Remove from IndexedDB immediately (atomic transaction)
    await db.transaction('rw', [db.conversations, db.messages, db.syncQueue], async () => {
      await db.conversations.delete(conversation.id);
      await db.messages.where('conversationId').equals(conversation.id).delete();
      await db.syncQueue.delete(conversation.id).catch(() => {});
    });

    if (!navigator.onLine) {
      await createQueuedAction({
        type: 'delete',
        conversationId: conversation.id,
        rollbackData: { conversation, messages: savedMessages },
        bridgeMessage: bridgeMsg,
      });
      return;
    }

    sendBridgeMessage(bridgeMsg)
      .then(async (res) => {
        if (!res.success) {
          await db.conversations.put(conversation);
          if (savedMessages.length > 0) await db.messages.bulkPut(savedMessages);
          if (savedQueueItem) await db.syncQueue.put(savedQueueItem).catch(() => {});
          showToast({ message: 'Failed to delete — restored' });
        }
      })
      .catch(async () => {
        if (!navigator.onLine) {
          await createQueuedAction({
            type: 'delete',
            conversationId: conversation.id,
            rollbackData: { conversation, messages: savedMessages },
            bridgeMessage: bridgeMsg,
          });
          return;
        }
        await db.conversations.put(conversation);
        if (savedMessages.length > 0) await db.messages.bulkPut(savedMessages);
        if (savedQueueItem) await db.syncQueue.put(savedQueueItem).catch(() => {});
        showToast({ message: 'Failed to delete — restored' });
      });
  }

  async function starConversation(conversation: Conversation) {
    if (conversation.starred) {
      // Unstar
      await db.conversations.update(conversation.id, { starred: 0 });
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

      sendBridgeMessage(bridgeMsg)
        .then(async (res) => {
          if (!res.success) {
            await db.conversations.update(conversation.id, { starred: 1 });
            showToast({ message: 'Failed to unstar — rolled back' });
          }
        })
        .catch(async () => {
          if (!navigator.onLine) {
            await createQueuedAction({
              type: 'unstar',
              conversationId: conversation.id,
              rollbackData: { starred: 1 },
              bridgeMessage: bridgeMsg,
            });
            return;
          }
          await db.conversations.update(conversation.id, { starred: 1 });
          showToast({ message: 'Failed to unstar — rolled back' });
        });
    } else {
      // Star
      await db.conversations.update(conversation.id, { starred: 1 });
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

      sendBridgeMessage(bridgeMsg)
        .then(async (res) => {
          if (!res.success) {
            await db.conversations.update(conversation.id, { starred: 0 });
            showToast({ message: 'Failed to star — rolled back' });
          }
        })
        .catch(async () => {
          if (!navigator.onLine) {
            await createQueuedAction({
              type: 'star',
              conversationId: conversation.id,
              rollbackData: { starred: 0 },
              bridgeMessage: bridgeMsg,
            });
            return;
          }
          await db.conversations.update(conversation.id, { starred: 0 });
          showToast({ message: 'Failed to star — rolled back' });
        });
    }
  }

  async function editMessage(conversationId: string, messageId: string, newBody: string): Promise<boolean> {
    const oldMessage = await db.messages.get(messageId);
    if (!oldMessage) return false;

    const bridgeMsg = { type: 'EDIT_MESSAGE' as const, conversationId, messageId, body: newBody };

    // Optimistically update local DB
    await db.messages.update(messageId, { body: newBody, editedAt: Date.now() });

    if (!navigator.onLine) {
      await createQueuedAction({
        type: 'edit_message',
        conversationId,
        rollbackData: { messageId, body: oldMessage.body, editedAt: oldMessage.editedAt },
        bridgeMessage: bridgeMsg,
      });
      return true;
    }

    try {
      const res = await sendBridgeMessage(bridgeMsg);

      if (!res.success) {
        await db.messages.update(messageId, { body: oldMessage.body, editedAt: oldMessage.editedAt });
        showToast({ message: res.error || 'Failed to edit message' });
        return false;
      }
      return true;
    } catch {
      if (!navigator.onLine) {
        await createQueuedAction({
          type: 'edit_message',
          conversationId,
          rollbackData: { messageId, body: oldMessage.body, editedAt: oldMessage.editedAt },
          bridgeMessage: bridgeMsg,
        });
        return true;
      }
      await db.messages.update(messageId, { body: oldMessage.body, editedAt: oldMessage.editedAt });
      showToast({ message: 'Failed to edit message' });
      return false;
    }
  }

  async function reactToMessage(conversationId: string, messageId: string, emoji: string): Promise<void> {
    // Serialize the read-modify-write in a transaction so two rapid reactions on
    // the same message can't both read the old reactions and clobber each other.
    let oldReactions: ReactionSummary[] = [];
    let found = false;
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
        newReactions = oldReactions.map((r, i) =>
          i === existingIdx ? { ...r, count: r.count + 1, viewerReacted: true } : r
        );
      } else {
        // New reaction
        newReactions = [...oldReactions, { emoji, count: 1, firstReactedAt: Date.now(), viewerReacted: true }];
      }

      // Optimistic DB update
      await db.messages.update(messageId, { reactions: newReactions.length > 0 ? newReactions : undefined });
    });
    if (!found) return;

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

    sendBridgeMessage(bridgeMsg)
      .then(async (res) => {
        if (!res.success) {
          await db.messages.update(messageId, { reactions: oldReactions.length > 0 ? oldReactions : undefined });
          showToast({ message: 'Failed to react' });
        }
      })
      .catch(async () => {
        if (!navigator.onLine) {
          await createQueuedAction({
            type: 'react_emoji',
            conversationId,
            rollbackData: { messageId, reactions: oldReactions.length > 0 ? oldReactions : undefined },
            bridgeMessage: bridgeMsg,
          });
          return;
        }
        await db.messages.update(messageId, { reactions: oldReactions.length > 0 ? oldReactions : undefined });
        showToast({ message: 'Failed to react' });
      });
  }

  async function recallMessage(conversationId: string, messageId: string): Promise<void> {
    const msg = await db.messages.get(messageId);
    if (!msg) return;

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

    sendBridgeMessage(bridgeMsg)
      .then(async (res) => {
        if (!res.success) {
          await db.messages.put(msg);
          showToast({ message: res.error || 'Failed to unsend — message restored' });
        }
      })
      .catch(async () => {
        if (!navigator.onLine) {
          await createQueuedAction({
            type: 'recall_message',
            conversationId,
            rollbackData: { message: msg },
            bridgeMessage: bridgeMsg,
          });
          return;
        }
        await db.messages.put(msg);
        showToast({ message: 'Failed to unsend — message restored' });
      });
  }

  return { archiveConversation, sendAndArchive, moveToFocused, moveToOther, moveToSpam, markRead, markUnread, sendMessage, deleteConversation, starConversation, editMessage, reactToMessage, recallMessage };
}
