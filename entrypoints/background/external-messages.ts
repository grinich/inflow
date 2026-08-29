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

/** Connected shells, with whether each may show origin notifications. */
const shellPorts = new Map<chrome.runtime.Port, { canNotify: boolean }>();

/**
 * Accept long-lived ports from the shell. Only the `unread-count` port from
 * inflow.im is allowed; anything else is disconnected immediately. A fresh
 * port gets the current count right away, then updates ride the same 5s
 * badge cadence as the toolbar (see updateBadge in index.ts). The shell
 * reports its Notification permission over the port (HELLO / CAN_NOTIFY),
 * which gates notifyViaShell below.
 */
export function setupExternalPortRouter(): void {
  chrome.runtime.onConnectExternal.addListener((port) => {
    if (port.sender?.origin !== ALLOWED_ORIGIN || port.name !== UNREAD_PORT_NAME) {
      port.disconnect();
      return;
    }
    shellPorts.set(port, { canNotify: false });
    port.onDisconnect.addListener(() => shellPorts.delete(port));
    port.onMessage.addListener((message: any) => {
      const meta = shellPorts.get(port);
      if (!meta) return;
      if (message?.type === 'HELLO' || message?.type === 'CAN_NOTIFY') {
        meta.canNotify = message.canNotify === true;
      }
    });

    countUnreadFocused(db)
      .then((count) => postToShell(port, { type: 'UNREAD_COUNT', count }))
      .catch(() => {}); // DB may not be ready yet — the next broadcast catches up
  });
}

/** Push the unread count to every connected shell. Never throws. */
export function broadcastUnreadCount(count: number): void {
  for (const port of shellPorts.keys()) {
    postToShell(port, { type: 'UNREAD_COUNT', count });
  }
}

export interface ShellNotification {
  conversationId: string;
  title: string;
  body: string;
  icon: string;
}

/**
 * Route a message notification through connected shells that hold
 * Notification permission. Notifications posted from the inflow.im origin
 * are attributed to the installed inƒlow app (its name and icon) instead of
 * to Chrome, the way extension notifications are. Returns false when no
 * shell can show it — the caller falls back to chrome.notifications.
 */
export function notifyViaShell(notification: ShellNotification): boolean {
  let shown = false;
  for (const [port, meta] of shellPorts) {
    if (!meta.canNotify) continue;
    if (postToShell(port, { type: 'SHOW_NOTIFICATION', ...notification })) {
      shown = true;
    }
  }
  return shown;
}

function postToShell(port: chrome.runtime.Port, message: unknown): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    shellPorts.delete(port); // port died without firing onDisconnect
    return false;
  }
}
