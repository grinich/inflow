// Shortcuts are registered with handlers in useKeyboard.ts
// This file defines the keybinding metadata for the overlay

export interface ShortcutDef {
  key: string;
  display: string;
  context: string;
  group: 'Navigation' | 'Actions' | 'Compose' | 'Global';
  description: string;
  meta?: boolean;
  shift?: boolean;
}

export const shortcutDefinitions: ShortcutDef[] = [
  // Navigation
  { key: 'j', display: 'J', context: 'List', group: 'Navigation', description: 'Move selection down' },
  { key: 'k', display: 'K', context: 'List', group: 'Navigation', description: 'Move selection up' },
  { key: 'Enter', display: '↵', context: 'List', group: 'Navigation', description: 'Open conversation' },
  { key: 'Escape', display: 'Esc', context: 'Thread / Compose', group: 'Navigation', description: 'Go back' },
  { key: '1', display: '1', context: 'Global', group: 'Navigation', description: 'Focused inbox' },
  { key: '2', display: '2', context: 'Global', group: 'Navigation', description: 'Other inbox' },
  { key: '3', display: '3', context: 'Global', group: 'Navigation', description: 'Archived' },
  { key: '4', display: '4', context: 'Global', group: 'Navigation', description: 'Spam' },
  { key: 'g', display: 'G S', context: 'Global', group: 'Navigation', description: 'Go to starred' },
  { key: 'g', display: 'G U', context: 'Global', group: 'Navigation', description: 'Go to unread' },

  // Actions
  { key: 'e', display: 'E', context: 'List / Thread', group: 'Actions', description: 'Archive / Move to Focused' },
  { key: 'o', display: 'O', context: 'List / Thread', group: 'Actions', description: 'Move to Other' },
  { key: 's', display: 'S', context: 'List / Thread', group: 'Actions', description: 'Star conversation' },
  { key: 'u', display: 'U', context: 'List', group: 'Actions', description: 'Toggle read/unread' },
  { key: 'u', display: '⇧U', context: 'Thread', group: 'Actions', description: 'Mark unread & go back', shift: true },
  { key: 'p', display: 'P', context: 'List / Thread', group: 'Actions', description: 'Open LinkedIn profile' },
  { key: 'd', display: 'D', context: 'List / Thread', group: 'Actions', description: 'Delete conversation' },
  { key: '!', display: '!', context: 'List / Thread', group: 'Actions', description: 'Mark as spam', shift: true },

  // Compose
  { key: 'r', display: 'R', context: 'Thread', group: 'Compose', description: 'Reply (focus compose)' },
  { key: 'Enter', display: '↵', context: 'Compose', group: 'Compose', description: 'Send message' },
  { key: 'Enter', display: '⌘↵', context: 'Compose', group: 'Compose', description: 'Send + Archive', meta: true },
  { key: 'Enter', display: '⇧↵', context: 'Compose', group: 'Compose', description: 'New line', shift: true },

  // Global
  { key: 'c', display: 'C', context: 'Global', group: 'Global', description: 'Compose new message' },
  { key: '/', display: '/', context: 'Global', group: 'Global', description: 'Search' },
  { key: 'k', display: '⌘K', context: 'Global', group: 'Global', description: 'Command palette', meta: true },
  { key: 'z', display: 'Z', context: 'Global', group: 'Global', description: 'Undo last action' },
  { key: '?', display: '?', context: 'Global', group: 'Global', description: 'Show all shortcuts', shift: true },
];
