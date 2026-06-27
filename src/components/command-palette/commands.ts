export interface Command {
  id: string;
  label: string;
  shortcut: string;
  action: () => void;
}

export function buildCommands(actions: {
  archiveSelected: () => void;
  moveToOtherSelected: () => void;
  moveToSpamSelected: () => void;
  markReadSelected: () => void;
  markUnreadSelected: () => void;
  openSelected: () => void;
  reply: () => void;
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
  goToArchived: () => void;
  goToSpam: () => void;
  undo: () => void;
  openAISetup: () => void;
  toggleDemoMode: () => void;
  isDemoActive: boolean;
  toggleAISuggestions: () => void;
  aiSuggestionsEnabled: boolean;
  reportBug: () => void;
  joinWhatsApp: () => void;
  checkForUpdate: () => void;
}): Command[] {
  return [
    { id: 'archive', label: 'Archive conversation', shortcut: 'E', action: actions.archiveSelected },
    { id: 'move-to-other', label: 'Move to Other', shortcut: 'O', action: actions.moveToOtherSelected },
    { id: 'move-to-spam', label: 'Mark as spam', shortcut: '!', action: actions.moveToSpamSelected },
    { id: 'mark-read', label: 'Mark as read', shortcut: '', action: actions.markReadSelected },
    { id: 'mark-unread', label: 'Mark as unread', shortcut: 'U', action: actions.markUnreadSelected },
    { id: 'open', label: 'Open conversation', shortcut: 'Enter', action: actions.openSelected },
    { id: 'reply', label: 'Reply', shortcut: 'R', action: actions.reply },
    { id: 'compose', label: 'Compose new message', shortcut: 'C', action: actions.compose },
    { id: 'undo', label: 'Undo last action', shortcut: 'Z', action: actions.undo },
    { id: 'back', label: 'Go back to inbox', shortcut: 'Esc', action: actions.goBack },
    { id: 'go-focused', label: 'Go to Focused inbox', shortcut: '1', action: actions.goToFocused },
    { id: 'go-other', label: 'Go to Other inbox', shortcut: '2', action: actions.goToOther },
    { id: 'go-archived', label: 'Go to Archived', shortcut: '3', action: actions.goToArchived },
    { id: 'go-spam', label: 'Go to Spam', shortcut: '4', action: actions.goToSpam },
    { id: 'shortcuts', label: 'Show keyboard shortcuts', shortcut: '?', action: actions.showShortcuts },
    { id: 'sync', label: 'Sync now', shortcut: '', action: actions.triggerSync },
    { id: 'check-update', label: 'Check for updates', shortcut: '', action: actions.checkForUpdate },
    ...(actions.currentTheme !== 'light' ? [{ id: 'theme-light', label: 'Switch to Light theme', shortcut: '', action: actions.setThemeLight }] : []),
    ...(actions.currentTheme !== 'dark' ? [{ id: 'theme-dark', label: 'Switch to Dark theme', shortcut: '', action: actions.setThemeDark }] : []),
    ...(actions.currentTheme !== 'system' ? [{ id: 'theme-system', label: 'Switch to System theme', shortcut: '', action: actions.setThemeSystem }] : []),
    { id: 'ai-setup', label: 'Set up AI features', shortcut: '', action: actions.openAISetup },
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
}
