import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import { useUIStore, type NetworkTab } from '@/store/ui-store';
import { useNetworkActions } from '@/hooks/useNetworkActions';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';
import { InvitationRow } from './InvitationRow';
import { SentInvitationRow } from './SentInvitationRow';
import { SentInvitationDetail } from './SentInvitationDetail';
import { ConnectionRow } from './ConnectionRow';
import { InvitationDetail } from './InvitationDetail';
import { ConnectionDetail } from './ConnectionDetail';
import { ListLoadingIndicator } from '@/components/common/ListLoadingIndicator';
import { keyboardFocusOnly } from '@/lib/focus-on-keyboard-only';

type SortMode = 'recent' | 'name';
const PAGE = 40;

/**
 * An empty list pane. A failed load must not look like an empty one — that is
 * how a dead endpoint went unnoticed.
 */
function EmptyPane({ failure, empty }: { failure?: string; empty: string }) {
  if (!failure) return <p className="p-6 text-sm text-fg-muted">{empty}</p>;
  return (
    <div className="p-6 text-sm">
      <p className="text-fg-secondary">Couldn't load this list.</p>
      <p className="mt-1 break-words text-xs text-fg-muted">{failure}</p>
    </div>
  );
}

/** What each tab asks the background for. */
const FETCH_FOR: Record<NetworkTab, { type: string }> = {
  invitations: { type: 'FETCH_INVITATIONS' },
  sent: { type: 'FETCH_SENT_INVITATIONS' },
  connections: { type: 'FETCH_CONNECTIONS' },
};

export function NetworkView() {
  const networkTab = useUIStore((s) => s.networkTab);
  const setNetworkTab = useUIStore((s) => s.setNetworkTab);
  const selectedIndex = useUIStore((s) => s.networkSelectedIndex);
  const setSelectedIndex = useUIStore((s) => s.setNetworkSelectedIndex);
  const setAppView = useUIStore((s) => s.setAppView);
  const actions = useNetworkActions();
  const { width: sidebarWidth, isDragging: isDraggingSidebar, onDividerMouseDown, onDividerDoubleClick } = useResizableSidebar();

  const [filter, setFilter] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  // Per tab, not one flag for all three. The walks run concurrently and the
  // Sent one is much the slowest, so a single flag either cleared while Sent
  // was still fetching or held the other two back — and the tab the user is
  // looking at is the only one whose progress they can see.
  const [loading, setLoading] = useState<Record<NetworkTab, boolean>>({
    invitations: true,
    connections: true,
    sent: true,
  });
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const nextStartRef = useRef(PAGE);
  const filterRef = useRef<HTMLInputElement>(null);

  // Which tabs failed to load, so an empty list can say why. Every one of
  // these results used to be discarded, which meant a fetch that returned
  // nothing and a fetch that failed outright rendered identically — the Sent
  // tab reported "no requests waiting on a reply" while its endpoint was
  // answering 400 on every call.
  const [failed, setFailed] = useState<Partial<Record<NetworkTab, string>>>({});

  /** Tabs already fetched this mount, so switching back and forth is free. */
  const fetched = useRef<Partial<Record<NetworkTab, boolean>>>({});

  // Fetch the tab being LOOKED AT, and only that one.
  //
  // All three used to go out together on mount, so opening Invitations paid
  // for a full walk of the sent list as well — the slowest of the three, and
  // the one most likely not to be wanted. Nothing outside this view reads
  // those tables, so there is no count or badge that needs them loaded.
  useEffect(() => {
    const tab = networkTab;
    if (fetched.current[tab]) return;
    fetched.current[tab] = true;
    // A retry after a failure needs its spinner back.
    setLoading((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
    let cancelled = false;

    sendBridgeMessage(FETCH_FOR[tab] as any)
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          setFailed((prev) => ({ ...prev, [tab]: res.error || 'Request failed' }));
          // Let coming back to the tab try again. These walks are long and the
          // background gives up on a rate-limited page rather than retrying,
          // so a transient failure would otherwise stick until the whole view
          // is closed and reopened.
          fetched.current[tab] = false;
        } else if (tab === 'connections') {
          setHasMore(Boolean(res.data?.hasMore));
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setFailed((prev) => ({ ...prev, [tab]: String(err) }));
        fetched.current[tab] = false;
      })
      .finally(() => {
        if (!cancelled) setLoading((prev) => ({ ...prev, [tab]: false }));
      });

    return () => {
      cancelled = true;
    };
  }, [networkTab]);

  const invitations = useLiveQuery(
    () => db.invitations.where('status').equals('pending').sortBy('sentAt').then((arr) => arr.reverse()),
    []
  ) ?? [];

  const sentInvitations = useLiveQuery(
    () => db.sentInvitations.where('status').equals('pending').sortBy('sentAt').then((arr) => arr.reverse()),
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

  const filteredSent = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sentInvitations;
    return sentInvitations.filter(
      (i) => i.name.toLowerCase().includes(q) || i.headline.toLowerCase().includes(q) || i.message.toLowerCase().includes(q)
    );
  }, [sentInvitations, filter]);

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

  const rowCount =
    networkTab === 'invitations' ? filteredInvitations.length
    : networkTab === 'sent' ? filteredSent.length
    : filteredConnections.length;

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
        // Tab is deliberately absent: it belongs to focus traversal, and the
        // inbox handler leaves it alone for the same reason. 1/2/3 switch tabs.
        case 'Tab':
          return;
        case '1':
          e.preventDefault();
          setNetworkTab('invitations');
          return;
        case '2':
          e.preventDefault();
          setNetworkTab('connections');
          return;
        case '3':
          e.preventDefault();
          setNetworkTab('sent');
          return;
      }
      if (networkTab === 'invitations') {
        const inv = filteredInvitations[idx];
        if (!inv) return;
        if (e.key === 'Enter') { e.preventDefault(); actions.acceptInvitation(inv); }
        if (e.key === 'd' || e.key === 'x' || e.key === 'Backspace') { e.preventDefault(); actions.ignoreInvitation(inv); }
        if (e.key === 'p') { e.preventDefault(); actions.openProfile(inv); }
      } else if (networkTab === 'sent') {
        const inv = filteredSent[idx];
        if (!inv) return;
        // Withdraw is button-only for now — deliberately no key, so a stray D
        // on the wrong tab cannot silently retract a request.
        if (e.key === 'p') { e.preventDefault(); actions.openProfile({ publicId: inv.publicId, profileUrn: inv.toUrn }); }
      } else {
        const conn = filteredConnections[idx];
        if (!conn) return;
        if (e.key === 'Enter' || e.key === 'm') { e.preventDefault(); actions.messageConnection(conn); }
        if (e.key === 'p') { e.preventDefault(); actions.openProfile(conn); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [networkTab, rowCount, filteredInvitations, filteredSent, filteredConnections, actions, setAppView, setNetworkTab, setSelectedIndex]);

  // No counts on the tabs. They arrive with the fetch rather than with the
  // render, so each one appearing resized its button and shifted the two
  // beside it — a visible flicker every time you opened the view. A number
  // that jumps is worse than no number.
  const TABS: { id: NetworkTab; label: string; key: string }[] = [
    { id: 'invitations', label: 'Invitations', key: '1' },
    { id: 'connections', label: 'Connections', key: '2' },
    { id: 'sent', label: 'Sent', key: '3' },
  ];

  const selectedInvitation = filteredInvitations[selectedIndex];
  const selectedSent = filteredSent[selectedIndex];
  const selectedConnection = filteredConnections[selectedIndex];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface text-fg">
      {/* Two panes, same shape as the inbox: list left, selected person right. */}
      <div className="flex min-h-0 flex-1">
        <div style={{ width: sidebarWidth }} className="flex h-full shrink-0 flex-col border-r border-edge">
          {/* Same shell as ConversationListHeader — identical padding, gap and
              a fixed first-row height — so the header does not change size and
              the search field does not move when you cross between views. See
              the note there for why the height is fixed rather than a floor. */}
          <header className="flex flex-col gap-2 border-b border-edge px-4 py-3">
            <div className="flex h-7 items-center gap-2">
              <button
                {...keyboardFocusOnly}
                onClick={() => setAppView('inbox')}
                className="mr-1 shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] font-medium text-fg-secondary transition-colors hover:bg-surface-hover"
                title="Back to inbox (Esc)"
              >
                ← Inbox
              </button>
              {/* Character-for-character the inbox's folder selector. The
                  selected pill is `bg-surface`, which only reads as selected
                  against the track's `bg-surface-input` — so the two go
                  together; a spaced-out version loses the selected state. */}
              <div className="flex shrink-0 rounded-md bg-surface-input p-0.5">
                {TABS.map((tab) => (
                  <button
                    {...keyboardFocusOnly}
                    key={tab.id}
                    onClick={() => setNetworkTab(tab.id)}
                    title={`${tab.label} (${tab.key})`}
                    className={`cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                      networkTab === tab.id
                        ? 'bg-surface text-fg-strong shadow-sm'
                        : 'text-fg-muted hover:text-fg-secondary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {networkTab === 'connections' && (
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  // Shorter than the row, so the sort control can never be
                  // what decides this row's height.
                  className="ml-auto h-6 shrink-0 cursor-pointer rounded-md bg-surface-input px-2 text-[11px] font-medium text-fg-muted outline-none transition-colors hover:text-fg-secondary"
                >
                  <option value="recent">Recently added</option>
                  <option value="name">Name A–Z</option>
                </select>
              )}
            </div>
            {/* Byte-for-byte the inbox's search row: a bare `relative`
                wrapper holding the field. Anything else here — a flex row, a
                sibling control — changes the field's width or the row's
                height, and the box visibly moves as you cross between views. */}
            <div className="relative">
                <input
                  ref={filterRef}
                  type="text"
                  value={filter}
                  onChange={(e) => { setFilter(e.target.value); setSelectedIndex(0); }}
                  placeholder={`Filter ${networkTab === 'invitations' ? 'invitations' : networkTab === 'sent' ? 'sent requests' : 'connections'}...`}
                  className="w-full rounded-lg bg-surface-input px-3 py-1.5 pr-8 text-sm text-fg placeholder-fg-faint outline-none ring-1 ring-ring-muted transition-colors focus:ring-blue-500/50"
                />
                {filter ? (
                  <button
                    onClick={() => { setFilter(''); setSelectedIndex(0); filterRef.current?.focus(); }}
                    className="absolute right-2 top-1/2 flex -translate-y-1/2 cursor-pointer items-center gap-1 text-[10px] text-fg-muted hover:text-fg-secondary"
                  >
                    clear
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-edge bg-surface px-1.5 py-0.5 text-[10px] font-medium leading-none text-fg-muted">
                    /
                  </kbd>
                )}
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            {loading[networkTab] && rowCount === 0 ? (
              <ListLoadingIndicator label="Loading your network..." />
            ) : networkTab === 'invitations' ? (
              filteredInvitations.length === 0 ? (
                <EmptyPane failure={failed.invitations} empty="No pending invitations." />
              ) : (
                filteredInvitations.map((inv, i) => (
                  <InvitationRow
                    key={inv.id}
                    invitation={inv}
                    selected={i === selectedIndex}
                    onSelect={() => setSelectedIndex(i)}
                  />
                ))
              )
            ) : networkTab === 'sent' ? (
              filteredSent.length === 0 ? (
                <EmptyPane failure={failed.sent} empty="No requests waiting on a reply." />
              ) : (
                <>
                  {filteredSent.map((inv, i) => (
                    <SentInvitationRow
                      key={inv.id}
                      invitation={inv}
                      selected={i === selectedIndex}
                      onSelect={() => setSelectedIndex(i)}
                    />
                  ))}
                </>
              )
            ) : (
              <>
                {filteredConnections.map((conn, i) => (
                  <ConnectionRow
                    key={conn.profileUrn}
                    connection={conn}
                    selected={i === selectedIndex}
                    onSelect={() => setSelectedIndex(i)}
                  />
                ))}
                {filteredConnections.length === 0 && (
                  <EmptyPane failure={failed.connections} empty="No connections synced yet." />
                )}
                <div ref={sentinelRef} aria-hidden />
                {hasMore && !filter && (
                  // Auto-loading covers the normal path; the button stays as the
                  // fallback for when the observer never fires (no
                  // IntersectionObserver, or a list too short to scroll).
                  <button
                    {...keyboardFocusOnly}
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="m-4 rounded border border-edge px-4 py-2 text-sm text-fg-secondary hover:bg-surface-hover disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading…' : 'Load more connections'}
                  </button>
                )}
              </>
            )}
            {/* Rows land page by page now, so keep saying so instead of going
                quiet the moment the first ten appear. */}
            {loading[networkTab] && rowCount > 0 && (
              <ListLoadingIndicator label="Loading more..." />
            )}
          </div>
        </div>

        {/* Resize handle — same divider as the inbox, sharing its stored width. */}
        <div
          onMouseDown={onDividerMouseDown}
          onDoubleClick={onDividerDoubleClick}
          title="Drag to resize · double-click to reset"
          className={`group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize ${isDraggingSidebar ? 'bg-blue-500/40' : ''}`}
        >
          <div className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${isDraggingSidebar ? 'bg-blue-500' : 'bg-transparent group-hover:bg-blue-500/60'}`} />
        </div>

        <div className="flex h-full min-w-0 flex-1 flex-col">
          {networkTab === 'invitations' ? (
            selectedInvitation ? (
              <InvitationDetail
                invitation={selectedInvitation}
                onAccept={() => actions.acceptInvitation(selectedInvitation)}
                onIgnore={() => actions.ignoreInvitation(selectedInvitation)}
                onOpenProfile={() => actions.openProfile(selectedInvitation)}
              />
            ) : null
          ) : networkTab === 'sent' ? (
            selectedSent ? (
              <SentInvitationDetail
                invitation={selectedSent}
                onWithdraw={() => actions.withdrawInvitation(selectedSent)}
                onOpenProfile={() => actions.openProfile({ publicId: selectedSent.publicId, profileUrn: selectedSent.toUrn })}
              />
            ) : null
          ) : selectedConnection ? (
            <ConnectionDetail
              connection={selectedConnection}
              onMessage={() => actions.messageConnection(selectedConnection)}
              onOpenProfile={() => actions.openProfile(selectedConnection)}
            />
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-edge px-4 py-2 text-xs text-fg-faint">
        <button
          {...keyboardFocusOnly}
          onClick={() => useUIStore.getState().toggleShortcutOverlay()}
          className="flex items-center gap-1.5 text-fg-faint transition-colors hover:text-fg-muted"
        >
          Keyboard Shortcuts
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px]">shift</kbd>
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px]">?</kbd>
        </button>
        <button
          {...keyboardFocusOnly}
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
