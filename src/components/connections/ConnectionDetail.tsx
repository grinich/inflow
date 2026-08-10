import { useLiveQuery } from 'dexie-react-hooks';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { GroupAvatar } from '../common/GroupAvatar';
import { useConnections } from '@/hooks/useConnections';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import { useConnectionSummary } from '@/hooks/useConnectionSummary';
import { useConversationSummary } from '@/hooks/useConversationSummary';
import { useRefreshConnection } from '@/hooks/useRefreshConnection';
import { useUIStore } from '@/store/ui-store';
import { db } from '@/db/database';
import { isConversationSummaryStale } from '@/lib/connection-conversation-summary';
import { Markdown } from '@/components/common/Markdown';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { connectedLabel, connectionProfileUrl, roleBadgeClass, interestTagClass } from './connection-format';

export function ConnectionDetail() {
  const selectedUrn = useUIStore((s) => s.selectedConnectionUrn);
  const { connections } = useConnections();
  const connection = connections.find((c) => c.profileUrn === selectedUrn) || null;
  const dbGen = useDbGeneration();

  const { summary, generating } = useConnectionSummary(connection);
  const { refresh, refreshing, available: aiAvailable } = useRefreshConnection();
  const { summarize, summarizing, error: convError } = useConversationSummary();

  // Any richer profile fields we've picked up elsewhere (e.g. location from a
  // message-participant sync). Falls back gracefully when unknown.
  const profile = useLiveQuery(async () => {
    if (!db || !connection) return null;
    return (await db.profiles.get(connection.profileUrn)) ?? null;
  }, [connection?.profileUrn, dbGen]);

  // Existing conversation with this person, if any (so we can jump to it and
  // summarize it). Prefer a 1:1 thread, then the most recently active.
  const existingConv = useLiveQuery(async () => {
    if (!db || !connection) return null;
    const matches = await db.conversations
      .filter((c) => Array.isArray(c.participantUrns) && c.participantUrns.includes(connection.profileUrn))
      .toArray();
    if (matches.length === 0) return null;
    matches.sort((a, b) => {
      const aOne = (a.participantUrns?.length ?? 0) <= 2 ? 1 : 0;
      const bOne = (b.participantUrns?.length ?? 0) <= 2 ? 1 : 0;
      if (aOne !== bOne) return bOne - aOne;
      return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
    });
    return matches[0];
  }, [connection?.profileUrn, dbGen]);

  if (!connection) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <svg className="h-10 w-10 text-fg-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <p className="text-sm text-fg-muted">Select a connection to see their details.</p>
      </div>
    );
  }

  const name = connection.fullName || 'Unknown';
  const firstName = connection.firstName || name.split(' ')[0] || 'them';
  const location = profile?.location || '';
  const summaryStale = isConversationSummaryStale(connection, existingConv?.lastActivityAt);
  const lastMsgLabel = existingConv?.lastActivityAt
    ? formatDistanceToNowStrict(new Date(existingConv.lastActivityAt), { addSuffix: true })
    : '';
  const hasBadges =
    (connection.roleCategory && connection.roleCategory !== 'Other') ||
    (connection.interestTags?.length ?? 0) > 0;

  const openProfile = () => {
    window.open(connectionProfileUrl(connection.publicId, name), '_blank', 'noopener,noreferrer');
  };

  const openConversation = () => {
    if (!existingConv) return;
    useUIStore.getState().setActiveSection('inbox');
    useUIStore.getState().openThread(existingConv.id, 0);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-col items-center gap-4 px-8 pt-12 pb-6 text-center">
        <GroupAvatar names={[name]} pictures={[connection.pictureUrl]} size={96} />
        <div>
          <h2 className="text-xl font-semibold text-fg-strong">{name}</h2>
          {connection.headline && (
            <p className="mt-1 max-w-md text-sm text-fg-secondary">{connection.headline}</p>
          )}
        </div>

        {hasBadges && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {connection.roleCategory && connection.roleCategory !== 'Other' && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${roleBadgeClass(connection.roleCategory)}`}
              >
                {connection.roleCategory}
              </span>
            )}
            {connection.interestTags?.map((t) => (
              <span
                key={t}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${interestTagClass(t)}`}
              >
                ★ {t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={openProfile}
            className="btn-primary flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6M10 14L21 3" />
            </svg>
            Open LinkedIn profile
          </button>
        </div>
      </div>

      {/* Conversation: messaged status, jump-to-thread, and AI recap */}
      <div className="mx-8 mb-4 rounded-xl bg-surface-raised p-4 text-left ring-1 ring-inset ring-edge">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Conversation</p>
          {existingConv && aiAvailable && (
            <button
              onClick={() => summarize(connection, existingConv)}
              disabled={summarizing}
              title="Summarize your message history with this person"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary disabled:opacity-40"
            >
              {summarizing ? (
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6M1 20v-6h6" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              ) : (
                <SparkleIcon className="h-3 w-3" />
              )}
              {summarizing
                ? 'Summarizing…'
                : connection.conversationSummary
                  ? 'Re-summarize'
                  : 'Summarize'}
            </button>
          )}
        </div>

        {existingConv ? (
          <>
            <button
              onClick={openConversation}
              className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-blue-400 transition-colors hover:text-blue-300"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Open conversation
              {lastMsgLabel && <span className="font-normal text-fg-faint">· last message {lastMsgLabel}</span>}
            </button>

            {connection.conversationSummary ? (
              <div className="mt-3">
                {summaryStale && (
                  <span className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30">
                    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
                    </svg>
                    Outdated — new messages since
                  </span>
                )}
                <Markdown text={connection.conversationSummary} className="text-sm text-fg-secondary" />
              </div>
            ) : summarizing ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-fg-muted">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" />
                Summarizing your conversation…
              </p>
            ) : (
              <p className="mt-2 text-sm text-fg-faint">
                {aiAvailable
                  ? 'No conversation summary yet — click “Summarize”.'
                  : 'Add an AI key in Settings to summarize this conversation.'}
              </p>
            )}
            {convError && <p className="mt-2 text-xs text-red-500">{convError}</p>}
          </>
        ) : (
          <p className="mt-1.5 text-sm text-fg-faint">
            You haven’t messaged {firstName} yet.
          </p>
        )}
      </div>

      {/* Summary + facts */}
      <div className="mx-8 mb-8 space-y-4 rounded-xl bg-surface-raised p-4 text-left ring-1 ring-inset ring-edge">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Summary</p>
            {aiAvailable && (
              <button
                onClick={() => refresh(connection)}
                disabled={refreshing || generating}
                title="Re-fetch and re-analyze this connection"
                className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary disabled:opacity-40"
              >
                <svg
                  className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                >
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            )}
          </div>
          {generating ? (
            <p className="mt-1.5 flex items-center gap-2 text-sm text-fg-muted">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" />
              Summarizing…
            </p>
          ) : summary ? (
            <p className="mt-1.5 text-sm leading-relaxed text-fg-secondary">{summary}</p>
          ) : (
            <p className="mt-1.5 text-sm text-fg-faint">
              No summary available{connection.headline ? '' : ' — this person has no headline'}.
            </p>
          )}
        </div>

        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 border-t border-edge pt-3 text-sm">
          {connection.connectedAt > 0 && (
            <>
              <dt className="text-fg-faint">Connected</dt>
              <dd className="text-fg-secondary">
                {format(new Date(connection.connectedAt), 'MMM d, yyyy')}
                <span className="text-fg-faint"> · {connectedLabel(connection.connectedAt).replace(/^connected /, '')}</span>
              </dd>
            </>
          )}
          {location && (
            <>
              <dt className="text-fg-faint">Location</dt>
              <dd className="text-fg-secondary">{location}</dd>
            </>
          )}
          {connection.publicId && (
            <>
              <dt className="text-fg-faint">Profile</dt>
              <dd className="truncate">
                <a
                  href={connectionProfileUrl(connection.publicId, name)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300"
                >
                  /in/{connection.publicId}
                </a>
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
