import { useEffect, useRef } from 'react';
import type { EmojiResult } from '@/lib/emoji-search';

interface EmojiAutocompleteProps {
  results: EmojiResult[];
  selectedIndex: number;
  query: string;
  onSelect: (result: EmojiResult) => void;
  onClose: () => void;
}

export function EmojiAutocomplete({
  results,
  selectedIndex,
  query,
  onSelect,
  onClose,
}: EmojiAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const item = container.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  if (results.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 z-50 mb-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-edge bg-surface shadow-lg"
    >
      {results.map((result, i) => {
        const isSelected = i === selectedIndex;
        // Highlight the matching prefix portion of the name
        const matchLen = query.length;
        const namePrefix = result.name.slice(0, matchLen);
        const nameSuffix = result.name.slice(matchLen);

        return (
          <button
            key={`${result.emoji}-${result.name}`}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault(); // Prevent textarea blur
              onSelect(result);
            }}
            className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
              isSelected ? 'bg-blue-600/15 text-fg' : 'text-fg-secondary hover:bg-surface-raised'
            }`}
          >
            <span className="text-base">{result.emoji}</span>
            <span className="min-w-0 truncate">
              <span className="text-fg-faint">:</span>
              {query ? (
                <>
                  <span className="font-medium text-fg">{namePrefix}</span>
                  <span>{nameSuffix}</span>
                </>
              ) : (
                <span>{result.name}</span>
              )}
              <span className="text-fg-faint">:</span>
            </span>
            {isSelected && (
              <kbd className="ml-auto shrink-0 rounded border border-ring-muted bg-surface px-1.5 py-0.5 font-mono text-[10px] leading-none text-fg-faint">
                ↵
              </kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}
