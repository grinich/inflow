import { useEffect, useMemo, useRef, useState } from 'react';
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
    () => db.invitations.where('status').equals('pending').reverse().sortBy('sentAt'),
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

  async function loadMore() {
    setLoadingMore(true);
    const res = await sendBridgeMessage({ type: 'FETCH_CONNECTIONS', start: nextStartRef.current }).catch(() => ({ success: false }) as any);
    if (res.success) {
      nextStartRef.current += PAGE;
      setHasMore(Boolean(res.data?.hasMore));
    }
    setLoadingMore(false);
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
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
          setSelectedIndex(idx - 1);
          return;
        case '/':
          e.preventDefault();
          filterRef.current?.focus();
          return;
        case 'Tab':
          e.preventDefault();
          setNetworkTab(networkTab === 'invitations' ? 'connections' : 'invitations');
          return;
      }
      if (networkTab === 'invitations') {
        const inv = filteredInvitations[idx];
        if (!inv) return;
        if (e.key === 'Enter') { e.preventDefault(); actions.acceptInvitation(inv); }
        if (e.key === 'x') { e.preventDefault(); actions.ignoreInvitation(inv); }
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

  const TABS: { id: NetworkTab; label: string; count: number }[] = [
    { id: 'invitations', label: 'Invitations', count: invitations.length },
    { id: 'connections', label: 'Connections', count: connections.length },
  ];

  return (
    <div className="flex h-full flex-1 flex-col bg-surface text-fg">
      <header className="flex items-center gap-1 border-b border-edge px-4 py-2">
        <button
          onClick={() => setAppView('inbox')}
          className="mr-2 rounded px-2 py-1 text-sm text-fg/60 hover:bg-fg/5"
          title="Back to inbox (Esc)"
        >
          ← Inbox
        </button>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setNetworkTab(tab.id)}
            className={`rounded px-3 py-1 text-sm font-medium ${networkTab === tab.id ? 'bg-fg/10 text-fg' : 'text-fg/60 hover:bg-fg/5'}`}
          >
            {tab.label}
            {tab.count > 0 && <span className="ml-1.5 text-xs text-fg/50">{tab.count}</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {networkTab === 'connections' && (
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="rounded border border-edge bg-surface px-2 py-1 text-xs text-fg/70"
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
            className="w-48 rounded border border-edge bg-transparent px-2 py-1 text-sm outline-none placeholder:text-fg/40"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && rowCount === 0 ? (
          <p className="p-6 text-sm text-fg/50">Loading your network…</p>
        ) : networkTab === 'invitations' ? (
          filteredInvitations.length === 0 ? (
            <p className="p-6 text-sm text-fg/50">No pending invitations.</p>
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
              <p className="p-6 text-sm text-fg/50">No connections synced yet.</p>
            )}
            {hasMore && !filter && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="m-4 rounded border border-edge px-4 py-2 text-sm text-fg/70 hover:bg-fg/5 disabled:opacity-50"
              >
                {loadingMore ? 'Loading…' : 'Load more connections'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
