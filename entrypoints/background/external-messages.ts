/**
 * Messaging surface for the web shell at inflow.im (allowed to connect via
 * `externally_connectable` in the manifest). The shell sends PING to discover
 * which extension ID is installed before embedding the app iframe.
 *
 * Kept deliberately separate from the internal bridge (messages.ts): web pages
 * can only ever reach onMessageExternal, and this listener answers nothing but
 * PING — the internal RPC surface is not exposed here.
 */

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
