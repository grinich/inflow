import { useState, type ReactNode } from 'react';
import { useUIStore, type AppSection, type InboxTab } from '@/store/ui-store';
import { tabLabel } from '@/lib/inbox-labels';
import { Logo } from '@/components/common/Wordmark';

/** Width of the nav rail when expanded / collapsed (px). */
export const NAV_RAIL_WIDTH = 168;
export const NAV_RAIL_COLLAPSED_WIDTH = 56;

interface NavRailProps {
  /** Live count of connections, shown as a badge on the Connections item. */
  connectionsCount?: number;
  /** Unread counts per inbox tab (total drives the Inbox parent badge). */
  inboxUnread?: { focused: number; other: number; total: number };
  /** Pending outbound-queue counts for the Drafts / Scheduled branches. */
  inboxQueue?: { drafts: number; scheduled: number };
  /** Count of Outbox items needing attention (ready-to-send + failed). */
  outboxAttention?: number;
  /** Count of pending received invitations. */
  invitationsCount?: number;
}

function InboxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function InsightsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <rect x="7" y="11" width="3" height="6" />
      <rect x="12" y="7" width="3" height="10" />
      <rect x="17" y="13" width="3" height="4" />
    </svg>
  );
}

function InvitationsIcon({ className }: { className?: string }) {
  // Person with a plus — an incoming connection request.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="16" y1="11" x2="22" y2="11" />
    </svg>
  );
}

function ConnectorIcon({ className }: { className?: string }) {
  // A plug / link — the connection between Claude (MCP) and inflow.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
  // Assistant / bot: a screen with an antenna and two eyes.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1.2" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
    </svg>
  );
}

function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}
function MailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 6L2 7" />
    </svg>
  );
}
/**
 * InMail: an envelope inside a circle. "Other" keeps the plain envelope, since
 * the two sat side by side sharing one icon and were indistinguishable.
 *
 * The enclosed envelope is drawn thinner than the ring (1.6 vs 2): at nav size
 * it has about 10px to live in, and matching the ring's weight closed up the
 * flap. Note Spam and Scheduled are circles too, so the three share a
 * silhouette — the envelope is what tells them apart, not the outline.
 */
function InMailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <g strokeWidth="1.6">
        <rect x="5.5" y="8" width="13" height="8.5" rx="1.5" />
        <path d="M5.5 9.3l6.5 4.2 6.5-4.2" />
      </g>
    </svg>
  );
}
function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </svg>
  );
}
function SpamIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
function DraftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

interface ItemDef {
  key: string;
  label: string;
  desc: string;
  Icon: (p: { className?: string }) => ReactNode;
  count?: number;
  /** Navigate to this section on click (mutually exclusive with `tab`). */
  section?: AppSection;
  /** If set, clicking selects the Inbox section and switches to this tab. */
  tab?: InboxTab;
  /** Nested sub-items shown as an indented branch when expanded. */
  children?: ItemDef[];
}

/** One nav row: icon + label + count, with a hover tooltip and optional trailing control. */
function NavItem({
  item,
  active,
  collapsed,
  small,
  trailing,
  onClick,
}: {
  item: ItemDef;
  active: boolean;
  collapsed: boolean;
  small?: boolean;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  const { label, desc, Icon, count } = item;
  return (
    <div className="group/nav relative">
      <div className="flex items-center">
        <button
          onClick={onClick}
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          className={`flex cursor-pointer items-center rounded-lg font-medium transition-colors ${small ? 'text-[13px]' : 'text-sm'} ${
            collapsed ? 'w-full justify-center px-0 py-2' : 'flex-1 gap-2.5 px-2.5 py-2'
          } ${
            active
              ? 'bg-blue-500/15 text-fg-strong ring-1 ring-inset ring-blue-500/30'
              : 'text-fg-muted hover:bg-surface-hover hover:text-fg-secondary'
          }`}
        >
          <span className="relative shrink-0">
            <Icon className={small ? 'h-4 w-4' : 'h-[18px] w-[18px]'} />
            {collapsed && count !== undefined && count > 0 && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-blue-400 ring-2 ring-surface-raised" />
            )}
          </span>
          {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
          {!collapsed && count !== undefined && count > 0 && (
            <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${active ? 'text-blue-300' : 'text-fg-faint'}`}>
              {count > 99 ? '99+' : count}
            </span>
          )}
        </button>
        {!collapsed && trailing}
      </div>

      <div
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 w-max max-w-[220px] -translate-y-1/2 rounded-lg bg-surface-raised px-3 py-2 opacity-0 shadow-lg ring-1 ring-inset ring-edge transition-opacity duration-100 group-hover/nav:opacity-100"
      >
        <p className="text-xs font-semibold text-fg-strong">{label}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-fg-muted">{desc}</p>
      </div>
    </div>
  );
}

export function NavRail({ connectionsCount, inboxUnread, inboxQueue, outboxAttention, invitationsCount }: NavRailProps) {
  const activeSection = useUIStore((s) => s.activeSection);
  const setActiveSection = useUIStore((s) => s.setActiveSection);
  const inboxTab = useUIStore((s) => s.inboxTab);
  const setInboxTab = useUIStore((s) => s.setInboxTab);
  const inboxLabels = useUIStore((s) => s.inboxLabels);
  const inboxSectionLabel = useUIStore((s) => s.inboxSectionLabel);
  const collapsed = useUIStore((s) => s.navRailCollapsed);
  const toggleNavRail = useUIStore((s) => s.toggleNavRail);
  const goBackSection = useUIStore((s) => s.goBackSection);
  const goForwardSection = useUIStore((s) => s.goForwardSection);
  const canGoBack = useUIStore((s) => s.sectionHistory.length > 0);
  const canGoForward = useUIStore((s) => s.sectionForward.length > 0);

  // Per-branch open/closed state, persisted (one key per expandable parent).
  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>(() => {
    const read = (key: string) => {
      try {
        return localStorage.getItem(key) !== '0';
      } catch {
        return true;
      }
    };
    return { inbox: read('inflow-inbox-branch'), connections: read('inflow-connections-branch') };
  });
  const toggleBranch = (key: string) =>
    setOpenBranches((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(`inflow-${key}-branch`, next[key] ? '1' : '0');
      } catch {}
      return next;
    });

  const items: ItemDef[] = [
    {
      key: 'inbox',
      section: 'inbox',
      label: inboxSectionLabel,
      desc: 'Read and reply to your LinkedIn messages.',
      Icon: InboxIcon,
      count: inboxUnread?.total,
      children: [
        { key: 'focused', tab: 'focused', label: tabLabel('focused', inboxLabels), desc: 'Your primary conversations.', Icon: StarIcon, count: inboxUnread?.focused },
        { key: 'other', tab: 'other', label: tabLabel('other', inboxLabels), desc: "LinkedIn's Other folder: requests and lower-priority threads.", Icon: MailIcon, count: inboxUnread?.other },
        // Deliberately not a folder: an InMail can sit in Primary or Other, so
        // this selects by message type instead of by LinkedIn category.
        { key: 'inmail', tab: 'inmail', label: tabLabel('inmail', inboxLabels), desc: 'Every InMail, whichever folder LinkedIn filed it in.', Icon: InMailIcon },
        { key: 'archived', tab: 'archived', label: tabLabel('archived', inboxLabels), desc: 'Conversations you have archived.', Icon: ArchiveIcon },
        { key: 'spam', tab: 'spam', label: tabLabel('spam', inboxLabels), desc: 'Flagged as spam.', Icon: SpamIcon },
        { key: 'drafts', tab: 'drafts', label: tabLabel('drafts', inboxLabels), desc: 'Unsent drafts — yours and any drafted by Claude.', Icon: DraftIcon, count: inboxQueue?.drafts },
        { key: 'scheduled', tab: 'scheduled', label: tabLabel('scheduled', inboxLabels), desc: 'Queued to send later — resurfaced for one-click send.', Icon: ClockIcon, count: inboxQueue?.scheduled },
      ],
    },
    {
      key: 'connections',
      section: 'connections',
      label: 'Connections',
      desc: 'Your connections, auto-categorized by role and interest.',
      Icon: PeopleIcon,
      count: connectionsCount,
      children: [
        { key: 'invitations', section: 'invitations', label: 'Invitations', desc: 'Pending connection requests — accept or ignore.', Icon: InvitationsIcon, count: invitationsCount },
      ],
    },
    { key: 'outbox', section: 'outbox', label: 'MCP connector', desc: 'Connect Claude (MCP) to source people and draft outreach — you always send.', Icon: ConnectorIcon, count: outboxAttention },
    { key: 'insights', section: 'insights', label: 'Insights', desc: 'Network composition, firm clusters, and AI suggestions.', Icon: InsightsIcon },
    { key: 'chat', section: 'chat', label: 'AI Chat', desc: 'Ask AI anything about your network.', Icon: ChatIcon },
  ];

  // Is this item the current view? Tab items match on Inbox + tab; section
  // items match on the active section.
  const isActive = (it: ItemDef) =>
    it.tab ? activeSection === 'inbox' && inboxTab === it.tab : activeSection === it.section;
  // Navigate to an item: a tab item switches Inbox tabs; a section item navigates.
  const openItem = (it: ItemDef) => {
    if (it.tab) {
      setActiveSection('inbox');
      setInboxTab(it.tab);
    } else if (it.section) {
      setActiveSection(it.section);
    }
  };

  return (
    <nav
      aria-label="Sections"
      data-nav-rail
      className="group relative flex h-full flex-col gap-1 border-r border-edge bg-surface-raised px-2 py-3"
    >
      {/* Brand + back/forward navigation */}
      <div className={`mb-2 flex items-center ${collapsed ? 'flex-col gap-1.5' : 'px-2'}`}>
        <Logo collapsed={collapsed} />
        <div className={`flex items-center gap-0.5 ${collapsed ? '' : 'ml-auto'}`}>
          <button
            onClick={goBackSection}
            disabled={!canGoBack}
            title="Back"
            aria-label="Back to previous section"
            className="rounded-md p-1 text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button
            onClick={goForwardSection}
            disabled={!canGoForward}
            title="Forward"
            aria-label="Forward to next section"
            className="rounded-md p-1 text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg-strong disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      </div>

      {/* Section items (Inbox and Connections each carry an expandable branch) */}
      {items.map((item) => {
        const hasChildren = !!item.children?.length;
        if (!hasChildren) {
          return (
            <NavItem
              key={item.key}
              item={item}
              active={isActive(item)}
              collapsed={collapsed}
              onClick={() => openItem(item)}
            />
          );
        }
        const branchOpen = openBranches[item.key];
        const anyChildActive = item.children!.some(isActive);
        // A parent with a branch: the row navigates; the chevron toggles the branch.
        const chevron = (
          <button
            onClick={() => toggleBranch(item.key)}
            aria-label={branchOpen ? `Collapse ${item.label}` : `Expand ${item.label}`}
            aria-expanded={branchOpen}
            className="ml-0.5 shrink-0 rounded-md p-1 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg-secondary"
          >
            <svg
              className={`h-3.5 w-3.5 transition-transform ${branchOpen ? 'rotate-90' : ''}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        );
        return (
          <div key={item.key}>
            <NavItem
              item={item}
              // Highlight the parent whenever its section is active — so "Inbox"
              // lights up alongside the active tab (its children share the same
              // section). Connections stays single-highlight because its child
              // (Invitations) is a *different* section. Collapsed, the branch is
              // hidden, so also light the parent when a child is the active view.
              active={isActive(item) || (collapsed && anyChildActive)}
              collapsed={collapsed}
              trailing={chevron}
              onClick={() => openItem(item)}
            />
            {/* Expanded branch: indented children with a connector line. */}
            {!collapsed && branchOpen && (
              <div className="ml-[19px] mt-0.5 flex flex-col gap-0.5 border-l border-edge pl-2">
                {item.children!.map((child) => (
                  <NavItem
                    key={child.key}
                    item={child}
                    active={isActive(child)}
                    collapsed={false}
                    small
                    onClick={() => openItem(child)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={() => useUIStore.getState().openSettings()}
        title={collapsed ? 'Settings' : undefined}
        aria-label="Settings"
        className={`flex cursor-pointer items-center rounded-lg py-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary ${
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'
        }`}
      >
        <svg
          className="h-[18px] w-[18px] shrink-0"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        {!collapsed && <span className="text-xs">Settings</span>}
      </button>

      {/* Collapse / expand — a pill "lid" straddling the rail's border, centered
          vertically. Faint by default, brighter on hover. */}
      <button
        onClick={toggleNavRail}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        className="absolute right-0 top-1/2 z-20 flex h-11 w-[18px] -translate-y-1/2 translate-x-1/2 cursor-pointer items-center justify-center rounded-full border border-edge bg-surface-raised text-fg-faint opacity-60 shadow-sm transition-all hover:w-5 hover:text-fg-secondary hover:opacity-100"
      >
        <svg
          className="h-4 w-4 shrink-0"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
        </svg>
      </button>
    </nav>
  );
}
