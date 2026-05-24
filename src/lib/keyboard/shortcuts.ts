import type { Shortcut } from './KeyboardManager';

// Shortcuts are registered with handlers in useKeyboard.ts
// This file defines the keybinding metadata for the overlay

export interface ShortcutDef {
  key: string;
  display: string;
  context: string;
  description: string;
  meta?: boolean;
  shift?: boolean;
}

export const shortcutDefinitions: ShortcutDef[] = [
  { key: 'j', display: 'J', context: 'List', description: 'Move selection down' },
  { key: 'k', display: 'K', context: 'List', description: 'Move selection up' },
  { key: 'Enter', display: '↵', context: 'List', description: 'Open conversation' },
  { key: 'e', display: 'E', context: 'List / Thread', description: 'Archive conversation' },
  { key: 'o', display: 'O', context: 'List / Thread', description: 'Move to Other' },
  { key: 's', display: 'S', context: 'List / Thread', description: 'Star conversation' },
  { key: 'd', display: 'D', context: 'List / Thread', description: 'Delete conversation' },
  { key: '!', display: '!', context: 'List / Thread', description: 'Mark as spam', shift: true },
  { key: 'Escape', display: 'Esc', context: 'Thread / Compose', description: 'Go back' },
  { key: 'r', display: 'R', context: 'Thread', description: 'Reply (focus compose)' },
  { key: 'Enter', display: '⌘↵', context: 'Compose', description: 'Send message', meta: true },
  { key: 'u', display: '⇧U', context: 'Thread', description: 'Mark unread & go back', shift: true },
  { key: 'u', display: 'U', context: 'List', description: 'Toggle read/unread' },
  { key: 'c', display: 'C', context: 'Global', description: 'Compose new message' },
  { key: 'z', display: 'Z', context: 'Global', description: 'Undo last action' },
  { key: 'k', display: '⌘K', context: 'Global', description: 'Command palette', meta: true },
  { key: '/', display: '/', context: 'Global', description: 'Search' },
  { key: '?', display: '?', context: 'Global', description: 'Show all shortcuts', shift: true },
  { key: '1', display: '1', context: 'Global', description: 'Focused inbox' },
  { key: '2', display: '2', context: 'Global', description: 'Other inbox' },
  { key: '3', display: '3', context: 'Global', description: 'Archived' },
  { key: '4', display: '4', context: 'Global', description: 'Spam' },
];
