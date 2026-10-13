import { useState } from 'react';
import { useOutbox } from '@/hooks/useOutbox';
import type { ScheduledMessage } from '@/types/scheduled-message';
import { useUIStore } from '@/store/ui-store';
import { McpStatusBar } from './McpStatusBar';
import { OutboxRow } from './OutboxRow';

function Section({ title, count, hint, list, children }: { title: string; count?: number; hint?: string; list?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{title}</h3>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-surface-input px-1.5 text-[10px] font-semibold tabular-nums text-fg-muted">{count}</span>
        )}
        {hint && <span className="text-[11px] text-fg-faint">{hint}</span>}
      </div>
      {/* Grid: cards wrap across the width and stretch, so a row is not left
          as tall as its longest message. Capped at three columns — a fourth
          made each card too narrow for message-length text.
          List: one per line, each clamped to a couple of lines, for scanning
          a long queue rather than reading it. */}
      <div className={list ? 'flex flex-col gap-2' : 'grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3'}>
        {children}
      </div>
    </section>
  );
}

/**
 * The Outbox — a status view of the local outbound pipeline. It never composes
 * (that happens in the one message composer) and never auto-sends: a scheduled
 * message whose time has arrived is *resurfaced* as "Ready to send" for a
 * one-click send. Composing a new message opens the shared composer.
 */
export function OutboxView() {
  const { ready, scheduled, drafts, failed } = useOutbox();
  const outboxView = useUIStore((s) => s.outboxView);
  const setOutboxView = useUIStore((s) => s.setOutboxView);
  const [query, setQuery] = useState('');

  // Filters across every section at once: the thing you remember about a
  // queued message is who it is to or what it says, not which status bucket
  // it happens to be sitting in.
  const q = query.trim().toLowerCase();
  const match = (m: ScheduledMessage) =>
    !q ||
    (m.recipientName || '').toLowerCase().includes(q) ||
    (m.inMailSubject || '').toLowerCase().includes(q) ||
    m.body.toLowerCase().includes(q);

  const list = outboxView === 'list';
  const shown = {
    ready: ready.filter(match),
    scheduled: scheduled.filter(match),
    drafts: drafts.filter(match),
    failed: failed.filter(match),
  };
  const nothingMatches = q && Object.values(shown).every((g) => g.length === 0);

  const goToInboxTab = (tab: 'drafts' | 'scheduled') => {
    const store = useUIStore.getState();
    store.setActiveSection('inbox');
    store.setInboxTab(tab);
  };

  // Sent history lives in the connector's activity log, not as a queue section.
  const queueEmpty = ready.length + scheduled.length + drafts.length + failed.length === 0;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-6 py-3">
        <h2 className="text-base font-semibold text-fg-strong">MCP connector</h2>
        <span className="text-[11px] text-fg-faint">It reads your network and executes actions from Claude via MCP.</span>

        {/* Only once there is a queue worth searching or re-laying-out. */}
        {!queueEmpty && (
          <div className="ml-auto flex items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or text"
              aria-label="Filter the queue"
              className="w-52 rounded-md bg-surface-input px-2.5 py-1 text-xs text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
            />
            <div className="flex rounded-md ring-1 ring-inset ring-edge" role="group" aria-label="Layout">
              {([
                { v: 'grid' as const, label: 'Grid', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
                { v: 'list' as const, label: 'List', d: 'M4 6h16M4 12h16M4 18h16' },
              ]).map((o) => (
                <button
                  key={o.v}
                  onClick={() => setOutboxView(o.v)}
                  aria-pressed={outboxView === o.v}
                  title={`${o.label} view`}
                  aria-label={`${o.label} view`}
                  className={`px-2 py-1 transition-colors first:rounded-l-md last:rounded-r-md ${
                    outboxView === o.v ? 'bg-surface-input text-fg-strong' : 'text-fg-muted hover:text-fg-secondary'
                  }`}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={o.d} />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full space-y-6 px-6 py-5">
          <McpStatusBar />

          {queueEmpty ? (
            <div className="rounded-xl border border-dashed border-edge px-4 py-10 text-center">
              <p className="text-sm text-fg-muted">No drafts or scheduled sends yet.</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-fg-faint">
                Ask Claude to draft outreach, or save a draft from the composer. It’ll show up here — and in your Inbox — to review and send.
              </p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  onClick={() => goToInboxTab('drafts')}
                  className="rounded-md bg-surface-input px-3 py-1.5 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
                >
                  Open Drafts in Inbox
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {nothingMatches && (
                <p className="rounded-xl border border-dashed border-edge px-4 py-8 text-center text-sm text-fg-muted">
                  Nothing in the queue matches “{query.trim()}”.
                </p>
              )}
              {shown.ready.length > 0 && (
                <Section title="Ready to send" count={shown.ready.length} hint="Scheduled time reached — send when you’re ready" list={list}>
                  {shown.ready.map((m) => <OutboxRow key={m.id} msg={m} ready dense={list} />)}
                </Section>
              )}
              {shown.scheduled.length > 0 && (
                <Section title="Scheduled" count={shown.scheduled.length} list={list}>
                  {shown.scheduled.map((m) => <OutboxRow key={m.id} msg={m} dense={list} />)}
                </Section>
              )}
              {shown.drafts.length > 0 && (
                <Section title="Drafts" count={shown.drafts.length} list={list}>
                  {shown.drafts.map((m) => <OutboxRow key={m.id} msg={m} dense={list} />)}
                </Section>
              )}
              {shown.failed.length > 0 && (
                <Section title="Failed" count={shown.failed.length} list={list}>
                  {shown.failed.map((m) => <OutboxRow key={m.id} msg={m} dense={list} />)}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
