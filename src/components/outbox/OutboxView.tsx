import { useOutbox } from '@/hooks/useOutbox';
import { useUIStore } from '@/store/ui-store';
import { McpStatusBar } from './McpStatusBar';
import { OutboxRow } from './OutboxRow';

function Section({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-faint">{title}</h3>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-surface-input px-1.5 text-[10px] font-semibold tabular-nums text-fg-muted">{count}</span>
        )}
        {hint && <span className="text-[11px] text-fg-faint">{hint}</span>}
      </div>
      {/* Cards flow left→right and wrap, filling the width instead of stacking
          in a single centered column. */}
      {/* Stretch, not items-start: with top-aligned cards every row was as tall
          as its longest message and the shorter cards trailed white space. */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
              {ready.length > 0 && (
                <Section title="Ready to send" count={ready.length} hint="Scheduled time reached — send when you’re ready">
                  {ready.map((m) => <OutboxRow key={m.id} msg={m} ready />)}
                </Section>
              )}
              {scheduled.length > 0 && (
                <Section title="Scheduled" count={scheduled.length}>
                  {scheduled.map((m) => <OutboxRow key={m.id} msg={m} />)}
                </Section>
              )}
              {drafts.length > 0 && (
                <Section title="Drafts" count={drafts.length}>
                  {drafts.map((m) => <OutboxRow key={m.id} msg={m} />)}
                </Section>
              )}
              {failed.length > 0 && (
                <Section title="Failed" count={failed.length}>
                  {failed.map((m) => <OutboxRow key={m.id} msg={m} />)}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
