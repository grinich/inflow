import { debugLog } from '@/lib/debug-log';
import { setPendingNavigation } from '@/lib/pending-navigation';
import { WEB_APP_URL, appTabUrlPatterns } from './app-urls';

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
 *
 * When `conversationId` is given (a native-notification click), the target is
 * recorded first so the app navigates to it — whether the tab already exists
 * (it reacts to the storage change) or is created fresh (it reads it on load).
 */
export async function openAppTab(
  { retryDelayMs = DEFAULT_RETRY_DELAY_MS, conversationId }:
    { retryDelayMs?: number; conversationId?: string } = {}
): Promise<void> {
  if (conversationId) {
    try {
      await setPendingNavigation(conversationId, Date.now());
    } catch (err) {
      debugLog('warn', `[TABS] failed to record pending navigation: ${err}`);
    }
  }

  // The canonical URL is the web shell; the raw extension page is the fallback
  // when the shell can't be reached (first open while offline — after one
  // online visit the shell's service worker serves it from cache).
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  const createUrl = online ? WEB_APP_URL : chrome.runtime.getURL('app.html');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const tabs = await chrome.tabs.query({ url: appTabUrlPatterns() });
      if (tabs.length > 0 && tabs[0].id != null) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId != null) {
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        await chrome.tabs.create({ url: createUrl });
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

/**
 * Reload every open web-shell tab (inflow.im/app). An extension update or
 * reload kills all chrome-extension:// frames, leaving shells with a dead
 * iframe — a reload makes them re-probe and embed the new version.
 * Never rejects.
 */
export async function reloadWebAppShellTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: WEB_APP_URL + '*' });
    await Promise.all(
      tabs.map((tab) =>
        tab.id != null ? chrome.tabs.reload(tab.id).catch(() => {}) : Promise.resolve()
      )
    );
  } catch (err) {
    debugLog('warn', `[TABS] failed to reload web shell tabs: ${err}`);
  }
}
