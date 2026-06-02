import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import { ENABLE_PROFILE_ENRICHMENT } from '@/lib/feature-flags';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useUIStore } from '@/store/ui-store';
import { useCachedImage } from '@/hooks/useCachedImage';
import { GroupAvatar } from '../common/GroupAvatar';
import type { Conversation } from '@/types/conversation';

/** Strip ", United States" (or ", US" / ", USA") from US locations to show just "City, State". */
function shortenLocation(location: string): string {
  return location.replace(/,\s*(United States|US|USA)\s*$/i, '').trim();
}

function CompanyLogoBadge({ url }: { url?: string }) {
  const src = useCachedImage(url || undefined);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded border border-surface bg-white object-contain"
    />
  );
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

  // Refresh profile data after staying on a thread for 2s (avoids spam during quick scrolling)
  useEffect(() => {
    if (!ENABLE_PROFILE_ENRICHMENT) return;
    if (!firstUrn) return;
    let stale = false;
    const timer = setTimeout(() => {
      sendBridgeMessage({ type: 'FETCH_PROFILE_BY_URN', urn: firstUrn }).then(async (res) => {
        if (stale || !res?.success || !res.data) return;
        const d = res.data;
        const updates: Record<string, string> = {};
        if (d.locationName) updates.location = d.locationName;
        if (d.company) updates.company = d.company;
        if (d.title) updates.title = d.title;
        if (d.companyLogoUrl) updates.companyLogoUrl = d.companyLogoUrl;
        if (Object.keys(updates).length > 0) {
          await db.profiles.update(firstUrn, updates);
        }
      }).catch(() => {});
    }, 2000);
    return () => { stale = true; clearTimeout(timer); };
  }, [firstUrn]);

  const profileUrl = profile?.publicId
    ? `https://www.linkedin.com/in/${profile.publicId}`
    : null;

  return (
    <div className="min-w-0 border-b border-edge px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {/* Avatar with company logo overlay */}
        {profileUrl ? (
          <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="relative shrink-0 cursor-pointer">
            <GroupAvatar
              names={conversation.participantNames}
              pictures={conversation.participantPictures}
              size={36}
            />
            <CompanyLogoBadge url={profile?.companyLogoUrl} />
          </a>
        ) : (
          <div className="relative shrink-0">
            <GroupAvatar
              names={conversation.participantNames}
              pictures={conversation.participantPictures}
              size={36}
            />
            <CompanyLogoBadge url={profile?.companyLogoUrl} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 text-sm font-semibold text-fg-strong">
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
              <span className="min-w-0 truncate text-xs text-fg-faint">({shortenLocation(profile.location)})</span>
            )}
          </div>
          {profile?.company ? (
            <p className="truncate text-xs text-fg-muted">
              {profile.company}{profile.title ? `, ${profile.title}` : ''}
            </p>
          ) : conversation.participantNames.length > 1 ? (
            <p className="truncate text-xs text-fg-muted">
              {conversation.participantNames.length} participants
            </p>
          ) : null}
          {profile?.occupation && profile?.company && (
            <p className="truncate text-xs text-fg-faint">{profile.occupation}</p>
          )}
        </div>

        {/* Action buttons */}
        <a
          href="https://github.com/grinich/inflow/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="mr-2 flex cursor-pointer items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Report Bug
        </a>
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
            {isInArchive ? 'Move to Focused' : 'Archive'}
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
