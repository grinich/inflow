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
  unpaired: 'Not paired — ask Claude Desktop for your inflow pairing code',
  disabled: 'Enable agent access above to connect',
};

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
    <div className={`mt-4 flex items-start justify-between gap-4 ${disabled ? 'opacity-50' : ''}`}>
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
        className="w-full max-w-md rounded-xl bg-surface-raised p-6 shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-fg-strong">Agent access</h2>
        <p className="mt-2 text-sm text-fg-secondary">
          Let AI agents (like Claude) work with your inbox through inflow&apos;s tools instead of
          screen-scraping. Everything is off by default; agents only reach inflow through pages you
          point them at (inflow.im/app) or a WebMCP-capable browser.
        </p>

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

        <div className="mt-5 border-t border-ring pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-fg">Claude Desktop</p>
              <p className="mt-0.5 text-xs text-fg-secondary">
                Install Inflow.mcpb (double-click it), ask Claude for your inflow pairing code,
                and enter it here.
              </p>
            </div>
            <a
              href="https://github.com/grinich/inflow/releases/latest/download/Inflow.mcpb"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 rounded-md bg-surface px-3 py-1.5 text-sm font-medium text-fg ring-1 ring-ring transition-colors hover:bg-surface-hover"
            >
              Download Inflow.mcpb
            </a>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="text"
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value.toUpperCase())}
              placeholder="INF-XXXXXX"
              aria-label="Claude Desktop pairing code"
              spellCheck={false}
              className="w-40 rounded-md bg-surface px-3 py-1.5 font-mono text-sm text-fg placeholder-fg-faint ring-1 ring-ring focus:outline-none focus:ring-2 focus:ring-blue-500"
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

        <p className="mt-4 text-xs text-fg-muted">
          Agent-sent messages are capped at {AGENT_SEND_CAP_PER_HOUR}/hour. Every agent action
          shows a notification here.{' '}
          <a
            href="https://github.com/grinich/inflow/blob/main/docs/agent-tools.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 underline hover:text-blue-400"
          >
            How to connect Claude
          </a>
        </p>

        <div className="mt-4 flex justify-end gap-2">
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
