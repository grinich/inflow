import { useEffect, useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import { setAgentBridgeToken, setAgentToolsEnabled } from '@/lib/agent-settings';

/** The Claude (Anthropic) starburst mark — nominative use, identifying what
 *  is asking to connect. Drawn inline so no asset ships in the bundle. */
function ClaudeMark({ className }: { className?: string }) {
  const rays: [number, number][] = [
    [0, 1], [32, 0.7], [58, 0.92], [91, 0.66], [118, 0.95], [149, 0.72],
    [180, 0.98], [212, 0.68], [239, 0.9], [270, 0.7], [299, 0.94], [329, 0.74],
  ];
  return (
    <svg viewBox="-50 -50 100 100" className={className} aria-hidden="true">
      {rays.map(([deg, len]) => (
        <line
          key={deg}
          x1={0}
          y1={-10}
          x2={0}
          y2={-44 * len}
          stroke="#D97757"
          strokeWidth={11}
          strokeLinecap="round"
          transform={`rotate(${deg})`}
        />
      ))}
    </svg>
  );
}

/**
 * The pairing confirmation for a ?pair= launch link (Claude Desktop's
 * "connect to inflow" flow): one decision, Confirm or Cancel. Confirming
 * saves the pairing code AND enables read access — the dialog says so, since
 * that's the consent being given — then opens Agent Access so the user can
 * also allow actions if they want. Write access is never granted here.
 */
export function PairClaudeModal() {
  const code = useUIStore((s) => s.pairRequestCode);
  const setPairRequest = useUIStore((s) => s.setPairRequest);
  const setAgentAccessOpen = useUIStore((s) => s.setAgentAccessOpen);
  const showToast = useUIStore((s) => s.showToast);

  const cancel = useCallback(() => setPairRequest(null), [setPairRequest]);

  // Escape to cancel
  useEffect(() => {
    if (!code) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [code, cancel]);

  if (!code) return null;

  const handleConfirm = async () => {
    await setAgentBridgeToken(code);
    await setAgentToolsEnabled(true); // exactly what the dialog copy promises
    showToast({ message: 'Paired with Claude Desktop — read access enabled' });
    setPairRequest(null);
    // Show where this lives and offer the "act" toggle without granting it.
    setAgentAccessOpen(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={cancel}>
      <div
        className="w-full max-w-sm rounded-xl bg-surface-raised p-6 text-center shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <ClaudeMark className="mx-auto h-12 w-12" />
        <h2 className="mt-3 text-base font-semibold text-fg-strong">Connect Claude Desktop</h2>
        <p className="mt-2 text-sm text-fg-secondary">
          Claude Desktop is asking to pair with inflow. Connecting lets it{' '}
          <span className="text-fg">read</span> your inbox; sending and archiving stay off
          unless you enable them separately.
        </p>
        <div className="mx-auto mt-4 w-fit rounded-md bg-surface px-4 py-2 font-mono text-sm text-fg ring-1 ring-ring">
          {code}
        </div>
        <p className="mt-2 text-xs text-fg-muted">
          Make sure this matches the code Claude showed you.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={cancel}
            className="rounded-md px-4 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
