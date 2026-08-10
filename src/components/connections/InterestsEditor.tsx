import { useState } from 'react';
import { useConnectionInterests } from '@/hooks/useConnectionInterests';

/**
 * Inline editor for the user's interest tags (e.g. "Investors"). Adding or
 * removing a tag changes what the AI matches against; existing categorizations
 * only pick up the change after a re-categorize, so we surface that action here.
 */
export function InterestsEditor({
  aiAvailable,
  connectionCount,
  onRecategorize,
}: {
  aiAvailable: boolean;
  /** Total connections a re-categorize would re-scan (for the cost warning). */
  connectionCount: number;
  onRecategorize: () => Promise<void> | void;
}) {
  const [interests, setInterests] = useConnectionInterests();
  const [draft, setDraft] = useState('');
  const [recategorizing, setRecategorizing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const add = async () => {
    const t = draft.trim();
    if (!t || interests.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setDraft('');
      return;
    }
    await setInterests([...interests, t]);
    setDraft('');
  };

  const remove = async (tag: string) => {
    await setInterests(interests.filter((t) => t !== tag));
  };

  const recategorize = async () => {
    setConfirming(false);
    setRecategorizing(true);
    try {
      await onRecategorize();
    } finally {
      setRecategorizing(false);
    }
  };

  return (
    <div className="border-b border-edge bg-surface-raised px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
          Interest tags
        </p>
        {recategorizing ? (
          <span className="px-2 py-1 text-[11px] font-medium text-blue-300">Re-categorizing…</span>
        ) : confirming ? (
          <span className="flex items-center gap-1 text-[11px]">
            <span className="text-fg-muted">Re-scan all {connectionCount}?</span>
            <button
              type="button"
              onClick={recategorize}
              className="rounded-md px-2 py-1 font-medium text-amber-300 ring-1 ring-inset ring-amber-500/30 transition-colors hover:bg-amber-500/10"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md px-2 py-1 font-medium text-fg-muted transition-colors hover:text-fg-secondary"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!aiAvailable}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-blue-300 transition-colors hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            title={aiAvailable ? `Re-run AI categorization on all ${connectionCount} connections (uses API calls)` : 'Add a Gemini API key to enable AI categorization'}
          >
            Re-categorize all
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {interests.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1 rounded-full bg-blue-500/15 py-0.5 pl-2 pr-1 text-[11px] font-medium text-blue-300"
          >
            ★ {t}
            <button
              type="button"
              onClick={() => remove(t)}
              aria-label={`Remove ${t}`}
              className="flex h-4 w-4 items-center justify-center rounded-full text-blue-300/70 hover:bg-blue-500/20 hover:text-blue-200"
            >
              ×
            </button>
          </span>
        ))}
        {interests.length === 0 && (
          <span className="text-[11px] text-fg-muted">No interest tags yet.</span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="Add an interest (e.g. Potential customers)"
          className="min-w-0 flex-1 rounded-lg bg-surface-input px-2.5 py-1.5 text-xs text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
        />
        <button
          type="button"
          onClick={() => void add()}
          className="shrink-0 rounded-lg bg-surface-input px-3 py-1.5 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          Add
        </button>
      </div>

      {!aiAvailable && (
        <p className="mt-2 text-[11px] text-amber-400/80">
          Add a Gemini API key in AI settings to categorize connections.
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-fg-faint">
        New connections are categorized automatically. Changed the tags? Re-categorize to apply.
      </p>
    </div>
  );
}
