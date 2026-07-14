import { useState, useRef, useMemo, useCallback } from 'react';
import { useUIStore, type InboxTab } from '@/store/ui-store';
import { sendBridgeMessage } from '@/lib/bridge';

const FILTER_SUGGESTIONS = [
  { filter: 'is:unread', description: 'Unread conversations' },
  { filter: 'is:read', description: 'Read conversations' },
  { filter: 'is:starred', description: 'Starred conversations' },
  { filter: 'is:group', description: 'Group conversations' },
  { filter: 'has:attachment', description: 'Has attachments' },
  { filter: 'has:draft', description: 'Has unsent draft' },
  { filter: 'from:', description: 'Filter by sender name' },
  { filter: 'after:', description: 'Active after date (YYYY-MM-DD)' },
  { filter: 'before:', description: 'Active before date (YYYY-MM-DD)' },
  { filter: 'newer:', description: 'Active within N days (e.g. 7d)' },
  { filter: 'older:', description: 'Inactive for N days (e.g. 30d)' },
] as const;

/** Prefixes that accept a user-provided value after the colon */
const VALUE_PREFIXES = ['from:', 'after:', 'before:', 'newer:', 'older:'];

const TABS: { id: InboxTab; label: string; key: string }[] = [
  { id: 'focused', label: 'Focused', key: '1' },
  { id: 'other', label: 'Other', key: '2' },
  { id: 'archived', label: 'Archive', key: '3' },
  { id: 'spam', label: 'Spam', key: '4' },
];

/** Map UI tab to LinkedIn API category for on-demand sync. */
export const TAB_CATEGORY: Record<InboxTab, string | null> = {
  focused: null, // synced proactively by the poller
  other: 'SECONDARY_INBOX',
  archived: 'ARCHIVE',
  spam: 'SPAM',
};

export function ConversationListHeader({ conversationCount }: { conversationCount?: number }) {
  const searchQuery = useUIStore((s) => s.searchQuery);
  const setSearchQuery = useUIStore((s) => s.setSearchQuery);
  const inboxTab = useUIStore((s) => s.inboxTab);
  const setInboxTab = useUIStore((s) => s.setInboxTab);
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dropdownDismissed, setDropdownDismissed] = useState(false);

  function handleTabSelect(tab: InboxTab) {
    setInboxTab(tab);
    const category = TAB_CATEGORY[tab];
    if (category) {
      sendBridgeMessage({ type: 'BURST_DISCOVER', category }).catch(() => {});
      sendBridgeMessage({ type: 'SYNC_CATEGORY', category }).catch(() => {});
    }
  }

  // Unread quick-filter: toggles the `is:unread` token in the search query.
  const unreadActive = /(^|\s)is:unread(\s|$)/i.test(searchQuery);
  function toggleUnread() {
    if (unreadActive) {
      setSearchQuery(searchQuery.replace(/\bis:unread\b/gi, '').replace(/\s{2,}/g, ' ').trim());
    } else {
      const trimmed = searchQuery.trim();
      setSearchQuery(trimmed ? `${trimmed} is:unread` : 'is:unread');
    }
  }

  // Extract the current token (last space-separated word) from the input
  const currentToken = useMemo(() => {
    if (!searchQuery) return '';
    const parts = searchQuery.split(' ');
    return parts[parts.length - 1] || '';
  }, [searchQuery]);

  // Compute matching suggestions based on the current token
  const suggestions = useMemo(() => {
    if (!currentToken || dropdownDismissed) return [];
    const tokenLower = currentToken.toLowerCase();

    // Check if the token already has a value after a complete value-prefix
    // e.g. "from:john" should NOT show dropdown, but "from:" alone should NOT either (value prefix)
    for (const prefix of VALUE_PREFIXES) {
      if (tokenLower.startsWith(prefix) && tokenLower.length > prefix.length) {
        return []; // Has value after prefix, don't show
      }
      if (tokenLower === prefix) {
        return []; // Exact value prefix typed, waiting for user value
      }
    }

    // Check if token matches complete non-value filters exactly (already typed the full filter)
    const exactMatch = FILTER_SUGGESTIONS.find(
      (s) => s.filter.toLowerCase() === tokenLower && !VALUE_PREFIXES.includes(s.filter)
    );
    if (exactMatch) return [];

    // Filter suggestions that match the current token as a prefix
    return FILTER_SUGGESTIONS.filter((s) =>
      s.filter.toLowerCase().startsWith(tokenLower)
    );
  }, [currentToken, dropdownDismissed]);

  const dropdownVisible = suggestions.length > 0;

  const completeFilter = useCallback(
    (filter: string) => {
      const parts = searchQuery.split(' ');
      parts[parts.length - 1] = filter;
      // For value-less filters, append a space; for value filters leave cursor after colon
      const isValueFilter = VALUE_PREFIXES.includes(filter);
      const newQuery = parts.join(' ') + (isValueFilter ? '' : ' ');
      setSearchQuery(newQuery);
      setSelectedIndex(0);
      setDropdownDismissed(false);
      // Re-focus input so user can keep typing
      inputRef.current?.focus();
    },
    [searchQuery, setSearchQuery]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (dropdownVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        completeFilter(suggestions[selectedIndex].filter);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDropdownDismissed(true);
        return;
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
    setSelectedIndex(0);
    setDropdownDismissed(false);
  }

  return (
    // @container enables the width-based visibility below: with the sidebar
    // now resizable, secondary controls yield space before the row overflows.
    <div className="@container flex flex-col gap-2 border-b border-edge px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
        <h1 className="shrink-0 text-base font-semibold text-fg-strong">
          <span className="text-blue-400">in</span>ƒlow
        </h1>

        {/* Folder selector — segmented control when the (resizable) sidebar is
            wide enough, a compact dropdown when it's narrow. */}
        <div className="hidden rounded-md bg-surface-input p-0.5 @min-[352px]:flex">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabSelect(tab.id)}
              className={`cursor-pointer rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                inboxTab === tab.id
                  ? 'bg-surface text-fg-strong shadow-sm'
                  : 'text-fg-muted hover:text-fg-secondary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="relative @min-[352px]:hidden">
          <select
            aria-label="Folder"
            value={inboxTab}
            onChange={(e) => handleTabSelect(e.target.value as InboxTab)}
            className="cursor-pointer appearance-none rounded-md bg-surface-input py-1 pl-2 pr-6 text-[11px] font-medium text-fg-strong outline-none ring-1 ring-transparent transition-colors focus:ring-blue-500/50"
          >
            {TABS.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {/* Unread quick-filter — sets/clears the is:unread search filter */}
        <button
          onClick={toggleUnread}
          title="Show only unread"
          aria-pressed={unreadActive}
          className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
            unreadActive
              ? 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30'
              : 'bg-surface-input text-fg-muted hover:text-fg-secondary'
          }`}
        >
          Unread
        </button>
        </div>

        <button
          onClick={() => useUIStore.getState().setComposeNewActive(true)}
          title="New message (C)"
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
          <kbd className="rounded border border-edge bg-surface px-1 py-px font-mono text-[10px] text-fg-faint">C</kbd>
        </button>
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          data-search-input
          type="text"
          placeholder={conversationCount ? `Search ${conversationCount.toLocaleString()} conversations...` : 'Search conversations...'}
          value={searchQuery}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Delay to allow click on dropdown item
            setTimeout(() => setDropdownDismissed(true), 150);
          }}
          onFocus={() => setDropdownDismissed(false)}
          className="w-full rounded-lg bg-surface-input px-3 py-1.5 pr-8 text-sm text-fg placeholder-fg-faint outline-none ring-1 ring-ring-muted transition-colors focus:ring-blue-500/50"
        />
        {searchQuery ? (
          <button
            onClick={() => { setSearchQuery(''); inputRef.current?.focus(); }}
            className="absolute right-2 top-1/2 flex -translate-y-1/2 cursor-pointer items-center gap-1 text-[10px] text-fg-muted hover:text-fg-secondary"
          >
            clear
            <kbd className="rounded border border-edge bg-surface px-1 py-0.5 font-medium leading-none">
              esc
            </kbd>
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-edge bg-surface px-1.5 py-0.5 text-[10px] font-medium leading-none text-fg-muted">
            /
          </kbd>
        )}

        {/* Autocomplete dropdown */}
        {dropdownVisible && (
          <div data-filter-dropdown className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-edge bg-surface shadow-lg">
            {suggestions.map((s, i) => (
              <button
                key={s.filter}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent blur
                  completeFilter(s.filter);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors ${
                  i === selectedIndex ? 'bg-surface-hover' : ''
                }`}
              >
                <span className="font-mono text-fg-strong">{s.filter}</span>
                <span className="truncate text-fg-muted">{s.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
