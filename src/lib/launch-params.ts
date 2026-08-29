/**
 * One-shot launch parameters passed into the app frame by the web shell at
 * inflow.im/app (which forwards its own query string), e.g. the installed
 * app's dock-menu shortcut "Compose new message" → /app?compose=1, or a
 * clicked notification with no open window to focus → /app?c=<conversation>.
 */

/**
 * True when the app runs inside a frame (the inflow.im/app shell) rather
 * than as the top-level extension tab. Cross-origin `top` access throwing
 * is itself proof of being framed.
 */
export function isEmbeddedInShell(
  self: Window = window.self,
  top: Window | null = window.top
): boolean {
  try {
    return self !== top;
  } catch {
    return true;
  }
}

/**
 * True when the URL carries `?compose`. Consuming strips the param (frame-
 * local history.replaceState) so a reload doesn't re-open the composer.
 */
export function consumeComposeParam(): boolean {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('compose')) return false;
    url.searchParams.delete('compose');
    window.history.replaceState(null, '', url.toString());
    return true;
  } catch {
    return false;
  }
}

/**
 * The conversation this launch is for (`?c=<id>`) — set by the shell's
 * service worker when a notification was clicked with no app window open to
 * focus. Consuming strips the param so a reload doesn't re-navigate away
 * from wherever the user has since moved.
 *
 * A launch param rather than a postMessage on purpose: the app frame is
 * still booting when the window opens, so there is no listener to receive
 * one, but its own URL is readable the moment it mounts.
 */
export function consumeConversationParam(): string | null {
  try {
    const url = new URL(window.location.href);
    const conversationId = url.searchParams.get('c');
    if (!conversationId) return null;
    url.searchParams.delete('c');
    window.history.replaceState(null, '', url.toString());
    return conversationId;
  } catch {
    return null;
  }
}
