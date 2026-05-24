import { useState, useEffect, useRef, useCallback } from 'react';
import { useBackgroundMessage } from '@/hooks/useBackgroundMessage';
import { BACKFILL_OPTIONS, getBackfillWindow, setBackfillWindow, type BackfillWindow } from '@/lib/sync-settings';
import { db } from '@/db/database';
import type { LogEntry } from '@/lib/debug-log';

interface SyncProgress {
  categories: Record<string, { phase: string; totalDiscovered: number }>;
  queue: { pending: number; syncing: number; done: number; failed: number; total: number };
}

export function DebugPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<'all' | 'errors'>('all');
  const [resetting, setResetting] = useState(false);
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagReport, setDiagReport] = useState<string | null>(null);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [backfillWindow, setBackfillWindowState] = useState<BackfillWindow>('180d');
  const [dbSizeMB, setDbSizeMB] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const wasOpen = useRef(false);

  // Listen for sync progress updates from background
  useBackgroundMessage(
    useCallback((msg: any) => {
      if (msg.type === 'SYNC_PROGRESS') {
        setSyncProgress(msg.progress);
      }
    }, [])
  );

  // Fetch sync progress and settings on open
  useEffect(() => {
    if (!open) return;
    chrome.runtime.sendMessage({ type: 'GET_SYNC_PROGRESS' }).then((res) => {
      if (res?.success) {
        setSyncProgress(res.data);
      }
    }).catch(() => {});
    getBackfillWindow().then(setBackfillWindowState).catch(() => {});
    // Estimate IndexedDB size
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((est) => {
        if (est.usage != null) {
          setDbSizeMB((est.usage / (1024 * 1024)).toFixed(1));
        }
      }).catch(() => {});
    }
    db.messages.count().then(setMessageCount).catch(() => {});
  }, [open]);

  const fetchLogs = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_DEBUG_LOGS' });
      if (res?.success) {
        setLogs(res.data || []);
      }
    } catch {
      // extension context might not be ready
    }
  };

  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    fetchLogs();
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 1000);
    return () => clearInterval(interval);
  }, [open, autoRefresh]);

  const [followScroll, setFollowScroll] = useState(false);

  // When follow is on, pin to bottom whenever logs change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !open || diagReport || !followScroll) return;
    el.scrollTop = el.scrollHeight;
  }, [logs, open, diagReport, followScroll]);

  // If user scrolls away from bottom while following, disable follow
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (!followScroll) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (!atBottom) setFollowScroll(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [followScroll]);

  if (!open) return null;

  const filteredLogs = filter === 'errors' ? logs.filter(l => l.level === 'error') : logs;

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
      '.' + String(d.getMilliseconds()).padStart(3, '0');
  };

  const levelColor = (level: string) => {
    if (level === 'error') return 'text-red-400';
    if (level === 'warn') return 'text-yellow-400';
    return 'text-zinc-400';
  };

  const colorizeMessage = (msg: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let remaining = msg;
    let key = 0;

    // Extract bracketed tags like [BACKFILL], [PREFETCH], [COORDINATOR]
    const tagRe = /\[([A-Z_-]+)\]/g;
    let lastIndex = 0;
    let match;
    while ((match = tagRe.exec(remaining)) !== null) {
      if (match.index > lastIndex) {
        parts.push(remaining.slice(lastIndex, match.index));
      }
      parts.push(<span key={key++} className="text-blue-400">{match[0]}</span>);
      lastIndex = tagRe.lastIndex;
    }
    if (lastIndex < remaining.length) {
      parts.push(remaining.slice(lastIndex));
    }
    if (parts.length === 0) return msg;

    // Highlight numbers in the remaining text parts
    return parts.map((part, i) => {
      if (typeof part !== 'string') return part;
      const numParts: React.ReactNode[] = [];
      let numLast = 0;
      const numRe = /\b(\d[\d,.]*)\b/g;
      let m;
      while ((m = numRe.exec(part)) !== null) {
        if (m.index > numLast) numParts.push(part.slice(numLast, m.index));
        numParts.push(<span key={key++} className="text-cyan-400">{m[0]}</span>);
        numLast = numRe.lastIndex;
      }
      if (numLast < part.length) numParts.push(part.slice(numLast));
      return numParts.length > 0 ? <span key={`s${i}`}>{numParts}</span> : part;
    });
  };

  const getLogsAsText = () => {
    return logs.map(l => `[${formatTime(l.ts)}] ${l.level.toUpperCase()} ${l.message}`).join('\n');
  };

  const getErrorsAsText = () => {
    const errors = logs.filter(l => l.level === 'error');
    if (errors.length === 0) return 'No errors found.';
    return errors.map(l => `[${formatTime(l.ts)}] ${l.message}`).join('\n');
  };

  const handleCopyErrors = async () => {
    await navigator.clipboard.writeText(getErrorsAsText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(getLogsAsText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_DEBUG_LOGS' });
      setLogs([]);
    } catch {}
  };

  const handleResetDB = async () => {
    setResetting(true);
    try {
      await chrome.runtime.sendMessage({ type: 'RESET_DB' });
      setLogs([]);
    } catch {}
    setResetting(false);
  };

  const handleDiagnostic = async () => {
    setDiagRunning(true);
    setDiagReport(null);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DIAGNOSTIC_SYNC' });
      if (res?.success) {
        setDiagReport(res.data);
      } else {
        setDiagReport(`Diagnostic failed: ${res?.error || 'unknown error'}`);
      }
    } catch (err) {
      setDiagReport(`Diagnostic failed: ${err}`);
    }
    setDiagRunning(false);
  };

  const handleCopyDiagnostic = async () => {
    if (diagReport) {
      await navigator.clipboard.writeText(diagReport);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleResetSync = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'RESET_SYNC_STATE' });
      setSyncProgress(null);
    } catch {}
  };

  const errorCount = logs.filter(l => l.level === 'error').length;

  // Compute sync status for display
  const isDiscovering = syncProgress && Object.values(syncProgress.categories).some(c => c.phase === 'discovering');
  const isBackfilling = syncProgress && syncProgress.queue.pending > 0;
  const isSyncActive = isDiscovering || isBackfilling;

  return (
    <div data-debug-panel className="fixed inset-0 z-50 flex flex-col bg-zinc-950/95 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-zinc-200">Debug Console</h2>
          {/* Filter tabs */}
          <div className="flex rounded bg-zinc-800/60">
            <button
              onClick={() => { setFilter('all'); setDiagReport(null); }}
              className={`px-2.5 py-1 text-xs rounded-l transition-colors ${
                filter === 'all' && !diagReport
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              All ({logs.length})
            </button>
            <button
              onClick={() => { setFilter('errors'); setDiagReport(null); }}
              className={`px-2.5 py-1 text-xs rounded-r transition-colors ${
                filter === 'errors' && !diagReport
                  ? 'bg-red-900/60 text-red-300'
                  : errorCount > 0 ? 'text-red-400 hover:text-red-300' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Errors ({errorCount})
            </button>
          </div>
          {(dbSizeMB || messageCount != null) && (
            <span className="text-xs text-zinc-500">{dbSizeMB && `DB: ${dbSizeMB} MB`}{dbSizeMB && messageCount != null && ' · '}{messageCount != null && `${messageCount.toLocaleString()} msgs`}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDiagnostic}
            disabled={diagRunning}
            className="rounded bg-blue-900/50 px-2 py-1 text-xs text-blue-300 hover:bg-blue-900/70 disabled:opacity-50"
          >
            {diagRunning ? 'Running...' : 'Diagnostic Sync'}
          </button>
          <button
            onClick={handleResetSync}
            className="rounded bg-purple-900/50 px-2 py-1 text-xs text-purple-300 hover:bg-purple-900/70"
          >
            Reset Sync
          </button>
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchLogs}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Refresh
          </button>
          <button
            onClick={handleCopyErrors}
            className="rounded bg-red-900/50 px-2 py-1 text-xs text-red-300 hover:bg-red-900/70"
          >
            {copied ? 'Copied!' : 'Copy Errors'}
          </button>
          <button
            onClick={handleCopyAll}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Copy All
          </button>
          <button
            onClick={handleResetDB}
            disabled={resetting}
            className="rounded bg-orange-900/50 px-2 py-1 text-xs text-orange-300 hover:bg-orange-900/70 disabled:opacity-50"
          >
            {resetting ? 'Resetting...' : 'Reset DB & Resync'}
          </button>
          <button
            onClick={handleClear}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Clear
          </button>
          <button
            onClick={onClose}
            className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          >
            Close (`)
          </button>
        </div>
      </div>

      {/* Sync status bar */}
      {syncProgress && (
        <div className="border-b border-zinc-800 px-4 py-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-4">
              {Object.entries(syncProgress.categories).map(([cat, state]) => (
                <span key={cat} className="text-zinc-400">
                  <span className="text-zinc-500">{cat.replace('_', ' ')}: </span>
                  <span className={
                    state.phase === 'discovering' ? 'text-blue-400' :
                    state.phase === 'backfilling' ? 'text-yellow-400' :
                    state.phase === 'complete' ? 'text-green-400' :
                    'text-zinc-500'
                  }>
                    {state.phase}
                  </span>
                  <span className="text-zinc-600"> ({state.totalDiscovered})</span>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-3 text-zinc-400">
              <span>Queue: </span>
              <span className="text-yellow-400">{syncProgress.queue.pending} pending</span>
              <span className="text-green-400">{syncProgress.queue.done} done</span>
              {syncProgress.queue.failed > 0 && (
                <span className="text-red-400">{syncProgress.queue.failed} failed</span>
              )}
              <span className="text-zinc-500">/ {syncProgress.queue.total} total</span>
              <span className="text-zinc-600">|</span>
              <label className="flex items-center gap-1.5 text-zinc-500">
                Backfill:
                <select
                  value={backfillWindow}
                  onChange={(e) => {
                    const v = e.target.value as BackfillWindow;
                    setBackfillWindowState(v);
                    setBackfillWindow(v).then(() => {
                      chrome.runtime.sendMessage({ type: 'REEVAL_BACKFILL_WINDOW' }).catch(() => {});
                    });
                  }}
                  className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-300 outline-none ring-1 ring-zinc-700 focus:ring-zinc-500"
                >
                  {BACKFILL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {isSyncActive && syncProgress.queue.total > 0 && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${(syncProgress.queue.done / syncProgress.queue.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} className="h-full overflow-y-auto p-4 font-mono text-xs leading-5">
        {diagReport ? (
          // Diagnostic report view
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-sm font-semibold text-blue-300">Diagnostic Report</span>
              <button
                onClick={handleCopyDiagnostic}
                className="rounded bg-blue-900/50 px-2 py-1 text-xs text-blue-300 hover:bg-blue-900/70"
              >
                {copied ? 'Copied!' : 'Copy Report'}
              </button>
              <button
                onClick={() => setDiagReport(null)}
                className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
              >
                Back to Logs
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-all text-zinc-300">{diagReport}</pre>
          </div>
        ) : filteredLogs.length === 0 ? (
          <p className="text-zinc-600">
            {filter === 'errors' ? 'No errors.' : 'No logs yet. Waiting for background activity...'}
          </p>
        ) : (
          filteredLogs.map((entry, i) => (
            <div key={i} className={`flex gap-2 ${entry.level === 'error' ? 'bg-red-950/30' : entry.level === 'warn' ? 'bg-yellow-950/20' : ''}`}>
              <span className="shrink-0 text-zinc-600">{formatTime(entry.ts)}</span>
              <span className={`shrink-0 w-12 ${levelColor(entry.level)}`}>
                {entry.level.toUpperCase().padEnd(5)}
              </span>
              <span className={`whitespace-pre-wrap break-all ${entry.level === 'error' ? 'text-red-300' : entry.level === 'warn' ? 'text-yellow-300' : 'text-zinc-300'}`}>
                {colorizeMessage(entry.message)}
              </span>
            </div>
          ))
        )}
      </div>
      <button
        onClick={() => {
          setFollowScroll((f) => {
            if (!f) {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }
            return !f;
          });
        }}
        className={`absolute bottom-3 right-3 rounded px-2.5 py-1 text-xs transition-colors ${
          followScroll
            ? 'bg-green-900/60 text-green-300 hover:bg-green-900/80'
            : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'
        }`}
      >
        {followScroll ? 'following scroll' : 'follow scroll'} <svg className="inline h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      </div>
    </div>
  );
}
