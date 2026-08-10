import { useState } from 'react';
import { GroupAvatar } from '../common/GroupAvatar';
import { useFollowUps } from '@/hooks/useFollowUps';
import { useConnectionSuggestions } from '@/hooks/useConnectionSuggestions';
import { useAISession } from '@/hooks/useAISession';
import { useUIStore } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import { draftFollowUpMessage } from '@/lib/connection-message';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { roleBadgeClass, connectionProfileUrl } from '@/components/connections/connection-format';
import type { FollowUp } from '@/lib/connection-followups';

function Section({ title, hint, children }: { title?: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      {title && <h3 className="text-sm font-semibold text-fg-strong">{title}</h3>}
      {hint && <p className={`text-xs text-fg-muted ${title ? 'mt-0.5' : ''}`}>{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function followUpReason(f: FollowUp): string {
  return f.reason === 'never'
    ? `Connected ${f.days}d ago · never messaged`
    : `Last talked ${f.days}d ago`;
}

function FollowUpRow({ f }: { f: FollowUp }) {
  const c = f.connection;
  const name = c.fullName || 'Unknown';
  const { available: aiAvailable, predict } = useAISession();
  const showToast = useUIStore((s) => s.showToast);

  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);

  const openConnection = () => {
    useUIStore.getState().setSelectedConnectionUrn(c.profileUrn);
    useUIStore.getState().setActiveSection('connections');
  };

  const draft = async () => {
    setDrafting(true);
    try {
      const msg = await draftFollowUpMessage(name, c.headline, predict);
      if (msg) setText(msg);
    } finally {
      setDrafting(false);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await sendBridgeMessage({
        type: 'CREATE_CONVERSATION',
        recipientUrns: [c.profileUrn],
        body,
      });
      if (res.success) {
        showToast({ message: `Message sent to ${name}` });
        setText('');
        setComposing(false);
      } else {
        showToast({ message: res.error || 'Could not send message' });
      }
    } catch (e: any) {
      showToast({ message: e?.message || 'Could not send message' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg hover:bg-surface-hover">
      <div className="flex items-center gap-3 px-2 py-2">
        <GroupAvatar names={[name]} pictures={[c.pictureUrl]} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-fg-strong">{name}</span>
            {c.roleCategory && c.roleCategory !== 'Other' && (
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${roleBadgeClass(c.roleCategory)}`}>
                {c.roleCategory}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-fg-muted">{followUpReason(f)}</div>
        </div>
        <button
          onClick={() => setComposing((v) => !v)}
          className="shrink-0 rounded-md btn-primary px-2.5 py-1 text-xs font-medium transition-colors"
        >
          Message
        </button>
        <button
          onClick={openConnection}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          Connection
        </button>
        <button
          onClick={() => window.open(connectionProfileUrl(c.publicId, name), '_blank', 'noopener,noreferrer')}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-500/10"
        >
          LinkedIn
        </button>
      </div>

      {composing && (
        <div className="px-2 pb-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={`Write a message to ${name}…`}
            className="w-full resize-y rounded-lg bg-surface-input p-2.5 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
          />
          <div className="mt-2 flex items-center gap-2">
            {aiAvailable && (
              <button
                onClick={draft}
                disabled={drafting}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-blue-300 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/10 disabled:opacity-50"
              >
                <SparkleIcon className="h-3 w-3" />
                {drafting ? 'Drafting…' : 'Draft with AI'}
              </button>
            )}
            <span className="flex-1" />
            <button
              onClick={() => setComposing(false)}
              className="rounded-md px-2 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg-secondary"
            >
              Cancel
            </button>
            <button
              onClick={send}
              disabled={!text.trim() || sending}
              className="rounded-md btn-primary px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Follow-ups — connections worth reconnecting with (local, no AI). */
export function FollowUpsSection() {
  const { followUps } = useFollowUps();
  return (
    <Section hint="People worth reconnecting with, based on when you last talked.">
      {followUps.length === 0 ? (
        <p className="text-sm text-fg-muted">You&rsquo;re all caught up — no stale connections.</p>
      ) : (
        <div className="space-y-0.5">
          {followUps.map((f) => (
            <FollowUpRow key={f.connection.profileUrn} f={f} />
          ))}
        </div>
      )}
    </Section>
  );
}

/** AI suggestions — proposed tags + re-categorizations (its own Insights card). */
export function AISuggestionsSection() {
  const {
    available,
    loading,
    hasRun,
    error,
    suggestedTags,
    recatCandidates,
    refresh,
    addTag,
    applyRecat,
    dismissRecat,
  } = useConnectionSuggestions();
  const openSettings = useUIStore((s) => s.openSettings);

  return (
    <div>
        <Section hint="Proposed interest tags and possible re-categorizations from your network.">

          {!available ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-fg-muted">Add an AI key to get AI suggestions.</p>
              <button
                onClick={() => openSettings('ai')}
                className="rounded-lg btn-primary px-3 py-1.5 text-sm font-medium"
              >
                Set up AI
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <button
                onClick={refresh}
                disabled={loading}
                className="rounded-lg btn-primary px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
              >
                {loading ? 'Analyzing…' : hasRun ? 'Refresh suggestions' : 'Get suggestions'}
              </button>

              {error && <p className="text-sm text-red-400">{error}</p>}

              {hasRun && !loading && (
                <>
                  {/* Suggested tags */}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                      Suggested interest tags
                    </p>
                    {suggestedTags.length === 0 ? (
                      <p className="mt-1.5 text-sm text-fg-muted">No new tag ideas right now.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {suggestedTags.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => addTag(tag)}
                            className="flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-1 text-[12px] font-medium text-blue-300 ring-1 ring-inset ring-blue-500/20 transition-colors hover:bg-blue-500/20"
                          >
                            + {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Re-categorize candidates */}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                      Possible re-categorizations
                    </p>
                    {recatCandidates.length === 0 ? (
                      <p className="mt-1.5 text-sm text-fg-muted">Nothing looks mis-tagged.</p>
                    ) : (
                      <div className="mt-2 space-y-1.5">
                        {recatCandidates.map((c) => (
                          <div key={c.profileUrn} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-hover">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-fg-strong">{c.fullName}</div>
                              <div className="truncate text-xs text-fg-muted">
                                {c.from || 'Uncategorized'} → <span className="text-fg-secondary">{c.to}</span>
                                {c.headline ? ` · ${c.headline}` : ''}
                              </div>
                            </div>
                            <button
                              onClick={() => applyRecat(c)}
                              className="shrink-0 rounded-md bg-blue-500/15 px-2 py-1 text-xs font-medium text-blue-300 ring-1 ring-inset ring-blue-500/30 hover:bg-blue-500/25"
                            >
                              Apply
                            </button>
                            <button
                              onClick={() => dismissRecat(c.profileUrn)}
                              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg-secondary"
                            >
                              Dismiss
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </Section>
    </div>
  );
}
