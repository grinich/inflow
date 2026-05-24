import { nanoid } from 'nanoid';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import { useUIStore } from '@/store/ui-store';
import type { Conversation } from '@/types/conversation';

export function useOptimisticAction() {
  const showToast = useUIStore((s) => s.showToast);

  async function archiveConversation(conversation: Conversation) {
    const actionId = nanoid();
    const previousCategory = conversation.category || 'PRIMARY_INBOX';

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
        // Call unarchive API to move it back
        sendBridgeMessage({ type: 'UNARCHIVE', conversationId: conversation.id }).catch(() => {});
      },
    });

    // Fire and forget to API
    sendBridgeMessage({ type: 'ARCHIVE', conversationId: conversation.id })
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
        await db.conversations.update(conversation.id, { archived: 0, category: previousCategory });
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: 'Failed to archive — rolled back' });
      });
  }

  async function markRead(conversationId: string) {
    await db.conversations.update(conversationId, { read: 1 });
    sendBridgeMessage({ type: 'MARK_READ', conversationId }).catch(() => {});
  }

  async function markUnread(conversationId: string) {
    await db.conversations.update(conversationId, { read: 0 });

    sendBridgeMessage({ type: 'MARK_UNREAD', conversationId }).catch(async () => {
      await db.conversations.update(conversationId, { read: 1 });
      showToast({ message: 'Failed to mark unread — rolled back' });
    });
  }

  async function sendMessage(conversationId: string, body: string, files?: File[]): Promise<boolean> {
    const tempId = `temp-${nanoid()}`;

    // Build display attachments from files so the bubble renders them immediately
    const displayAttachments = files?.length
      ? files.map((f) => {
          if (f.type.startsWith('image/')) {
            return { type: 'image' as const, imageUrl: URL.createObjectURL(f) };
          }
          return {
            type: 'file' as const,
            fileName: f.name,
            fileSize: f.size,
            mimeType: f.type,
          };
        })
      : undefined;

    // Optimistic insert
    await db.messages.put({
      id: tempId,
      conversationId,
      senderUrn: 'me',
      senderName: 'You',
      senderPicture: '',
      body,
      createdAt: Date.now(),
      isFromMe: true,
      status: 'sending',
      attachments: displayAttachments,
    });

    // Stash files in IndexedDB so retry can recover them if sending fails
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
      });

      if (res.success) {
        await db.messages.update(tempId, { status: 'sent' });
        // Clean up stashed files on success
        await db.draftAttachments.delete(tempId).catch(() => {});
        return true;
      } else {
        const failReason = res.error || undefined;
        await db.messages.update(tempId, { status: 'failed', failReason });
        document.dispatchEvent(new CustomEvent('inflow:failed-change', { detail: conversationId }));
        return false;
      }
    } catch {
      await db.messages.update(tempId, { status: 'failed' });
      document.dispatchEvent(new CustomEvent('inflow:failed-change', { detail: conversationId }));
      return false;
    }
  }

  async function moveToOther(conversation: Conversation) {
    const actionId = nanoid();
    const previousCategory = conversation.category || 'PRIMARY_INBOX';

    // Optimistically update IndexedDB
    await db.conversations.update(conversation.id, { category: 'SECONDARY_INBOX' });
    await db.pendingActions.put({
      id: actionId,
      type: 'move_to_other',
      conversationId: conversation.id,
      status: 'pending',
      timestamp: Date.now(),
      rollbackData: { category: previousCategory },
    });

    // Show undo toast
    showToast({
      message: 'Moved to Other',
      undoConversationId: conversation.id,
      undoAction: async () => {
        await db.conversations.update(conversation.id, { category: previousCategory });
        await db.pendingActions.delete(actionId);
        sendBridgeMessage({ type: 'MOVE_TO_FOCUSED', conversationId: conversation.id }).catch(() => {});
      },
    });

    // Fire and forget to API
    sendBridgeMessage({ type: 'MOVE_TO_OTHER', conversationId: conversation.id })
      .then(async (res) => {
        if (res.success) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          await db.conversations.update(conversation.id, { category: previousCategory });
          await db.pendingActions.update(actionId, { status: 'failed' });
          showToast({ message: 'Failed to move — rolled back' });
        }
      })
      .catch(async () => {
        await db.conversations.update(conversation.id, { category: previousCategory });
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: 'Failed to move — rolled back' });
      });
  }

  async function moveToSpam(conversation: Conversation) {
    const actionId = nanoid();
    const previousCategory = conversation.category || 'PRIMARY_INBOX';

    await db.conversations.update(conversation.id, { category: 'SPAM' });
    await db.pendingActions.put({
      id: actionId,
      type: 'move_to_spam',
      conversationId: conversation.id,
      status: 'pending',
      timestamp: Date.now(),
      rollbackData: { category: previousCategory },
    });

    showToast({
      message: 'Marked as spam',
      undoConversationId: conversation.id,
      undoAction: async () => {
        await db.conversations.update(conversation.id, { category: previousCategory });
        await db.pendingActions.delete(actionId);
        sendBridgeMessage({ type: 'MOVE_TO_FOCUSED', conversationId: conversation.id }).catch(() => {});
      },
    });

    sendBridgeMessage({ type: 'MOVE_TO_SPAM', conversationId: conversation.id })
      .then(async (res) => {
        if (res.success) {
          await db.pendingActions.update(actionId, { status: 'confirmed' });
        } else {
          await db.conversations.update(conversation.id, { category: previousCategory });
          await db.pendingActions.update(actionId, { status: 'failed' });
          showToast({ message: 'Failed to mark as spam — rolled back' });
        }
      })
      .catch(async () => {
        await db.conversations.update(conversation.id, { category: previousCategory });
        await db.pendingActions.update(actionId, { status: 'failed' });
        showToast({ message: 'Failed to mark as spam — rolled back' });
      });
  }

  async function deleteConversation(conversation: Conversation) {
    // Remove from IndexedDB immediately
    await db.conversations.delete(conversation.id);
    await db.messages.where('conversationId').equals(conversation.id).delete();
    await db.syncQueue.delete(conversation.id).catch(() => {});

    // Fire and forget to API
    sendBridgeMessage({ type: 'DELETE_CONVERSATION', conversationId: conversation.id })
      .then(async (res) => {
        if (!res.success) {
          // Restore conversation on failure
          await db.conversations.put(conversation);
          showToast({ message: 'Failed to delete — restored' });
        }
      })
      .catch(async () => {
        await db.conversations.put(conversation);
        showToast({ message: 'Failed to delete — restored' });
      });
  }

  async function starConversation(conversation: Conversation) {
    if (conversation.starred) {
      // Unstar
      await db.conversations.update(conversation.id, { starred: 0 });
      showToast({ message: 'Star removed' });

      sendBridgeMessage({ type: 'UNSTAR', conversationId: conversation.id })
        .then(async (res) => {
          if (!res.success) {
            await db.conversations.update(conversation.id, { starred: 1 });
            showToast({ message: 'Failed to unstar — rolled back' });
          }
        })
        .catch(async () => {
          await db.conversations.update(conversation.id, { starred: 1 });
          showToast({ message: 'Failed to unstar — rolled back' });
        });
    } else {
      // Star
      await db.conversations.update(conversation.id, { starred: 1 });
      showToast({ message: 'Conversation starred' });

      sendBridgeMessage({ type: 'STAR', conversationId: conversation.id })
        .then(async (res) => {
          if (!res.success) {
            await db.conversations.update(conversation.id, { starred: 0 });
            showToast({ message: 'Failed to star — rolled back' });
          }
        })
        .catch(async () => {
          await db.conversations.update(conversation.id, { starred: 0 });
          showToast({ message: 'Failed to star — rolled back' });
        });
    }
  }

  async function editMessage(conversationId: string, messageId: string, newBody: string): Promise<boolean> {
    const oldMessage = await db.messages.get(messageId);
    if (!oldMessage) return false;

    // Optimistically update local DB
    await db.messages.update(messageId, { body: newBody, editedAt: Date.now() });

    try {
      const res = await sendBridgeMessage({
        type: 'EDIT_MESSAGE',
        conversationId,
        messageId,
        body: newBody,
      });

      if (!res.success) {
        // Rollback
        await db.messages.update(messageId, { body: oldMessage.body, editedAt: oldMessage.editedAt });
        showToast({ message: res.error || 'Failed to edit message' });
        return false;
      }
      return true;
    } catch {
      await db.messages.update(messageId, { body: oldMessage.body, editedAt: oldMessage.editedAt });
      showToast({ message: 'Failed to edit message' });
      return false;
    }
  }

  return { archiveConversation, moveToOther, moveToSpam, markRead, markUnread, sendMessage, deleteConversation, starConversation, editMessage };
}
