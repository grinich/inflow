import { useState, useEffect, useLayoutEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  onSelect: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  /** Cursor position (viewport coordinates) where the menu opens. */
  x: number;
  y: number;
  onClose: () => void;
  /** data-* attribute marking the menu root for tests, e.g. "data-message-context-menu". */
  dataAttr: string;
}

/**
 * Positioned right-click menu. Clamps to the viewport, closes on outside
 * mousedown, Escape, scroll, resize, and window blur; selecting an item
 * closes the menu before running its action.
 */
export function ContextMenu({ items, x, y, onClose, dataAttr }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

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

  return (
    <div
      ref={menuRef}
      {...{ [dataAttr]: '' }}
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
          {item.shortcut && (
            <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px] text-fg-faint">
              {item.shortcut}
            </kbd>
          )}
        </button>
      ))}
    </div>
  );
}
