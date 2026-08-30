import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import { useUIStore, type NetworkTab } from '@/store/ui-store';
import { useNetworkActions } from '@/hooks/useNetworkActions';
import { InvitationRow } from './InvitationRow';
import { ConnectionRow } from './ConnectionRow';

type SortMode = 'recent' | 'name';
const PAGE = 40;

export function NetworkView() {
  const networkTab = useUIStore((s) => s.networkTab);
  const setNetworkTab = useUIStore((s) => s.setNetworkTab);
  const selectedIndex = useUIStore((s) => s.networkSelectedIndex);
  const setSelectedIndex = useUIStore((s) => s.setNetworkSelectedIndex);
  const setAppView = useUIStore((s) => s.setAppView);
  const actions = useNetworkActions();

  const [filter, setFilter] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextStartRef = useRef(PAGE);
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      sendBridgeMessage({ type: 'FETCH_INVITATIONS' }),
      sendBridgeMessage({ type: 'FETCH_CONNECTIONS' }).then((res) => {
        if (!cancelled && res.success) setHasMore(Boolean(res.data?.hasMore));
      }),
    ]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const invitations = useLiveQuery(
    () => db.invitations.where('status').equals('pending').sortBy('sentAt').then((arr) => arr.reverse()),
    []
  ) ?? [];

  const connections = useLiveQuery(
    () => db.connections.orderBy('connectedAt').reverse().toArray(),
    []
  ) ?? [];

  const filteredInvitations = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return invitations;
    return invitations.filter(
      (i) => i.name.toLowerCase().includes(q) || i.headline.toLowerCase().includes(q) || i.message.toLowerCase().includes(q)
    );
  }, [invitations, filter]);

  const filteredConnections = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = connections;
    if (q) {
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.headline.toLowerCase().includes(q));
    }
    if (sortMode === 'name') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    return list;
  }, [connections, filter, sortMode]);

  const rowCount = networkTab === 'invitations' ? filteredInvitations.length : filteredConnections.length;

  useEffect(() => {
    if (selectedIndex >= rowCount && rowCount > 0) setSelectedIndex(rowCount - 1);
  }, [rowCount, selectedIndex, setSelectedIndex]);

  useEffect(() => {
    document.querySelectorAll('[data-network-row]')[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, networkTab]);

  // Guarded with a ref, not `loadingMore`: the scroll sentinel and the
  // keyboard both reach for the next page, and reading React state here would
  // let two overlapping calls fetch the same `start` twice.
  const fetchingRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoadingMore(true);
    const res = await sendBridgeMessage({ type: 'FETCH_CONNECTIONS', start: nextStartRef.current }).catch(() => ({ success: false }) as any);
    if (res.success) {
      nextStartRef.current += PAGE;
      setHasMore(Boolean(res.data?.hasMore));
    }
    fetchingRef.current = false;
    setLoadingMore(false);
  }, []);

  // Pull the next page when the end of the list comes into view. A single
  // 40-row page is nothing for an account with thousands of connections, and
  // making people click through it 40 at a time is not a browsable list.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || networkTab !== 'connections' || !hasMore || filter) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) void loadMore(); },
      { rootMargin: '400px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [networkTab, hasMore, filter, loadMore, connections.length]);

  // Same for the keyboard: J/K to the bottom has to keep going, or the list
  // ends at 40 for anyone who never touches the mouse.
  useEffect(() => {
    if (networkTab !== 'connections' || !hasMore || filter) return;
    if (selectedIndex >= filteredConnections.length - 5) void loadMore();
  }, [selectedIndex, networkTab, hasMore, filter, filteredConnections.length, loadMore]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ui = useUIStore.getState();
      // `?` toggles the keyboard cheat sheet, even from the network view
      // (the global inbox handler that normally owns this is inert here).
      if (e.key === '?' && e.shiftKey) {
        e.preventDefault();
        ui.toggleShortcutOverlay();
        return;
      }
      // While an overlay is open, only let Escape close the cheat sheet.
      if (ui.paletteOpen || ui.shortcutOverlayOpen) {
        if (e.key === 'Escape' && ui.shortcutOverlayOpen) {
          e.preventDefault();
          ui.setShortcutOverlayOpen(false);
        }
        return;
      }
      const target = e.target as HTMLElement;
      // SELECT counts as an editable control (same list as useKeyboard): the sort
      // dropdown needs its own Arrow keys to change options.
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable;
      if (e.metaKey || e.ctrlKey) return;
      if (isInput) {
        if (e.key === 'Escape') (target as HTMLElement).blur();
        if (e.key === 'Enter') (target as HTMLElement).blur();
        return;
      }
      const store = useUIStore.getState();
      const idx = store.networkSelectedIndex;
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          setAppView('inbox');
          return;
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(Math.min(idx + 1, Math.max(0, rowCount - 1)));
          return;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(Math.max(0, idx - 1));
          return;
        case '/':
          e.preventDefault();
          filterRef.current?.focus();
          return;
        case 'Tab':
          e.preventDefault();
          setNetworkTab(networkTab === 'invitations' ? 'connections' : 'invitations');
          return;
        case '1':
          e.preventDefault();
          setNetworkTab('invitations');
          return;
        case '2':
          e.preventDefault();
          setNetworkTab('connections');
          return;
      }
      if (networkTab === 'invitations') {
        const inv = filteredInvitations[idx];
        if (!inv) return;
        if (e.key === 'Enter') { e.preventDefault(); actions.acceptInvitation(inv); }
        if (e.key === 'd' || e.key === 'x' || e.key === 'Backspace') { e.preventDefault(); actions.ignoreInvitation(inv); }
        if (e.key === 'p') { e.preventDefault(); actions.openProfile(inv); }
      } else {
        const conn = filteredConnections[idx];
        if (!conn) return;
        if (e.key === 'Enter' || e.key === 'm') { e.preventDefault(); actions.messageConnection(conn); }
        if (e.key === 'p') { e.preventDefault(); actions.openProfile(conn); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [networkTab, rowCount, filteredInvitations, filteredConnections, actions, setAppView, setNetworkTab, setSelectedIndex]);

  // `40` next to Connections reads as "you have 40 connections". It is really
  // "40 synced so far", so say so while more remain.
  const TABS: { id: NetworkTab; label: string; count: string; key: string }[] = [
    { id: 'invitations', label: 'Invitations', count: invitations.length ? String(invitations.length) : '', key: '1' },
    {
      id: 'connections',
      label: 'Connections',
      count: connections.length ? `${connections.length}${hasMore ? '+' : ''}` : '',
      key: '2',
    },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface text-fg">
      <header className="flex items-center gap-1 border-b border-edge px-4 py-2">
        <button
          onClick={() => setAppView('inbox')}
          className="mr-2 shrink-0 rounded px-2 py-1 text-sm text-fg-secondary hover:bg-surface-hover"
          title="Back to inbox (Esc)"
        >
          ← Inbox
        </button>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setNetworkTab(tab.id)}
            title={`${tab.label} (${tab.key})`}
            className={`shrink-0 rounded px-3 py-1 text-sm font-medium ${networkTab === tab.id ? 'bg-surface-active text-fg-strong' : 'text-fg-secondary hover:bg-surface-hover'}`}
          >
            {tab.label}
            {tab.count && <span className="ml-1.5 text-xs text-fg-muted">{tab.count}</span>}
          </button>
        ))}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {networkTab === 'connections' && (
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="rounded border border-edge bg-surface px-2 py-1 text-xs text-fg-secondary"
            >
              <option value="recent">Recently added</option>
              <option value="name">Name A–Z</option>
            </select>
          )}
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setSelectedIndex(0); }}
            placeholder="Filter… ( / )"
            className="w-48 rounded border border-edge bg-transparent px-2 py-1 text-sm outline-none placeholder:text-fg-muted"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && rowCount === 0 ? (
          <p className="p-6 text-sm text-fg-muted">Loading your network…</p>
        ) : networkTab === 'invitations' ? (
          filteredInvitations.length === 0 ? (
            <p className="p-6 text-sm text-fg-muted">No pending invitations.</p>
          ) : (
            filteredInvitations.map((inv, i) => (
              <InvitationRow
                key={inv.id}
                invitation={inv}
                selected={i === selectedIndex}
                onAccept={() => actions.acceptInvitation(inv)}
                onIgnore={() => actions.ignoreInvitation(inv)}
                onOpenProfile={() => actions.openProfile(inv)}
              />
            ))
          )
        ) : (
          <>
            {filteredConnections.map((conn, i) => (
              <ConnectionRow
                key={conn.profileUrn}
                connection={conn}
                selected={i === selectedIndex}
                onMessage={() => actions.messageConnection(conn)}
                onOpenProfile={() => actions.openProfile(conn)}
              />
            ))}
            {filteredConnections.length === 0 && (
              <p className="p-6 text-sm text-fg-muted">No connections synced yet.</p>
            )}
            <div ref={sentinelRef} aria-hidden />
            {hasMore && !filter && (
              // Auto-loading covers the normal path; the button stays as the
              // fallback for when the observer never fires (no
              // IntersectionObserver, or a list too short to scroll).
              <button
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="m-4 rounded border border-edge px-4 py-2 text-sm text-fg-secondary hover:bg-surface-hover disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more connections'}
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-edge px-4 py-2 text-xs text-fg-faint">
        <button
          onClick={() => useUIStore.getState().toggleShortcutOverlay()}
          className="flex items-center gap-1.5 text-fg-faint transition-colors hover:text-fg-muted"
        >
          Keyboard Shortcuts
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px]">shift</kbd>
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px]">?</kbd>
        </button>
        <button
          onClick={() => setAppView('inbox')}
          className="flex items-center gap-1.5 text-fg-faint transition-colors hover:text-fg-muted"
        >
          Back to inbox
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px]">esc</kbd>
        </button>
      </div>
    </div>
  );
}
