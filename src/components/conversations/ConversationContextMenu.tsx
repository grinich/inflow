import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import type { Conversation } from '@/types/conversation';

interface ConversationContextMenuProps {
  conversation: Conversation;
  /** Cursor position (viewport coordinates) where the menu opens. */
  x: number;
  y: number;
  onClose: () => void;
}

interface MenuItem {
  label: string;
  shortcut: string;
  danger?: boolean;
  onSelect: () => void;
}

/**
 * Right-click menu for a conversation row. Mirrors the keyboard shortcuts:
 * archive (E), star (S), move to Other (O), spam (!), delete (D) — spam and
 * delete route through the same confirm modals the shortcuts use.
 */
export function ConversationContextMenu({ conversation, x, y, onClose }: ConversationContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const actions = useOptimisticAction();
  const inboxTab = useUIStore((s) => s.inboxTab);

  // Clamp to the viewport so the menu never renders off-screen.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // Capture phase so Escape closes the menu before the global shortcut
    // handler sees it, and so a scroll anywhere (the list doesn't bubble
    // scroll to window) dismisses the menu instead of detaching it.
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const items: MenuItem[] = [
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
      label: 'Move to Other',
      shortcut: 'O',
      onSelect: () => actions.moveToOther(conversation),
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
    <div
      ref={menuRef}
      data-conversation-context-menu
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 min-w-44 select-none rounded-lg bg-surface-raised py-1 shadow-2xl ring-1 ring-ring"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className={`flex w-full cursor-pointer items-center justify-between gap-6 px-3 py-1.5 text-left text-sm ${
            item.danger
              ? 'text-red-400 hover:bg-red-500/10'
              : 'text-fg-secondary hover:bg-surface-hover hover:text-fg-strong'
          }`}
        >
          {item.label}
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px] text-fg-faint">
            {item.shortcut}
          </kbd>
        </button>
      ))}
    </div>
  );
}
