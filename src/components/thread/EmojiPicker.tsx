import { useEffect, useRef, useState } from 'react';
import { searchEmoji, COMMON_EMOJI } from '@/lib/emoji-search';

interface EmojiPickerProps {
  /** Fired with the chosen emoji character; the popup stays open for multi-pick. */
  onSelect: (emoji: string) => void;
  /** Close the popup (outside click / Escape). */
  onClose: () => void;
}

/**
 * A clickable emoji picker popover — a search box over the gemoji dataset plus a
 * grid of common emoji shown before searching. Complements the `:shortcode`
 * autocomplete for people who'd rather browse than type.
 */
export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = query.trim() ? searchEmoji(query.trim(), 64) : COMMON_EMOJI;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on outside click or Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Emoji picker"
      className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-lg border border-edge bg-surface p-2 shadow-lg"
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji…"
        className="mb-2 w-full rounded-md bg-surface-input px-2.5 py-1.5 text-sm text-fg placeholder-fg-faint ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
      />
      {results.length === 0 ? (
        <p className="px-1 py-6 text-center text-xs text-fg-faint">No emoji found</p>
      ) : (
        <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto">
          {results.map((r) => (
            <button
              key={`${r.emoji}-${r.name}`}
              type="button"
              title={`:${r.name}:`}
              aria-label={r.name}
              onMouseDown={(e) => {
                e.preventDefault(); // keep textarea focus / caret
                onSelect(r.emoji);
              }}
              className="flex h-8 w-8 items-center justify-center rounded text-lg transition-colors hover:bg-surface-hover"
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
