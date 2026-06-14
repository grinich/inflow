import { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import { ENABLE_PROFILE_ENRICHMENT } from '@/lib/feature-flags';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useUIStore } from '@/store/ui-store';
import { useCachedImage } from '@/hooks/useCachedImage';
import { readLocal } from '@/lib/storage';
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
  const [whatsappDismissed, setWhatsappDismissed] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    readLocal<boolean>('whatsappButtonDismissed').then((dismissed) => {
      if (!dismissed) setWhatsappDismissed(false);
    });
  }, []);

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
        <button
          onClick={async () => {
            let copiedLogs = false;
            try {
              const res = await sendBridgeMessage({ type: 'GET_DEBUG_LOGS' });
              if (res.success && Array.isArray(res.data)) {
                const logs = (res.data as { ts: number; level: string; message: string }[])
                  .slice(-50)
                  .map((e) => {
                    const t = new Date(e.ts).toISOString().slice(11, 23);
                    return `[${t}] ${e.level.toUpperCase()} ${e.message}`;
                  })
                  .join('\n');
                if (logs) {
                  await navigator.clipboard.writeText(logs);
                  copiedLogs = true;
                }
              }
            } catch {}
            const body = [
              '## Bug Description',
              '_Describe the bug clearly._',
              '',
              '## Steps to Reproduce',
              '1. ',
              '2. ',
              '3. ',
              '',
              '## Expected Behavior',
              '_What did you expect to happen?_',
              '',
              '## Debug Logs',
              copiedLogs
                ? '_Debug logs have been copied to your clipboard. Paste them here._'
                : '_No logs available._',
            ].join('\n');
            const url = `https://github.com/grinich/inflow/issues/new?title=Bug:+&body=${encodeURIComponent(body)}`;
            window.open(url, '_blank');
            if (copiedLogs) {
              useUIStore.getState().showToast({ message: 'Debug logs copied to clipboard' });
            }
          }}
          className="mr-2 flex cursor-pointer items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Report Bug
        </button>
        {!whatsappDismissed && (
          <div className="group relative mr-2">
            <a
              href="https://chat.whatsapp.com/Cgj71APZz0uBkW5Y4WOhQO"
              target="_blank"
              rel="noopener noreferrer"
              className="flex cursor-pointer items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-green-500">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
              Join WhatsApp Group
            </a>
            <button
              onClick={() => {
                setWhatsappDismissed(true);
                chrome.storage.local.set({ whatsappButtonDismissed: true });
              }}
              className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-surface-raised text-fg-muted shadow ring-1 ring-ring transition-colors hover:bg-surface-hover hover:text-fg-strong group-hover:flex"
              aria-label="Dismiss"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
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
