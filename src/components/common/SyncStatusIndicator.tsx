import { useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useBackgroundMessage } from '@/hooks/useBackgroundMessage';
import { sendBridgeMessage } from '@/lib/bridge';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
function getOnline() { return navigator.onLine; }

interface SyncState {
  state: 'idle' | 'syncing' | 'error';
  message?: string;
}

interface SyncProgress {
  categories: Record<string, { phase: string; totalDiscovered: number }>;
  queue: { pending: number; syncing: number; done: number; failed: number; total: number };
}

interface SyncStatusIndicatorProps {
  accountName?: string;
  onOpenDebug?: () => void;
}

export function SyncStatusIndicator({ accountName, onOpenDebug }: SyncStatusIndicatorProps) {
  const online = useSyncExternalStore(subscribeOnline, getOnline);
  const [sync, setSync] = useState<SyncState>({ state: 'idle' });
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [sseConnected, setSseConnected] = useState(true);

  // Count queued actions for offline indicator
  const queuedCount = useLiveQuery(
    () => db.pendingActions.where('status').equals('queued').count(),
    [],
    0
  );

  useBackgroundMessage(
    useCallback((msg: any) => {
      if (msg.type === 'SYNC_STATUS') {
        setSync({ state: msg.state, message: msg.message });
        if (msg.state === 'idle') {
          setLastSynced(Date.now());
        }
      }
      if (msg.type === 'SYNC_PROGRESS') {
        setProgress(msg.progress);
      }
      if (msg.type === 'SYNC_COMPLETE') {
        setLastSynced(Date.now());
      }
      if (msg.type === 'SSE_STATUS') {
        setSseConnected(msg.connected);
      }
    }, [])
  );

  // Fetch initial sync progress and SSE status on mount
  useEffect(() => {
    sendBridgeMessage({ type: 'GET_SYNC_PROGRESS' }).then((res) => {
      if (res.success && res.data) {
        setProgress(res.data);
      }
    }).catch(() => {});
    sendBridgeMessage({ type: 'GET_SSE_STATUS' }).then((res) => {
      if (res.success && res.data) {
        setSseConnected(res.data.connected);
      }
    }).catch(() => {});
  }, []);

  const isSyncing = sync.state === 'syncing';

  // Check if discovery or backfill is in progress
  const isDiscovering = progress && Object.values(progress.categories).some(
    (c) => c.phase === 'discovering'
  );
  const isBackfilling = progress && progress.queue.pending > 0;

  const active = isSyncing || isDiscovering || isBackfilling;

  // Build status text
  let statusText = '';
  if (!online) {
    statusText = queuedCount > 0 ? `Offline (${queuedCount} queued)` : 'Offline';
  } else if (!sseConnected) {
    statusText = 'Reconnecting...';
  } else if (active) {
    statusText = 'Syncing';
  } else if (lastSynced) {
    const ago = Math.round((Date.now() - lastSynced) / 1000);
    if (ago < 5) statusText = 'Synced just now';
    else if (ago < 60) statusText = `Synced ${ago}s ago`;
    else statusText = `Synced ${Math.round(ago / 60)}m ago`;
  }

  const icon = (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={active ? 'animate-reverse-spin' : ''}
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );

  const tooltip = accountName ? `Signed in as ${accountName}` : undefined;

  return (
    <button
      onClick={onOpenDebug}
      title={tooltip}
      className={`flex cursor-pointer items-center gap-1.5 text-xs outline-none ${
        !online ? 'text-fg-faint hover:text-fg-muted'
        : !sseConnected ? 'text-yellow-500'
        : sync.state === 'error' ? 'text-red-400'
        : 'text-fg-faint hover:text-fg-muted'
      }`}
    >
      {icon}
      <span>{statusText || 'Up to date'}</span>
    </button>
  );
}
