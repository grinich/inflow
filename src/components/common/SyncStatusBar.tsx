import { useState, useCallback } from 'react';
import { useBackgroundMessage } from '@/hooks/useBackgroundMessage';
import { sendBridgeMessage } from '@/lib/bridge';

export function SyncStatusBar() {
  const [syncing, setSyncing] = useState(false);

  useBackgroundMessage(
    useCallback((msg: any) => {
      if (msg.type === 'SYNC_COMPLETE') {
        setSyncing(false);
      }
    }, [])
  );

  async function handleManualSync() {
    setSyncing(true);
    try {
      await sendBridgeMessage({ type: 'SYNC_CONVERSATIONS' });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button
      onClick={handleManualSync}
      disabled={syncing}
      className="rounded p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary disabled:pointer-events-none"
      title="Sync now"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={syncing ? 'animate-spin' : ''}
      >
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 16h5v5" />
      </svg>
    </button>
  );
}
