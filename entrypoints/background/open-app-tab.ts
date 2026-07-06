import { debugLog } from '@/lib/debug-log';

/**
 * Chrome rejects tab mutations with this message while the user is dragging a
 * tab (the tab strip is locked). The lock clears as soon as the drag ends, so
 * these failures are retryable.
 */
const TAB_STRIP_LOCKED_RE = /cannot be edited/i;

const MAX_ATTEMPTS = 10;
const DEFAULT_RETRY_DELAY_MS = 200;

/**
 * Open (or focus) the inflow app tab. Never rejects: a toolbar/notification
 * click must not surface an uncaught promise rejection. While the tab strip is
 * locked by a tab drag, retries until the drag ends (bounded); other errors
 * are logged and swallowed.
 */
export async function openAppTab(
  { retryDelayMs = DEFAULT_RETRY_DELAY_MS }: { retryDelayMs?: number } = {}
): Promise<void> {
  const appUrl = chrome.runtime.getURL('app.html');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const tabs = await chrome.tabs.query({ url: appUrl });
      if (tabs.length > 0 && tabs[0].id != null) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId != null) {
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        await chrome.tabs.create({ url: appUrl });
      }
      return;
    } catch (err: any) {
      const message = String(err?.message ?? err);
      if (TAB_STRIP_LOCKED_RE.test(message) && attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }
      debugLog('warn', `[TABS] openAppTab failed (attempt ${attempt}): ${message}`);
      return;
    }
  }
}
