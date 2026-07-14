import { useRef, useEffect, memo } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import { useUIStore } from '@/store/ui-store';
import { preloadImages } from '@/hooks/useCachedImage';
import { stripFilterTokens } from '@/lib/search-filters';
import type { Conversation } from '@/types/conversation';

interface ConversationRowProps {
  conversation: Conversation;
  selected: boolean;
  index: number;
  onOpen: (conversation: Conversation, index: number) => void;
  onContextMenu?: (conversation: Conversation, e: React.MouseEvent) => void;
  /** Persisted draft text/attachments for this conversation (batched at the
   *  list level — a per-row DB read here made folder switches O(rows) in
   *  IndexedDB queries). */
  draftText: string;
  draftAttachmentCount: number;
  /** True when this conversation has a failed outgoing message. */
  hasFailed: boolean;
  /** Minute-level counter so relative timestamps refresh despite memoization. */
  timeTick: number;
  /** Avatar-rail mode: render only the avatar with unread/star badges. */
  compact?: boolean;
}

function RowImpl({
  conversation,
  selected,
  index,
  onOpen,
  onContextMenu,
  draftText,
  draftAttachmentCount,
  hasFailed,
  compact,
}: ConversationRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const searchQuery = useUIStore((s) => s.searchQuery);

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

  // Preload participant images when this row is visible, release when it scrolls out
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: (() => void) | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (cleanup) return; // already preloaded — don't double-count ref-counts
          const pics = conversation.participantPictures.filter(Boolean);
          if (pics.length > 0) cleanup = preloadImages(pics);
        } else {
          cleanup?.();
          cleanup = null;
        }
      },
      { rootMargin: '200px' } // start preloading slightly before visible
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cleanup?.();
    };
  }, [conversation.participantPictures]);

  // Show first names for group conversations, full name for 1:1
  const names = conversation.participantNames;
  const displayName = names.length > 1
    ? names.map(n => {
        const parts = n.split(' ');
        // Skip honorifics/prefixes to get the actual first name
        const prefixes = ['dr', 'mr', 'mrs', 'ms', 'prof', 'sir', 'rev', 'hon'];
        if (parts.length > 1 && prefixes.includes(parts[0].toLowerCase().replace('.', ''))) {
          return parts[1];
        }
        return parts[0];
      }).join(', ')
    : names[0] || 'Unknown';

  // Avatar rail: just the avatar with unread/star badges, name + preview in
  // the tooltip. Padding (not margin) provides spacing so offsetHeight — which
  // the list's windowing measures — stays accurate.
  if (compact) {
    return (
      <div
        ref={ref}
        data-conversation-id={conversation.id}
        onClick={() => onOpen(conversation, index)}
        onContextMenu={(e) => onContextMenu?.(conversation, e)}
        title={conversation.lastMessage ? `${displayName} — ${conversation.lastMessage}` : displayName}
        className="flex cursor-pointer justify-center px-2 py-1"
      >
        <div
          className={`relative rounded-xl p-1.5 transition-colors ${
            selected ? 'bg-surface-active' : 'hover:bg-surface-hover'
          }`}
        >
          <GroupAvatar
            names={conversation.participantNames}
            pictures={conversation.participantPictures}
            size={40}
          />
          {!conversation.read && (
            <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-surface" />
          )}
          {!!conversation.starred && (
            <svg
              className="absolute bottom-0.5 left-0.5 h-3.5 w-3.5 text-yellow-400 drop-shadow-sm"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="1"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      data-conversation-id={conversation.id}
      onClick={() => onOpen(conversation, index)}
      onContextMenu={(e) => onContextMenu?.(conversation, e)}
      className={`group relative flex cursor-pointer items-center gap-1.5 py-3 pl-1.5 pr-3 ${
        selected ? 'bg-surface-active' : 'hover:bg-surface-hover'
      }`}
    >
      {/* Unread / star indicator column */}
      <div className="flex w-4 shrink-0 flex-col items-center justify-center">
        {!!conversation.starred ? (
          <svg
            className="h-4.5 w-4.5 text-yellow-400"
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="1"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        ) : !conversation.read ? (
          <div className="h-2 w-2 rounded-full bg-blue-500" />
        ) : null}
      </div>

      {/* Avatar */}
      <div className="relative shrink-0">
        <GroupAvatar
          names={conversation.participantNames}
          pictures={conversation.participantPictures}
          size={40}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm ${conversation.read ? 'text-fg-secondary' : 'font-semibold text-fg-strong'}`}>
            {searchQuery ? highlightName(displayName, searchQuery) : displayName}
          </span>
          <span className="shrink-0 whitespace-nowrap text-xs text-fg-muted">
            {formatTimestamp(conversation.lastActivityAt)}
          </span>
        </div>
        <p className={`truncate text-sm ${conversation.read ? 'text-fg-muted' : 'text-fg-secondary'}`}>
          {hasFailed ? (
            <><span className="font-medium text-red-400/70">failed:</span> {conversation.lastMessage || 'message failed to send'}</>
          ) : conversation.draft === 1 ? (
            <><span className="font-medium text-orange-400/70">draft:</span> {conversation.lastMessage || 'new message'}</>
          ) : (draftText || draftAttachmentCount > 0) ? (
            <><span className="font-medium text-orange-400/70">draft:</span> {draftText || `${draftAttachmentCount} file${draftAttachmentCount !== 1 ? 's' : ''}`}</>
          ) : searchQuery && conversation.lastMessage
            ? highlightMatch(conversation.lastMessage, searchQuery)
            : conversation.lastMessage || <em className="text-fg-faint">image</em>}
        </p>
      </div>
    </div>
  );
}

/** Value-compare the fields a row actually renders, so live-query churn during
 *  background sync (new array identities every run) doesn't re-render hundreds
 *  of unchanged rows. */
function rowPropsEqual(prev: ConversationRowProps, next: ConversationRowProps): boolean {
  const a = prev.conversation;
  const b = next.conversation;
  return (
    prev.selected === next.selected &&
    prev.index === next.index &&
    prev.onOpen === next.onOpen &&
    prev.onContextMenu === next.onContextMenu &&
    prev.draftText === next.draftText &&
    prev.draftAttachmentCount === next.draftAttachmentCount &&
    prev.hasFailed === next.hasFailed &&
    prev.timeTick === next.timeTick &&
    prev.compact === next.compact &&
    a.id === b.id &&
    a.read === b.read &&
    a.starred === b.starred &&
    a.draft === b.draft &&
    a.lastMessage === b.lastMessage &&
    a.lastActivityAt === b.lastActivityAt &&
    a.participantNames.join('\0') === b.participantNames.join('\0') &&
    a.participantPictures.join('\0') === b.participantPictures.join('\0') &&
    (a.mergedIds ?? []).join('\0') === (b.mergedIds ?? []).join('\0')
  );
}

export const ConversationRow = memo(RowImpl, rowPropsEqual);

/** Highlight the first occurrence of `query` in a name string. */
function highlightName(text: string, query: string): React.ReactNode {
  const q = stripFilterTokens(query).toLowerCase();
  if (!q) return text;

  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;

  return (
    <>
      {text.slice(0, idx)}
      <span className="rounded-sm bg-yellow-400/30 px-0.5">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

/**
 * Find the last occurrence of `query` in `text` (case-insensitive) and return
 * a React fragment with the match wrapped in a yellow highlight span.
 * Shows a window of text around the match so it's visible in the truncated preview.
 */
function highlightMatch(text: string, query: string): React.ReactNode {
  const lower = text.toLowerCase();
  const q = stripFilterTokens(query).toLowerCase();
  if (!q) return text;

  const idx = lower.lastIndexOf(q);
  if (idx === -1) return text;

  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);

  // Show a short prefix so the highlighted match is visible within the truncated line
  const CONTEXT = 20;
  const prefix = idx <= CONTEXT
    ? text.slice(0, idx)
    : '…' + text.slice(idx - CONTEXT, idx);

  return (
    <>
      {prefix}
      <span className="rounded-sm bg-yellow-400/30 px-0.5">{match}</span>
      {after}
    </>
  );
}

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  try {
    return formatDistanceToNowStrict(new Date(ts), { addSuffix: false })
      .replace(' seconds', 's')
      .replace(' second', 's')
      .replace(' minutes', 'm')
      .replace(' minute', 'm')
      .replace(' hours', 'h')
      .replace(' hour', 'h')
      .replace(' days', 'd')
      .replace(' day', 'd')
      .replace(' months', 'mo')
      .replace(' month', 'mo')
      .replace(' years', 'y')
      .replace(' year', 'y');
  } catch {
    return '';
  }
}
