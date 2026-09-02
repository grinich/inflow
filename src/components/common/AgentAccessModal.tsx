import { useState, useEffect, useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import {
  AGENT_BRIDGE_STATUS_KEY,
  getAgentBridgeToken,
  getAgentToolsEnabled,
  getAgentWritesEnabled,
  setAgentBridgeToken,
  setAgentToolsEnabled,
  setAgentWritesEnabled,
} from '@/lib/agent-settings';
import { AGENT_SEND_CAP_PER_HOUR } from '@/lib/agent-tools/send-cap';
import { readLocal } from '@/lib/storage';

const BRIDGE_STATUS_LABEL: Record<string, string> = {
  connected: 'Connected to Claude Desktop',
  disconnected: 'Paired — waiting for Claude Desktop (is Inflow.mcpb installed and Claude running?)',
  unpaired: 'Not paired yet',
  disabled: 'Enable read access in step 3 to connect',
};

/** What the user types into Claude Desktop to kick off pairing. */
const CLAUDE_PROMPT = 'Connect to my inflow LinkedIn inbox';

function StepHeader({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white ${
          done ? 'bg-green-600' : 'bg-blue-600'
        }`}
      >
        {done ? '✓' : n}
      </span>
      <p className="text-sm font-medium text-fg">{title}</p>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <p className="text-sm font-medium text-fg">{label}</p>
        <p className="mt-0.5 text-xs text-fg-secondary">{disabled && hint ? hint : description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-blue-600' : 'bg-surface ring-1 ring-ring'
        } ${disabled ? 'cursor-not-allowed' : ''}`}
      >
        {/* left-0 anchors the knob: an absolutely-positioned span with auto
            left sits at its static position — centered by the button's
            text-align — and the translate then pushes it out of the track. */}
        <span
          className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export function AgentAccessModal() {
  const open = useUIStore((s) => s.agentAccessOpen);
  const setOpen = useUIStore((s) => s.setAgentAccessOpen);
  const showToast = useUIStore((s) => s.showToast);

  const [reads, setReads] = useState(false);
  const [writes, setWrites] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [saved, setSaved] = useState({ reads: false, writes: false, pairCode: '' });
  const [bridgeState, setBridgeState] = useState<string | null>(null);

  // Load persisted values when opening. Everything edits local state only;
  // nothing persists until Save — closing any other way discards.
  useEffect(() => {
    if (open) {
      Promise.all([getAgentToolsEnabled(), getAgentWritesEnabled(), getAgentBridgeToken()]).then(
        ([r, w, t]) => {
          setReads(r);
          setWrites(w);
          setSaved({ reads: r, writes: w, pairCode: t ?? '' });
          setPairCode(t ?? '');
        }
      );
    }
  }, [open]);

  // Live bridge status from the background (it writes on every transition).
  useEffect(() => {
    if (!open) return;
    const load = () =>
      readLocal<{ state?: string }>(AGENT_BRIDGE_STATUS_KEY).then((s) =>
        setBridgeState(s?.state ?? null)
      );
    void load();
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && AGENT_BRIDGE_STATUS_KEY in changes) void load();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [open]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, close]);

  const toggleReads = (next: boolean) => {
    setReads(next);
    // Reads off means writes off too — flip the value, don't just hide the row.
    if (!next) setWrites(false);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(CLAUDE_PROMPT);
      showToast({ message: 'Copied — paste it into Claude Desktop' });
    } catch {
      showToast({ message: 'Copy failed — select and copy the text manually' });
    }
  };

  const dirty =
    reads !== saved.reads || writes !== saved.writes || pairCode.trim() !== saved.pairCode;

  const handleSave = async () => {
    await setAgentToolsEnabled(reads);
    await setAgentWritesEnabled(writes);
    await setAgentBridgeToken(pairCode);
    showToast({
      message: !reads
        ? 'Agent access disabled'
        : writes
          ? 'Agent access enabled (read + act)'
          : 'Agent read access enabled',
    });
    close();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={close}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-surface-raised p-6 shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-fg-strong">Agent access</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Let an AI agent work with your LinkedIn inbox through inflow&apos;s tools instead of
          screen-scraping LinkedIn.
        </p>

        {/* Step 1 — permissions. Every agent needs this, whichever one you use. */}
        <section className="mt-5">
          <StepHeader n={1} title="Choose what agents may do" done={saved.reads} />
          <div className="ml-[30px] mt-3 space-y-4">
            <ToggleRow
              label="Let agents read my inbox"
              description="List conversations, read threads, search, see pending invitations."
              checked={reads}
              onChange={toggleReads}
            />
            <ToggleRow
              label="Let agents act"
              description="Send messages, archive, mark read/unread — on your real LinkedIn account."
              checked={writes}
              disabled={!reads}
              hint="Enable read access first."
              onChange={setWrites}
            />
          </div>
        </section>

        {/* Step 2 — pick an agent. The two paths are alternatives, not a sequence. */}
        <section className="mt-5">
          <StepHeader n={2} title="Connect an agent" />
          <p className="ml-[30px] mt-1 text-xs text-fg-secondary">
            Either one — you don&apos;t need both.
          </p>
        </section>

        {/* ChatGPT / Codex: nothing to install, so it goes first. */}
        <section className="ml-[30px] mt-3 rounded-lg bg-surface p-3 ring-1 ring-ring">
          <p className="text-sm font-medium text-fg">ChatGPT or Codex</p>
          <p className="mt-1 text-xs text-fg-secondary">
            Nothing to install. Open{' '}
            <a
              href="https://inflow.im/app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 underline hover:text-blue-400"
            >
              inflow.im/app
            </a>{' '}
            with ChatGPT&apos;s browser or the Codex side panel, give it access to the site, and
            ask it about your inbox — it finds inflow&apos;s tools on its own.
          </p>
        </section>

        {/* Claude Desktop: needs the bundle and a pairing code. */}
        <section className="ml-[30px] mt-3 rounded-lg bg-surface p-3 ring-1 ring-ring">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-fg">Claude Desktop</p>
            <a
              href="https://github.com/grinich/inflow/releases/latest/download/Inflow.mcpb"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-md bg-surface-raised px-3 py-1.5 text-sm font-medium text-fg ring-1 ring-ring transition-colors hover:bg-surface-hover"
            >
              Download
            </a>
          </div>
          <div>
            <p className="mt-1 text-xs text-fg-secondary">
              Download Inflow.mcpb, double-click to install, then paste this into Claude:
            </p>
            <p className="mt-1 text-xs text-fg-secondary">Paste this into Claude Desktop:</p>
            <button
              type="button"
              onClick={copyPrompt}
              title="Click to copy"
              className="mt-1.5 w-full rounded-md bg-surface-raised px-3 py-2 text-left font-mono text-xs text-fg ring-1 ring-ring transition-colors hover:bg-surface-hover"
            >
              {CLAUDE_PROMPT}
              <span className="float-right text-fg-muted">copy</span>
            </button>
            <p className="mt-1.5 text-xs text-fg-secondary">
              Claude replies with a pairing link — click it and press Connect. Or enter the code
              by hand:
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="text"
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value.toUpperCase())}
                placeholder="INF-XXXXXX"
                aria-label="Claude Desktop pairing code"
                spellCheck={false}
                className="w-40 rounded-md bg-surface-raised px-3 py-1.5 font-mono text-sm text-fg placeholder-fg-faint ring-1 ring-ring focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {pairCode && (
                <button
                  type="button"
                  onClick={() => setPairCode('')}
                  className="rounded-md px-2 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
                >
                  Unpair
                </button>
              )}
            </div>
            {saved.pairCode && !pairCode && (
              <p className="mt-1.5 text-xs text-amber-500">
                Claude Desktop will be disconnected when you Save. To rotate the code itself,
                also delete ~/.inflow/agent-bridge.json and restart Claude Desktop.
              </p>
            )}
            <p className="mt-1.5 text-xs text-fg-muted" data-testid="bridge-status">
              {BRIDGE_STATUS_LABEL[bridgeState ?? ''] ?? 'Status unknown'}
            </p>
          </div>
        </section>

        <section className="mt-5">
          <div className="space-y-4">
            <p className="text-xs text-fg-muted">
              Agent-sent messages are capped at {AGENT_SEND_CAP_PER_HOUR}/hour. Every agent action
              shows a notification here.{' '}
              <a
                href="https://github.com/grinich/inflow/blob/main/docs/agent-tools.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 underline hover:text-blue-400"
              >
                Learn more
              </a>
            </p>
          </div>
        </section>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={close}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
