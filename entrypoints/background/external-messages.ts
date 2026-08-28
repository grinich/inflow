/**
 * Messaging surface for the web shell at inflow.im (allowed to connect via
 * `externally_connectable` in the manifest). The shell sends PING to discover
 * which extension ID is installed before embedding the app iframe, and holds
 * an `unread-count` port so it can mirror the toolbar badge onto the
 * installed-PWA dock icon and the tab title.
 *
 * Kept deliberately separate from the internal bridge (messages.ts): web pages
 * can only ever reach onMessageExternal/onConnectExternal, and these listeners
 * answer nothing but PING and unread counts — the internal RPC surface is not
 * exposed here.
 */

import { countUnreadFocused } from '@/lib/inbox-filters';
import { db } from '@/db/database';

const ALLOWED_ORIGIN = 'https://inflow.im';

export function setupExternalMessageRouter(): void {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    // Belt and braces on top of the manifest's externally_connectable match.
    if (sender.origin !== ALLOWED_ORIGIN) return;
    if (message?.type === 'PING') {
      sendResponse({
        ok: true,
        id: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
      });
    }
    // Synchronous-only surface: never return true (no held-open channels).
  });
}

const UNREAD_PORT_NAME = 'unread-count';

const unreadPorts = new Set<chrome.runtime.Port>();

/**
 * Accept long-lived ports from the shell. Only the `unread-count` port from
 * inflow.im is allowed; anything else is disconnected immediately. A fresh
 * port gets the current count right away, then updates ride the same 5s
 * badge cadence as the toolbar (see updateBadge in index.ts).
 */
export function setupExternalPortRouter(): void {
  chrome.runtime.onConnectExternal.addListener((port) => {
    if (port.sender?.origin !== ALLOWED_ORIGIN || port.name !== UNREAD_PORT_NAME) {
      port.disconnect();
      return;
    }
    unreadPorts.add(port);
    port.onDisconnect.addListener(() => unreadPorts.delete(port));

    countUnreadFocused(db)
      .then((count) => postUnreadCount(port, count))
      .catch(() => {}); // DB may not be ready yet — the next broadcast catches up
  });
}

/** Push the unread count to every connected shell. Never throws. */
export function broadcastUnreadCount(count: number): void {
  for (const port of unreadPorts) {
    postUnreadCount(port, count);
  }
}

function postUnreadCount(port: chrome.runtime.Port, count: number): void {
  try {
    port.postMessage({ type: 'UNREAD_COUNT', count });
  } catch {
    unreadPorts.delete(port); // port died without firing onDisconnect
  }
}
