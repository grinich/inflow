import { useUIStore } from '@/store/ui-store';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { ContextMenu, type ContextMenuItem } from '@/components/common/ContextMenu';
import type { Conversation } from '@/types/conversation';
import { otherSlotTarget, moveTargetLabel } from '@/lib/conversation-move';

interface ConversationContextMenuProps {
  conversation: Conversation;
  /** Cursor position (viewport coordinates) where the menu opens. */
  x: number;
  y: number;
  onClose: () => void;
}

/**
 * Right-click menu for a conversation row. Mirrors the keyboard shortcuts:
 * archive (E), star (S), read/unread (U), move to Other/Focused (O),
 * spam (!), delete (D) — spam and delete route through the same confirm
 * modals the shortcuts use.
 */
export function ConversationContextMenu({ conversation, x, y, onClose }: ConversationContextMenuProps) {
  const actions = useOptimisticAction();
  const inboxTab = useUIStore((s) => s.inboxTab);

  const items: ContextMenuItem[] = [
    {
      label: inboxTab === 'archived' ? 'Move to Focused' : 'Archive',
      shortcut: 'E',
      onSelect: () =>
        inboxTab === 'archived'
          ? actions.moveToFocused(conversation)
          : actions.archiveConversation(conversation),
    },
    {
      label: conversation.starred ? 'Remove star' : 'Star',
      shortcut: 'S',
      onSelect: () => actions.starConversation(conversation),
    },
    {
      label: conversation.read === 0 ? 'Mark as read' : 'Mark as unread',
      shortcut: 'U',
      onSelect: () =>
        conversation.read === 0
          ? actions.markRead(conversation.id, conversation.mergedIds)
          : actions.markUnread(conversation.id),
    },
    {
      label: moveTargetLabel(otherSlotTarget(conversation, inboxTab)),
      shortcut: 'O',
      onSelect: () =>
        otherSlotTarget(conversation, inboxTab) === 'focused'
          ? actions.moveToFocused(conversation)
          : actions.moveToOther(conversation),
    },
    {
      label: 'Mark as spam',
      shortcut: '!',
      onSelect: () => useUIStore.getState().setSpamConfirmId(conversation.id),
    },
    {
      label: 'Delete',
      shortcut: 'D',
      danger: true,
      onSelect: () => useUIStore.getState().setDeleteConfirmId(conversation.id),
    },
  ];

  return (
    <ContextMenu
      dataAttr="data-conversation-context-menu"
      items={items}
      x={x}
      y={y}
      onClose={onClose}
    />
  );
}
