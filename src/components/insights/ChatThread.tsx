import { useEffect, useRef, useState } from 'react';
import { useConnectionChat } from '@/hooks/useConnectionChat';
import { useUIStore } from '@/store/ui-store';
import { SUGGESTED_QUESTIONS } from '@/lib/connection-chat';
import { Markdown } from '@/components/common/Markdown';
import { SparkleIcon } from '@/components/common/SparkleIcon';

/** An assistant answer, rendered as plain text (no bubble) with a copy action. */
function AssistantMessage({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="group">
      <Markdown text={content} className="text-[15px] leading-relaxed text-fg" />
      <button
        onClick={copy}
        title="Copy"
        aria-label="Copy answer"
        className="mt-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-fg-faint opacity-0 transition-opacity hover:text-fg-secondary group-hover:opacity-100 focus:opacity-100"
      >
        {copied ? (
          <>
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            Copied
          </>
        ) : (
          <>
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            Copy
          </>
        )}
      </button>
    </div>
  );
}

/**
 * The chat transcript + composer for Flow (the network AI). Answers render as
 * plain text like ChatGPT/Claude — no card around them — each copyable; the user's
 * own turns sit in a subtle right-aligned bubble. Reads the shared chat store via
 * useConnectionChat so it stays in sync with the history sidebar.
 */
export function ChatThread() {
  const { messages, loading, available, ask, connectionCount } = useConnectionChat();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const openSettings = useUIStore((s) => s.openSettings);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  const submit = (q: string) => {
    if (!q.trim() || loading) return;
    ask(q);
    setDraft('');
  };

  if (!available) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="max-w-sm text-sm text-fg-muted">
          Add an AI key to chat with Flow about your network.
        </p>
        <button
          onClick={() => openSettings('ai')}
          className="rounded-lg btn-primary px-4 py-2 text-sm font-medium"
        >
          Set up AI
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-fg-secondary">
                Ask Flow anything about your {connectionCount} connection{connectionCount === 1 ? '' : 's'}.
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => submit(q)}
                    className="rounded-lg bg-surface-raised px-3 py-2 text-left text-sm text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-surface-input px-3.5 py-2 text-[15px] text-fg-strong">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <AssistantMessage key={i} content={m.content} />
                ),
              )}
              {loading && (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" />
                  Thinking…
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-edge p-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder="Ask Flow…"
            className="min-w-0 flex-1 rounded-lg bg-surface-input px-3 py-2 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
          />
          <button
            onClick={() => submit(draft)}
            disabled={!draft.trim() || loading}
            className="flex shrink-0 items-center gap-1.5 rounded-lg btn-primary px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-40"
          >
            <SparkleIcon className="h-3.5 w-3.5" />
            Ask
          </button>
        </div>
        <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-fg-faint">
          Grounded in your connections and their AI summaries. Flow can be wrong — verify before acting.
        </p>
      </div>
    </div>
  );
}
