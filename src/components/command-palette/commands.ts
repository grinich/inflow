export interface Command {
  id: string;
  label: string;
  shortcut: string;
  action: () => void;
}

/**
 * Commands that read or mutate the selected inbox conversation. The palette is
 * reachable from the Network view, where there is no visible conversation —
 * running these there would silently act on an offscreen inbox row.
 */
const INBOX_ONLY = new Set([
  'archive',
  'move-to-other',
  'move-to-spam',
  'mark-read',
  'mark-unread',
  'open',
  'reply',
]);

export function buildCommands(actions: {
  archiveSelected: () => void;
  /** True in the Archived tab, where `archiveSelected` restores to Focused. */
  selectedInArchive: boolean;
  moveToOtherOrFocusedSelected: () => void;
  selectedInOther: boolean;
  /** False hides the `O` slot — the move is invisible with one combined inbox. */
  otherSlotShown?: boolean;
  /** Overrides the slot's label, so it can read "Move to Inbox". */
  otherSlotLabel?: string;
  moveToSpamSelected: () => void;
  markReadSelected: () => void;
  markUnreadSelected: () => void;
  openSelected: () => void;
  reply: () => void;
  discardDraft: () => void;
  /** True when the open thread's composer holds unsent text or attachments. */
  hasDraft: boolean;
  compose: () => void;
  goBack: () => void;
  showShortcuts: () => void;
  triggerSync: () => void;
  setThemeLight: () => void;
  setThemeDark: () => void;
  setThemeSystem: () => void;
  currentTheme: 'light' | 'dark' | 'system';
  goToFocused: () => void;
  goToOther: () => void;
  /**
   * False when LinkedIn's Focused/Other split is off — there is no Other tab.
   * Optional, and only an explicit false hides the entry: an omitted or
   * not-yet-loaded value must leave the inbox looking normal.
   */
  focusedInboxEnabled?: boolean;
  goToArchived: () => void;
  goToSpam: () => void;
  goToNetwork: () => void;
  undo: () => void;
  openAISetup: () => void;
  openAgentAccess: () => void;
  toggleDemoMode: () => void;
  isDemoActive: boolean;
  toggleAISuggestions: () => void;
  aiSuggestionsEnabled: boolean;
  reportBug: () => void;
  joinWhatsApp: () => void;
  checkForUpdate: () => void;
  /** Active route — inbox-only commands are dropped while Network is up. */
  appView: 'inbox' | 'network';
}): Command[] {
  const all: Command[] = [
    {
      id: 'archive',
      // In the Archived tab this slot un-archives, so it has to say so. It read
      // "Archive conversation" there — describing the opposite of what it did,
      // and leaving nothing for a search on "focused" to match.
      label: actions.selectedInArchive ? 'Move to Focused' : 'Archive conversation',
      shortcut: 'E',
      action: actions.archiveSelected,
    },
    // Hidden when the Focused/Other split is off and the move would be
    // invisible; see otherSlotApplies. Archive and Spam still offer it, and
    // those are decided by the caller via otherSlotShown.
    ...(actions.otherSlotShown === false
      ? []
      : [{
          id: 'move-to-other',
          label: actions.otherSlotLabel ?? (actions.selectedInOther ? 'Move to Focused' : 'Move to Other'),
          shortcut: 'O',
          action: actions.moveToOtherOrFocusedSelected,
        }]),
    { id: 'move-to-spam', label: 'Mark as spam', shortcut: '!', action: actions.moveToSpamSelected },
    { id: 'mark-read', label: 'Mark as read', shortcut: '', action: actions.markReadSelected },
    { id: 'mark-unread', label: 'Mark as unread', shortcut: 'U', action: actions.markUnreadSelected },
    { id: 'open', label: 'Open conversation', shortcut: 'Enter', action: actions.openSelected },
    { id: 'reply', label: 'Reply', shortcut: 'R', action: actions.reply },
    // Only offered while there is actually a draft to discard — an always-on
    // entry that silently no-ops would read as broken.
    ...(actions.hasDraft
      ? [{ id: 'discard-draft', label: 'Discard draft', shortcut: '', action: actions.discardDraft }]
      : []),
    { id: 'compose', label: 'Compose new message', shortcut: 'C', action: actions.compose },
    { id: 'undo', label: 'Undo last action', shortcut: 'Z', action: actions.undo },
    { id: 'back', label: 'Go back to inbox', shortcut: 'Esc', action: actions.goBack },
    {
      id: 'go-focused',
      label: actions.focusedInboxEnabled === false ? 'Go to Inbox' : 'Go to Focused inbox',
      shortcut: '1',
      action: actions.goToFocused,
    },
    ...(actions.focusedInboxEnabled !== false
      ? [{ id: 'go-other', label: 'Go to Other inbox', shortcut: '2', action: actions.goToOther }]
      : []),
    { id: 'go-archived', label: 'Go to Archived', shortcut: '3', action: actions.goToArchived },
    { id: 'go-spam', label: 'Go to Spam', shortcut: '4', action: actions.goToSpam },
    { id: 'go-network', label: 'Go to Network (invitations & connections)', shortcut: 'G N', action: actions.goToNetwork },
    { id: 'shortcuts', label: 'Show keyboard shortcuts', shortcut: '?', action: actions.showShortcuts },
    { id: 'sync', label: 'Sync now', shortcut: '', action: actions.triggerSync },
    { id: 'check-update', label: 'Check for updates', shortcut: '', action: actions.checkForUpdate },
    ...(actions.currentTheme !== 'light' ? [{ id: 'theme-light', label: 'Switch to Light theme', shortcut: '', action: actions.setThemeLight }] : []),
    ...(actions.currentTheme !== 'dark' ? [{ id: 'theme-dark', label: 'Switch to Dark theme', shortcut: '', action: actions.setThemeDark }] : []),
    ...(actions.currentTheme !== 'system' ? [{ id: 'theme-system', label: 'Switch to System theme', shortcut: '', action: actions.setThemeSystem }] : []),
    { id: 'ai-setup', label: 'Set up AI features', shortcut: '', action: actions.openAISetup },
    { id: 'agent-access', label: 'Configure agent access (AI tools)', shortcut: '', action: actions.openAgentAccess },
    {
      id: 'ai-suggestions',
      label: actions.aiSuggestionsEnabled ? 'Disable AI reply suggestions' : 'Enable AI reply suggestions',
      shortcut: '',
      action: actions.toggleAISuggestions,
    },
    { id: 'report-bug', label: 'Report a bug', shortcut: '', action: actions.reportBug },
    { id: 'join-whatsapp', label: 'Join WhatsApp Group', shortcut: '', action: actions.joinWhatsApp },
    {
      id: 'demo-mode',
      label: actions.isDemoActive ? 'Exit demo mode' : 'Enter demo mode',
      shortcut: '',
      action: actions.toggleDemoMode,
    },
  ];

  if (actions.appView !== 'network') return all;
  // Already on Network, so its own entry is a no-op too.
  return all.filter((c) => !INBOX_ONLY.has(c.id) && c.id !== 'go-network');
}
