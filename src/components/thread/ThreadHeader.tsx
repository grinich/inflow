import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useUIStore } from '@/store/ui-store';
import { GroupAvatar } from '../common/GroupAvatar';
import type { Conversation } from '@/types/conversation';

/** Strip ", United States" (or ", US" / ", USA") from US locations to show just "City, State". */
function shortenLocation(location: string): string {
  return location.replace(/,\s*(United States|US|USA)\s*$/i, '').trim();
}

interface ThreadHeaderProps {
  conversation: Conversation;
}

export function ThreadHeader({ conversation }: ThreadHeaderProps) {
  const { archiveConversation, moveToFocused, moveToOther, moveToSpam, markUnread, starConversation: starConv } = useOptimisticAction();
  const inboxTab = useUIStore((s) => s.inboxTab);
  const isInArchive = inboxTab === 'archived';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);
  // Reactively read profiles for all participants
  const participantUrns = conversation.participantUrns;
  const profiles = useLiveQuery(
    () => (participantUrns.length > 0 && db)
      ? db.profiles.where('urn').anyOf(participantUrns).toArray()
      : [],
    [participantUrns.join(',')]
  ) ?? [];
  const profilesByUrn = new Map(profiles.map((p) => [p.urn, p]));

  const firstUrn = participantUrns[0];
  const profile = profilesByUrn.get(firstUrn) ?? null;

  const profileUrl = profile?.publicId
    ? `https://www.linkedin.com/in/${profile.publicId}`
    : null;

  return (
    <div className="min-w-0 border-b border-edge px-4 py-3 @container">
      <div className="flex min-w-0 items-center gap-3">
        {/* Avatar with company logo overlay */}
        {profileUrl ? (
          <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="relative shrink-0 cursor-pointer">
            <GroupAvatar
              names={conversation.participantNames}
              pictures={conversation.participantPictures}
              size={36}
            />
          </a>
        ) : (
          <div className="relative shrink-0">
            <GroupAvatar
              names={conversation.participantNames}
              pictures={conversation.participantPictures}
              size={36}
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate text-sm font-semibold text-fg-strong">
              {conversation.participantNames.length === 0 ? 'Unknown' : conversation.participantNames.map((name, i) => {
                const urn = participantUrns[i];
                const p = urn ? profilesByUrn.get(urn) : undefined;
                const url = p?.publicId ? `https://www.linkedin.com/in/${p.publicId}` : null;
                return (
                  <span key={urn || i}>
                    {i > 0 && <span className="text-fg-muted font-normal">, </span>}
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="hover:underline">{name}</a>
                    ) : name}
                  </span>
                );
              })}
            </h2>
            {profile?.location && (
              <span className="hidden min-w-0 truncate text-xs text-fg-faint @[36rem]:inline">({shortenLocation(profile.location)})</span>
            )}
          </div>
          {conversation.participantNames.length > 1 && (
            <p className="truncate text-xs text-fg-muted">
              {conversation.participantNames.length} participants
            </p>
          )}
        </div>

        <div ref={menuRef} className="relative flex shrink-0 items-center">
          <button
            onClick={() => starConv(conversation)}
            title={conversation.starred ? 'Unstar' : 'Star'}
            className="flex cursor-pointer items-center self-stretch rounded-l-md border border-edge px-1.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-yellow-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={conversation.starred ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={conversation.starred ? 'text-yellow-400' : ''}>
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
          <button
            onClick={() => isInArchive ? moveToFocused(conversation) : archiveConversation(conversation)}
            className="flex cursor-pointer items-center gap-1.5 border border-l-0 border-edge px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
          >
            <span className="whitespace-nowrap">{isInArchive ? 'Move to Focused' : 'Archive'}</span>
            <kbd className="rounded bg-surface px-1 py-px font-mono text-[10px] text-fg-faint ring-1 ring-ring">E</kbd>
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex cursor-pointer items-center self-stretch rounded-r-md border border-l-0 border-edge px-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 overflow-hidden rounded-lg border border-edge bg-surface-raised py-1 shadow-xl">
              <button
                onClick={() => { markUnread(conversation.id); setMenuOpen(false); }}
                className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong"
              >
                <span>Mark as Unread</span>
                <kbd className="rounded bg-surface px-1 py-px font-mono text-[10px] text-fg-faint ring-1 ring-ring">U</kbd>
              </button>
              <button
                onClick={() => { moveToOther(conversation); setMenuOpen(false); }}
                className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong"
              >
                <span>Move to Other</span>
                <kbd className="rounded bg-surface px-1 py-px font-mono text-[10px] text-fg-faint ring-1 ring-ring">O</kbd>
              </button>
              {conversation.category === 'SPAM' ? (
                <button
                  onClick={() => { moveToOther(conversation); setMenuOpen(false); }}
                  className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong"
                >
                  <span>Mark as Not Spam</span>
                  <kbd className="rounded bg-surface px-1 py-px font-mono text-[10px] text-fg-faint ring-1 ring-ring">O</kbd>
                </button>
              ) : (
                <button
                  onClick={() => { moveToSpam(conversation); setMenuOpen(false); }}
                  className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong"
                >
                  <span>Mark as Spam</span>
                  <kbd className="rounded bg-surface px-1 py-px font-mono text-[10px] text-fg-faint ring-1 ring-ring">!</kbd>
                </button>
              )}
              <div className="my-1 border-t border-edge" />
              <button
                onClick={() => { useUIStore.getState().setDeleteConfirmId(conversation.id); setMenuOpen(false); }}
                className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-sm text-red-400 transition-colors hover:bg-surface-hover hover:text-red-300"
              >
                <span>Delete Conversation</span>
                <kbd className="rounded bg-surface px-1 py-px font-mono text-[10px] text-fg-faint ring-1 ring-ring">D</kbd>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
