import { setupMessageRouter } from './messages';
import { setupPoller } from './sync/poller';
import { startRealtime } from './realtime/sse-client';
import { debugLog } from '@/lib/debug-log';
import { db } from '@/db/database';

/** Count unread non-draft focused-inbox conversations and update the toolbar badge. */
async function updateBadge() {
  try {
    const count = await db.conversations
      .where('read')
      .equals(0)
      .filter((c) => c.draft !== 1 && c.category === 'PRIMARY_INBOX')
      .count();
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
  } catch {
    // silently ignore — DB may not be ready yet
  }
}

export default defineBackground(() => {
  debugLog('info', 'Background service worker started');
  setupMessageRouter();
  setupPoller();
  startRealtime(); // non-blocking — handles its own errors and reconnection

  // Update badge on startup and periodically
  updateBadge();
  setInterval(updateBadge, 5_000);

  // Open the app tab (reused by icon click and dev reload)
  async function openAppTab() {
    const appUrl = chrome.runtime.getURL('app.html');
    const tabs = await chrome.tabs.query({ url: appUrl });
    if (tabs.length > 0 && tabs[0].id) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId!, { focused: true });
    } else {
      chrome.tabs.create({ url: appUrl });
    }
  }

  // Open the app tab when the toolbar icon is clicked (no popup)
  chrome.action.onClicked.addListener(openAppTab);

  // Re-open the app tab after extension reload in dev mode
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'update') {
      openAppTab();
    }
  });
});
