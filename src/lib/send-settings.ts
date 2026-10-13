import { readLocal } from './storage';

const CONFIRM_RECIPIENT_KEY = 'confirmRecipient';
const AUTO_SEND_KEY = 'autoSendScheduled';
const CONFIRM_DELETE_KEY = 'confirmDeleteDraft';

/**
 * Settings that govern outbound messages. They live in chrome.storage rather
 * than localStorage because three contexts need them: the Outbox UI, the MCP
 * tools, and the background worker that sends on a schedule — and a service
 * worker has no localStorage.
 */

/**
 * Require a human to open the recipient's profile before an InMail Claude
 * drafted can send. Defaults ON: Claude resolves a name to a URN out of the
 * user's sight, and a name search can return several different real people.
 */
export async function getConfirmRecipient(): Promise<boolean> {
  return (await readLocal<boolean>(CONFIRM_RECIPIENT_KEY)) !== false;
}

export async function setConfirmRecipient(on: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [CONFIRM_RECIPIENT_KEY]: on });
  } catch {
    // Storage unavailable (private mode, test env): the default stands.
  }
}

/**
 * Send scheduled messages at their time with no click. Defaults ON: picking a
 * send time and then still having to click at that time defeats the point of
 * scheduling. Turning it off keeps a scheduled message surfaced as "Ready to
 * send" instead.
 *
 * Narrower than it sounds — it only ever sends what the user explicitly
 * scheduled, and never a draft still awaiting a recipient confirmation.
 */
export async function getAutoSendScheduled(): Promise<boolean> {
  return (await readLocal<boolean>(AUTO_SEND_KEY)) !== false;
}

export async function setAutoSendScheduled(on: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [AUTO_SEND_KEY]: on });
  } catch {
    // Storage unavailable: the default stands.
  }
}

/**
 * Ask before discarding a draft from the Outbox. Defaults ON: a draft is
 * unsent work with no undo, and Delete sits next to Send.
 */
export async function getConfirmDelete(): Promise<boolean> {
  return (await readLocal<boolean>(CONFIRM_DELETE_KEY)) !== false;
}

export async function setConfirmDelete(on: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [CONFIRM_DELETE_KEY]: on });
  } catch {
    // Storage unavailable: the default stands, which is to ask.
  }
}
