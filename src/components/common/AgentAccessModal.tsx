import { useState, useEffect, useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import {
  getAgentToolsEnabled,
  getAgentWritesEnabled,
  setAgentToolsEnabled,
  setAgentWritesEnabled,
} from '@/lib/agent-settings';
import { AGENT_SEND_CAP_PER_HOUR } from '@/lib/agent-tools/send-cap';

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
  const [saved, setSaved] = useState({ reads: false, writes: false });

  // Load persisted values when opening. Toggles edit local state only;
  // nothing persists until Save — closing any other way discards.
  useEffect(() => {
    if (open) {
      Promise.all([getAgentToolsEnabled(), getAgentWritesEnabled()]).then(([r, w]) => {
        setReads(r);
        setWrites(w);
        setSaved({ reads: r, writes: w });
      });
    }
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

  const dirty = reads !== saved.reads || writes !== saved.writes;

  const handleSave = async () => {
    await setAgentToolsEnabled(reads);
    await setAgentWritesEnabled(writes);
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
