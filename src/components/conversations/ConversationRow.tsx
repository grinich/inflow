import { useRef, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import { useUIStore } from '@/store/ui-store';
import { db } from '@/db/database';
import { preloadImages, useCachedImage } from '@/hooks/useCachedImage';
import { stripFilterTokens } from '@/lib/search-filters';
import type { Conversation } from '@/types/conversation';

interface DraftInfo {
  text: string;
  attachmentCount: number;
}

function useDraft(conversationId: string): DraftInfo {
  const [draft, setDraft] = useState<DraftInfo>({ text: '', attachmentCount: 0 });

  useEffect(() => {
    function refresh() {
      db.draftAttachments.get(conversationId).then((row) => {
        const text = row?.text || '';
        const attachmentCount = row?.files?.length || 0;
        // Only update when the value actually changed. ComposeBox dispatches
        // inflow:draft-change every second, which would otherwise re-render this
        // row (and the list) every tick for no reason.
        setDraft((prev) => (prev.text === text && prev.attachmentCount === attachmentCount ? prev : { text, attachmentCount }));
      }).catch(() => {
        setDraft((prev) => (prev.text === '' && prev.attachmentCount === 0 ? prev : { text: '', attachmentCount: 0 }));
      });
    }
    refresh(); // read once on mount

    function onDraftChange(e: Event) {
      if ((e as CustomEvent).detail === conversationId) refresh();
    }
    document.addEventListener('inflow:draft-change', onDraftChange);
    return () => document.removeEventListener('inflow:draft-change', onDraftChange);
  }, [conversationId]);

  return draft;
}

function useHasFailedMessage(conversationId: string): boolean {
  const [hasFailed, setHasFailed] = useState(false);

  useEffect(() => {
    function refresh() {
      db.messages
        .where('conversationId')
        .equals(conversationId)
        .filter((m) => m.status === 'failed')
        .count()
        .then((n) => setHasFailed(n > 0))
        .catch(() => setHasFailed(false));
    }
    refresh(); // read once on mount

    function onFailedChange(e: Event) {
      if ((e as CustomEvent).detail === conversationId) refresh();
    }
    document.addEventListener('inflow:failed-change', onFailedChange);
    return () => document.removeEventListener('inflow:failed-change', onFailedChange);
  }, [conversationId]);

  return hasFailed;
}

interface ConversationRowProps {
  conversation: Conversation;
  selected: boolean;
  onClick: () => void;
}

export function ConversationRow({ conversation, selected, onClick }: ConversationRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const searchQuery = useUIStore((s) => s.searchQuery);
  const draft = useDraft(conversation.id);
  const hasFailed = useHasFailedMessage(conversation.id);
  const firstUrn = conversation.participantUrns[0];
  const profileInfo = useLiveQuery(
    () => (firstUrn && db) ? db.profiles.get(firstUrn).then((p) => ({ company: p?.company || '', logoUrl: p?.companyLogoUrl || '' })) : { company: '', logoUrl: '' },
    [firstUrn]
  ) || { company: '', logoUrl: '' };
  const company = profileInfo.company;
  const companyLogoSrc = useCachedImage(profileInfo.logoUrl || undefined);

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

  return (
    <div
      ref={ref}
      data-conversation-id={conversation.id}
      onClick={onClick}
      className={`group relative flex cursor-pointer items-center gap-2 px-3 py-3 ${
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

      {/* Avatar with company logo */}
      <div className="relative shrink-0">
        <GroupAvatar
          names={conversation.participantNames}
          pictures={conversation.participantPictures}
          size={40}
        />
        {companyLogoSrc && (
          <img
            src={companyLogoSrc}
            alt=""
            className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded border border-surface bg-white object-contain"
          />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm ${conversation.read ? 'text-fg-secondary' : 'font-semibold text-fg-strong'}`}>
            {searchQuery ? highlightName(displayName, searchQuery) : displayName}
            {company && <span className="font-normal text-fg-muted">, {company}</span>}
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
          ) : (draft.text || draft.attachmentCount > 0) ? (
            <><span className="font-medium text-orange-400/70">draft:</span> {draft.text || `${draft.attachmentCount} file${draft.attachmentCount !== 1 ? 's' : ''}`}</>
          ) : searchQuery && conversation.lastMessage
            ? highlightMatch(conversation.lastMessage, searchQuery)
            : conversation.lastMessage || <em className="text-fg-faint">image</em>}
        </p>
      </div>
    </div>
  );
}

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
    : '\u2026' + text.slice(idx - CONTEXT, idx);

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
