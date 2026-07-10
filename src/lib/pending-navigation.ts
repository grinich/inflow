/**
 * Cross-context handoff for "open this conversation in the app tab".
 *
 * When a native OS notification is clicked, the background can't reach into the
 * app's in-memory store — and the app tab may not even exist yet. So the click
 * records the target here (chrome.storage.session, which both trusted contexts
 * share) and opens/focuses the tab. The app consumes it on load and also reacts
 * to live writes via chrome.storage.onChanged.
 */

export const PENDING_NAVIGATION_KEY = 'pendingNavigation';

export interface PendingNavigation {
  conversationId: string;
  /** Distinguishes repeat clicks on the same conversation so onChanged fires. */
  ts: number;
}

/** Record a request to open a specific conversation in the app tab. */
export async function setPendingNavigation(conversationId: string, ts: number): Promise<void> {
  const value: PendingNavigation = { conversationId, ts };
  await chrome.storage.session.set({ [PENDING_NAVIGATION_KEY]: value });
}

/** Clear the pending navigation so a reload can't replay it. */
export async function clearPendingNavigation(): Promise<void> {
  await chrome.storage.session.set({ [PENDING_NAVIGATION_KEY]: null });
}

/**
 * Read and clear the pending navigation. Returns null when nothing is pending.
 */
export async function consumePendingNavigation(): Promise<PendingNavigation | null> {
  const res = await chrome.storage.session.get(PENDING_NAVIGATION_KEY);
  const pending = res[PENDING_NAVIGATION_KEY] as PendingNavigation | null | undefined;
  if (!pending || !pending.conversationId) return null;
  await clearPendingNavigation();
  return pending;
}
