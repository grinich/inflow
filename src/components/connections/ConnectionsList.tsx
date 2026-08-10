import { useEffect, useMemo, useRef, useState } from 'react';
import { GroupAvatar } from '../common/GroupAvatar';
import { useConnections } from '@/hooks/useConnections';
import { useAutoCategorize } from '@/hooks/useAutoCategorize';
import { useAISession } from '@/hooks/useAISession';
import { useCategorizeMode } from '@/hooks/useCategorizeMode';
import { useUIStore, type ConnectionFilter } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';
import { maybeAutoBackup } from '@/lib/backup-service';
import { db } from '@/db/database';
import { connectionProfileUrl, roleBadgeClass, interestTagClass } from './connection-format';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { ROLE_CATEGORIES, type ConnectionRole } from '@/types/connection';
import { InterestsEditor } from './InterestsEditor';
import { ConnectionContextMenu } from './ConnectionContextMenu';
import type { Connection } from '@/types/connection';

function filterMatches(c: Connection, f: ConnectionFilter): boolean {
  if (f.kind === 'all') return true;
  if (f.kind === 'role') return c.roleCategory === f.value;
  return !!c.interestTags?.includes(f.value);
}

type SortMode = 'recent' | 'first' | 'last';

const SORT_KEY = 'inflow-connections-sort';
function getStoredSort(): SortMode {
  try {
    const s = localStorage.getItem(SORT_KEY);
    if (s === 'recent' || s === 'first' || s === 'last') return s;
  } catch {}
  return 'recent';
}
function saveSort(mode: SortMode) {
  try {
    localStorage.setItem(SORT_KEY, mode);
  } catch {}
}

/** Sort a copy of the list by the chosen mode (default: most recent first). */
function sortConnections(list: Connection[], mode: SortMode): Connection[] {
  const arr = [...list];
  if (mode === 'first') {
    arr.sort((a, b) => a.fullName.localeCompare(b.fullName) || b.connectedAt - a.connectedAt);
  } else if (mode === 'last') {
    arr.sort(
      (a, b) =>
        (a.lastName || '').localeCompare(b.lastName || '') ||
        (a.firstName || '').localeCompare(b.firstName || '') ||
        b.connectedAt - a.connectedAt,
    );
  } else {
    arr.sort((a, b) => b.connectedAt - a.connectedAt);
  }
  return arr;
}

function searchMatches(c: Connection, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    c.fullName.toLowerCase().includes(needle) ||
    (c.headline || '').toLowerCase().includes(needle)
  );
}

function ConnectionRow({
  connection,
  selected,
  onSelect,
  onContextMenu,
}: {
  connection: Connection;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // Optional call: jsdom (tests) doesn't implement scrollIntoView.
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  const name = connection.fullName || 'Unknown';
  const role = connection.roleCategory;
  const interestTags = connection.interestTags ?? [];
  return (
    <button
      ref={ref}
      type="button"
      data-connection-urn={connection.profileUrn}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
        selected ? 'bg-surface-active' : 'hover:bg-surface-hover'
      }`}
    >
      <div className="shrink-0">
        <GroupAvatar names={[name]} pictures={[connection.pictureUrl]} size={40} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-fg-strong">{name}</span>
          {role && role !== 'Other' && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${roleBadgeClass(role)}`}
            >
              {role}
            </span>
          )}
        </div>
        {connection.headline && (
          <div className="truncate text-xs text-fg-secondary">{connection.headline}</div>
        )}
        {interestTags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {interestTags.map((t) => (
              <span
                key={t}
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${interestTagClass(t)}`}
              >
                ★ {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
  accent,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ${
        active
          ? 'bg-blue-500/20 text-blue-200 ring-blue-500/40'
          : accent
            ? 'bg-blue-500/10 text-blue-300 ring-blue-500/20 hover:bg-blue-500/15'
            : 'bg-surface-input text-fg-muted ring-edge hover:text-fg-secondary'
      }`}
    >
      <span>{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

export function ConnectionsList() {
  const { connections, isLoading } = useConnections();
  const selected = useUIStore((s) => s.selectedConnectionUrn);
  const setSelected = useUIStore((s) => s.setSelectedConnectionUrn);
  const showToast = useUIStore((s) => s.showToast);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Filter + search live in the store so Insights can drill in with them set.
  const filter = useUIStore((s) => s.connectionsFilter);
  const setFilter = useUIStore((s) => s.setConnectionsFilter);
  const query = useUIStore((s) => s.connectionsSearch);
  const setQuery = useUIStore((s) => s.setConnectionsSearch);
  const [editingInterests, setEditingInterests] = useState(false);
  const [sort, setSort] = useState<SortMode>(getStoredSort);
  const [contextMenu, setContextMenu] = useState<{ connection: Connection; x: number; y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const changeSort = (mode: SortMode) => {
    setSort(mode);
    saveSort(mode);
  };

  const { available: aiAvailable } = useAISession();
  const [categorizeMode, setCategorizeMode] = useCategorizeMode();
  const {
    categorizing,
    remaining,
    done,
    failed,
    error: aiError,
    uncategorized,
    retry: retryCategorize,
    categorizeNow,
  } = useAutoCategorize(connections);

  // When a categorization pass finishes: confirm with a toast and auto-backup.
  const wasCategorizing = useRef(false);
  useEffect(() => {
    if (wasCategorizing.current && !categorizing && done > 0) {
      showToast({ message: `Categorized ${done} connection${done === 1 ? '' : 's'}` });
      void maybeAutoBackup();
    }
    wasCategorizing.current = categorizing;
  }, [categorizing, done, showToast]);

  // Refresh from LinkedIn when the section mounts. The list still renders
  // immediately from IndexedDB while the fetch is in flight.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSyncing(true);
    sendBridgeMessage({ type: 'FETCH_CONNECTIONS' })
      .then((res) => {
        if (!cancelled && !res.success) setError(res.error || 'Failed to load connections');
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Counts per role / interest, plus the filtered view.
  const { roleCounts, interestCounts, visible } = useMemo(() => {
    const roles = new Map<ConnectionRole, number>();
    const interests = new Map<string, number>();
    for (const c of connections) {
      if (c.roleCategory) roles.set(c.roleCategory, (roles.get(c.roleCategory) ?? 0) + 1);
      for (const t of c.interestTags ?? []) interests.set(t, (interests.get(t) ?? 0) + 1);
    }
    const filtered = connections.filter(
      (c) => filterMatches(c, filter) && searchMatches(c, query),
    );
    return {
      roleCounts: roles,
      interestCounts: interests,
      visible: sortConnections(filtered, sort),
    };
  }, [connections, filter, query, sort]);

  // Auto-select the first visible connection (or reconcile a stale selection).
  useEffect(() => {
    if (visible.length === 0) return;
    if (!selected || !visible.some((c) => c.profileUrn === selected)) {
      setSelected(visible[0].profileUrn);
    }
  }, [visible, selected, setSelected]);

  // Keyboard navigation for the connections list: j/k (or arrows) move the
  // selection, Enter opens the selected person's profile. The global handler
  // (useKeyboard) yields to us while the Connections section is active.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // "/" jumps to the search box (mirrors the inbox).
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (visible.length === 0) return;
      const idx = Math.max(0, visible.findIndex((c) => c.profileUrn === selected));
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected(visible[Math.min(idx + 1, visible.length - 1)].profileUrn);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected(visible[Math.max(idx - 1, 0)].profileUrn);
      } else if (e.key === 'Enter') {
        const c = visible[idx];
        if (c) {
          e.preventDefault();
          window.open(connectionProfileUrl(c.publicId, c.fullName || 'Unknown'), '_blank', 'noopener,noreferrer');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selected, setSelected]);

  const showEmpty = !isLoading && connections.length === 0 && !syncing;
  const showLoading = (isLoading || syncing) && connections.length === 0 && !error;

  const rolesPresent = ROLE_CATEGORIES.filter((r) => (roleCounts.get(r) ?? 0) > 0);
  const interestsPresent = [...interestCounts.keys()].sort();
  const hasFilters = rolesPresent.length > 0 || interestsPresent.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-edge px-4 py-2.5">
        <h2 className="text-sm font-semibold text-fg-strong">Connections</h2>
        {connections.length > 0 && (
          <span className="rounded-full bg-surface-input px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
            {connections.length}
          </span>
        )}
        {syncing && !categorizing && (
          <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" title="Refreshing connections from LinkedIn" />
        )}
        <div className="ml-auto flex items-center gap-1">
          {aiAvailable && (
            <button
              type="button"
              onClick={() => setCategorizeMode(categorizeMode === 'auto' ? 'manual' : 'auto')}
              aria-pressed={categorizeMode === 'auto'}
              aria-label={`AI auto-categorize ${categorizeMode === 'auto' ? 'on' : 'off'}`}
              title={
                categorizeMode === 'auto'
                  ? 'AI auto-categorize is ON — new connections are tagged automatically. Click to switch to manual.'
                  : 'AI auto-categorize is OFF — nothing runs until you ask. Click to turn on.'
              }
              className={`flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors ${
                categorizeMode === 'auto'
                  ? 'bg-blue-500/15 text-blue-300 ring-blue-500/30 hover:bg-blue-500/25'
                  : 'text-fg-muted ring-edge hover:text-fg-secondary'
              }`}
            >
              <SparkleIcon className="h-3 w-3" />
              {categorizeMode === 'auto' ? 'Auto' : 'Manual'}
            </button>
          )}
          {aiAvailable && !categorizing && uncategorized > 0 && (
            <button
              type="button"
              onClick={categorizeNow}
              title={`Categorize ${uncategorized} uncategorized connection${uncategorized === 1 ? '' : 's'}`}
              className="cursor-pointer rounded-md bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-300 ring-1 ring-inset ring-blue-500/30 transition-colors hover:bg-blue-500/25"
            >
              Categorize {uncategorized}
            </button>
          )}
          <button
            type="button"
            onClick={() => setEditingInterests((v) => !v)}
            title="Edit interest tags"
            aria-label="Edit interest tags"
            aria-expanded={editingInterests}
            className={`flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset transition-colors ${
              editingInterests
                ? 'bg-blue-500/15 text-blue-300 ring-blue-500/30'
                : 'text-fg-muted ring-edge hover:text-fg-secondary'
            }`}
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            Tags
          </button>
        </div>
      </div>

      {/* AI categorization progress */}
      {categorizing && (
        <div className="border-b border-edge bg-blue-500/5 px-4 py-2" data-testid="categorize-progress">
          <div className="flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-blue-300">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
              Scanning connections with AI…
            </span>
            <span className="tabular-nums text-fg-muted">
              {done} of {done + remaining}
            </span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-input">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${done + remaining > 0 ? Math.max(4, Math.round((done / (done + remaining)) * 100)) : 8}%` }}
            />
          </div>
        </div>
      )}

      {/* AI categorization failure notice */}
      {!categorizing && failed > 0 && (() => {
        const failMsg =
          `Couldn't categorize ${failed} connection${failed === 1 ? '' : 's'}` +
          (aiError ? ` — ${aiError}` : '');
        return (
          <div className="flex items-start gap-2 border-b border-edge bg-amber-500/10 px-4 py-2 text-[11px] text-amber-300">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {/* Wraps to multiple lines; title gives the full text on hover too. */}
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words" title={failMsg}>
              {failMsg}
            </span>
            <button
              onClick={retryCategorize}
              className="mt-0.5 shrink-0 rounded-md px-2 py-0.5 font-medium text-amber-200 ring-1 ring-inset ring-amber-500/30 transition-colors hover:bg-amber-500/10"
            >
              Retry
            </button>
          </div>
        );
      })()}

      {/* Search + sort toolbar */}
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={searchRef}
            data-connections-search
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                }
                searchRef.current?.blur();
              }
            }}
            placeholder="Search connections…"
            className="w-full rounded-lg bg-surface-input py-1.5 pl-8 pr-2.5 text-sm text-fg-strong ring-1 ring-inset ring-edge outline-none placeholder:text-fg-faint focus:ring-blue-500/40"
          />
        </div>
        <label className="sr-only" htmlFor="connections-sort">Sort connections</label>
        <select
          id="connections-sort"
          value={sort}
          onChange={(e) => changeSort(e.target.value as SortMode)}
          className="shrink-0 rounded-lg bg-surface-input px-2 py-1.5 text-xs font-medium text-fg-secondary ring-1 ring-inset ring-edge outline-none focus:ring-blue-500/40"
        >
          <option value="recent">Recently added</option>
          <option value="first">First name</option>
          <option value="last">Last name</option>
        </select>
      </div>

      {/* Interests editor */}
      {editingInterests && (
        <InterestsEditor
          aiAvailable={aiAvailable}
          connectionCount={connections.length}
          onRecategorize={async () => {
            // Clear the stamp so the auto-categorizer re-runs with new interests.
            if (db) await db.connections.toCollection().modify({ categorizedAt: 0 });
          }}
        />
      )}

      {/* Filter chips */}
      {hasFilters && (
        <div
          data-testid="connection-filters"
          className="flex items-center gap-1.5 overflow-x-auto border-b border-edge px-3 py-2"
        >
          <FilterChip
            label="All"
            count={connections.length}
            active={filter.kind === 'all'}
            onClick={() => setFilter({ kind: 'all' })}
          />
          {interestsPresent.length > 0 && (
            <span className="shrink-0 pl-1.5 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
              Tags
            </span>
          )}
          {interestsPresent.map((t) => (
            <FilterChip
              key={`i:${t}`}
              label={`★ ${t}`}
              count={interestCounts.get(t) ?? 0}
              active={filter.kind === 'interest' && filter.value === t}
              accent
              onClick={() => setFilter({ kind: 'interest', value: t })}
            />
          ))}
          {rolesPresent.length > 0 && (
            <span className="shrink-0 pl-2 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
              Roles
            </span>
          )}
          {rolesPresent.map((r) => (
            <FilterChip
              key={`r:${r}`}
              label={r}
              count={roleCounts.get(r) ?? 0}
              active={filter.kind === 'role' && filter.value === r}
              onClick={() => setFilter({ kind: 'role', value: r })}
            />
          ))}
        </div>
      )}

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {error && <div className="px-4 py-8 text-center text-sm text-red-400">{error}</div>}

        {!error && showLoading && (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-fg-muted">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-fg-muted border-t-transparent" />
            <span className="text-sm">Loading your connections…</span>
          </div>
        )}

        {!error && showEmpty && (
          <div className="px-4 py-12 text-center text-sm text-fg-muted">No connections found yet.</div>
        )}

        {!error && !showEmpty && visible.length === 0 && connections.length > 0 && (
          <div className="px-4 py-12 text-center text-sm text-fg-muted">
            No connections match this filter.
          </div>
        )}

        {visible.map((c) => (
          <ConnectionRow
            key={c.profileUrn}
            connection={c}
            selected={c.profileUrn === selected}
            onSelect={() => setSelected(c.profileUrn)}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelected(c.profileUrn);
              setContextMenu({ connection: c, x: e.clientX, y: e.clientY });
            }}
          />
        ))}
      </div>

      {contextMenu && (
        <ConnectionContextMenu
          connection={contextMenu.connection}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
