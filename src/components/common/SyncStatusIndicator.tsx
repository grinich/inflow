import { useState, useCallback, useEffect, useRef } from 'react';
import { useBackgroundMessage } from '@/hooks/useBackgroundMessage';
import { sendBridgeMessage } from '@/lib/bridge';

interface SyncState {
  state: 'idle' | 'syncing' | 'error';
  message?: string;
}

interface SyncProgress {
  categories: Record<string, { phase: string; totalDiscovered: number }>;
  queue: { pending: number; syncing: number; done: number; failed: number; total: number };
}

export function SyncStatusIndicator() {
  const [sync, setSync] = useState<SyncState>({ state: 'idle' });
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);

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
    }, [])
  );

  // Fetch initial sync progress on mount
  useEffect(() => {
    sendBridgeMessage({ type: 'GET_SYNC_PROGRESS' }).then((res) => {
      if (res.success && res.data) {
        setProgress(res.data);
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
  if (isBackfilling && progress) {
    const { done, total } = progress.queue;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    statusText = `syncing ${pct}%`;
  } else if (isDiscovering && progress) {
    const totalDiscovered = Object.values(progress.categories).reduce(
      (sum, c) => sum + c.totalDiscovered,
      0
    );
    statusText = `discovering... (${totalDiscovered})`;
  } else if (isSyncing && sync.message) {
    statusText = sync.message;
  } else if (lastSynced) {
    const ago = Math.round((Date.now() - lastSynced) / 1000);
    if (ago < 5) statusText = 'synced just now';
    else if (ago < 60) statusText = `synced ${ago}s ago`;
    else statusText = `synced ${Math.round(ago / 60)}m ago`;
  }

  function handleClick() {
    if (active || paused) {
      sendBridgeMessage({ type: 'TOGGLE_SYNC_PAUSE' }).then((res) => {
        if (res.success) setPaused(res.data.paused);
      }).catch(() => {});
      return;
    }
    sendBridgeMessage({ type: 'SYNC_CONVERSATIONS' }).catch(() => {});
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

  const pauseIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );

  const staticIcon = (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );

  // Paused state
  if (paused) {
    return (
      <button
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="flex cursor-pointer items-center gap-1.5 text-xs text-yellow-500 hover:text-yellow-400"
      >
        {hovered ? staticIcon : pauseIcon}
        <span className="inline-grid text-left">
          <span className={`col-start-1 row-start-1 ${hovered ? 'invisible' : ''}`}>sync paused</span>
          <span className={`col-start-1 row-start-1 ${hovered ? '' : 'invisible'}`}>resume syncing</span>
        </span>
      </button>
    );
  }

  // When actively syncing, show status text; on hover swap to "Pause syncing"
  if (active) {
    return (
      <button
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`flex cursor-pointer items-center gap-1.5 text-xs ${
          sync.state === 'error' ? 'text-red-400' : 'text-fg-faint hover:text-fg-muted'
        }`}
      >
        {hovered ? pauseIcon : icon}
        <span className="inline-grid text-left">
          <span className={`col-start-1 row-start-1 ${hovered ? 'invisible' : ''}`}>{statusText}</span>
          <span className={`col-start-1 row-start-1 ${hovered ? '' : 'invisible'}`}>pause syncing</span>
        </span>
      </button>
    );
  }

  // When idle, show icon + "Sync idle"
  return (
    <button
      onClick={handleClick}
      className="flex cursor-pointer items-center gap-1.5 text-xs text-fg-faint hover:text-fg-muted"
    >
      {icon}
      <span>up to date</span>
    </button>
  );
}
