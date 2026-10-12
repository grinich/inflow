import type { InboxTab } from '@/store/ui-store';

/**
 * User-facing names for the two LinkedIn inbox buckets. These are the only tab
 * labels the user can rename (the rest are fixed). The defaults match
 * LinkedIn's own folder names, Primary and Other.
 *
 * "Other" used to default to "InMail", which was wrong: this tab filters on the
 * SECONDARY_INBOX folder, whereas an InMail is a kind of message and lands in
 * either folder. The separate InMail tab is what actually selects them.
 */
export interface InboxLabels {
  /** PRIMARY_INBOX — your main conversations. */
  focused: string;
  /** SECONDARY_INBOX — LinkedIn's "Other": requests and lower-priority threads. */
  other: string;
}

export const DEFAULT_INBOX_LABELS: InboxLabels = {
  focused: 'Primary',
  other: 'Other',
};

/** Default name for the Inbox nav section itself (renamable, e.g. "Messages"). */
export const DEFAULT_INBOX_SECTION_LABEL = 'Inbox';

/** Coerce a stored/blank section label into a usable, trimmed value. */
export function normalizeSectionLabel(raw: string | null | undefined): string {
  return (raw ?? '').trim() || DEFAULT_INBOX_SECTION_LABEL;
}

/** Fixed labels for the tabs the user can't rename. */
const FIXED_TAB_LABELS: Record<Exclude<InboxTab, 'focused' | 'other'>, string> = {
  inmail: 'InMail',
  archived: 'Archive',
  spam: 'Spam',
  drafts: 'Drafts',
  scheduled: 'Scheduled',
};

/** Resolve the display label for any inbox tab, applying the user's overrides. */
export function tabLabel(tab: InboxTab, labels: InboxLabels): string {
  if (tab === 'focused') return labels.focused.trim() || DEFAULT_INBOX_LABELS.focused;
  if (tab === 'other') return labels.other.trim() || DEFAULT_INBOX_LABELS.other;
  return FIXED_TAB_LABELS[tab];
}

/** Coerce partial/stored data into a complete, non-empty label set. */
export function normalizeInboxLabels(raw: Partial<InboxLabels> | null | undefined): InboxLabels {
  return {
    focused: (raw?.focused ?? '').trim() || DEFAULT_INBOX_LABELS.focused,
    other: (raw?.other ?? '').trim() || DEFAULT_INBOX_LABELS.other,
  };
}
