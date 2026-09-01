import { readLocal } from './storage';

/**
 * Whether this LinkedIn account uses the Focused/Other inbox split.
 *
 * Written by the background from LinkedIn's messaging settings, read by the
 * UI (and the agent tools) to decide whether to show one inbox or two.
 *
 * Defaults to TRUE — the split is LinkedIn's default and by far the common
 * case, and defaulting to it is the safe direction: showing an Other tab that
 * is redundant is a cosmetic problem, while hiding one that holds real
 * conversations loses messages from view.
 */
export const FOCUSED_INBOX_KEY = 'focusedInboxEnabled';

export async function getFocusedInboxEnabled(): Promise<boolean> {
  return (await readLocal<boolean>(FOCUSED_INBOX_KEY)) !== false;
}

export async function setFocusedInboxEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [FOCUSED_INBOX_KEY]: enabled });
}
