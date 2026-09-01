import { setupMessageRouter } from './messages';
import { setupPoller } from './sync/poller';
import { startRealtime, stopRealtime } from './realtime/sse-client';
import { drainActionQueue } from './action-queue';
import { debugLog } from '@/lib/debug-log';
import { db, switchDatabase, memberIdFromUrn } from '@/db/database';
import { getSession, invalidateSessionCache, clearCachedMemberUrn } from './auth/session';
import { invalidateCookieRule } from './api/client';
import { clearSuppression } from './realtime/mark-read-suppression';
import { clearSendQueue } from './send-queue';
import { countUnreadFocused } from '@/lib/inbox-filters';
import { openAppTab, reloadWebAppShellTabs } from './open-app-tab';
import { setupExternalMessageRouter, setupExternalPortRouter, broadcastUnreadCount } from './external-messages';
import { setupAgentBridge } from './agent-bridge';
import { setupUpdateChecker } from './update-check';
import { refreshFocusedInboxSetting } from './api/messaging-settings';
import { getFocusedInboxEnabled } from '@/lib/focused-inbox';

/** Count unread Focused-tab conversations and update the toolbar badge.
 *  Uses the same predicate as the Focused list (isFocusedConversation) so the
 *  badge can never disagree with what the list shows. */
async function updateBadge() {
  try {
    const count = await countUnreadFocused(db, !(await getFocusedInboxEnabled()));
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#2563EB' });
    // Mirror the same count to connected web shells (dock badge + tab title).
    broadcastUnreadCount(count);
  } catch {
    // silently ignore — DB may not be ready yet
  }
}

import { markDbReady } from './db-ready';

export default defineBackground(() => {
  debugLog('info', 'Background service worker started');
  setupMessageRouter();
  setupExternalMessageRouter();
  setupExternalPortRouter();
  setupAgentBridge();

  // Check GitHub Releases for a newer version (independent of account/DB state).
  setupUpdateChecker();

  // Fetch session first to point DB at the correct account, then start sync
  (async () => {
    try {
      const session = await getSession();
      if (session.authenticated && session.memberUrn) {
        const memberId = memberIdFromUrn(session.memberUrn);
        if (memberId) {
          await switchDatabase(memberId);
          debugLog('info', `DB initialized for account ${memberId}`);
        }
      }
    } catch (err) {
      debugLog('error', `Failed to init account DB on startup: ${err}`);
    }

    markDbReady();

    // Start sync subsystems after DB is pointed at the right account
    setupPoller();
    startRealtime();
    refreshFocusedInboxSetting();

    // Drain any actions queued while offline
    drainActionQueue().catch((err) => {
      debugLog('error', `[STARTUP] Failed to drain action queue: ${err}`);
    });
  })();

  // Update badge on startup and periodically
  updateBadge();
  setInterval(updateBadge, 5_000);

  // Re-read LinkedIn's Focused-inbox preference hourly, so turning the split
  // on or off over there reaches the UI without a reinstall. One small
  // request; failures leave the last known value in place.
  setInterval(refreshFocusedInboxSetting, 60 * 60 * 1000);

  // -----------------------------------------------------------------------
  // Proactive account-switch detection via cookie monitoring
  // -----------------------------------------------------------------------
  let cookieChangeDebounce: ReturnType<typeof setTimeout> | null = null;

  chrome.cookies.onChanged.addListener((changeInfo) => {
    // Only care about the li_at auth cookie on linkedin.com
    if (changeInfo.cookie.name !== 'li_at') return;
    if (!changeInfo.cookie.domain.includes('linkedin.com')) return;

    debugLog('info', `[COOKIE] li_at cookie ${changeInfo.removed ? 'removed' : 'changed'} (cause: ${changeInfo.cause})`);

    // Debounce — login/logout can fire multiple cookie events in quick succession
    if (cookieChangeDebounce) clearTimeout(cookieChangeDebounce);
    cookieChangeDebounce = setTimeout(() => {
      cookieChangeDebounce = null;
      handleCookieChange();
    }, 500);
  });

  async function handleCookieChange() {
    // 1. Invalidate all caches so nothing uses stale identity
    invalidateSessionCache();
    clearCachedMemberUrn();
    invalidateCookieRule();
    clearSuppression();
    clearSendQueue();

    // 2. Re-fetch identity from /me
    try {
      const session = await getSession();
      if (session.authenticated && session.memberUrn) {
        const memberId = memberIdFromUrn(session.memberUrn);
        if (memberId) {
          await switchDatabase(memberId);
          debugLog('info', `[COOKIE] Switched DB to account ${memberId}`);
        }
      }
    } catch (err) {
      debugLog('error', `[COOKIE] Failed to re-check session: ${err}`);
    }

    // 3. Restart SSE so it connects with the new account's cookies
    stopRealtime();
    startRealtime();

    // 4. Notify UI tabs to reload
    chrome.runtime.sendMessage({ type: 'ACCOUNT_CHANGED' }).catch(() => {});
  }

  // Open the app tab when the toolbar icon is clicked (no popup)
  chrome.action.onClicked.addListener(() => openAppTab());

  // Open/focus the app tab when a native notification is clicked, and jump to
  // the conversation it was for. The notification ID is the conversation ID
  // (see showNativeNotification in the realtime event handler).
  chrome.notifications.onClicked.addListener((notificationId) => {
    chrome.notifications.clear(notificationId);
    openAppTab({ conversationId: notificationId });
  });

  // Fresh install: hand off straight to the inbox (the AuthGate walks a
  // signed-out user through connecting LinkedIn).
  // After an extension update/reload: web-shell tabs (inflow.im/app) are left
  // holding a dead chrome-extension:// iframe — reload them so they re-embed
  // the new version, then open/focus the app tab as before.
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      openAppTab();
    } else if (details.reason === 'update') {
      reloadWebAppShellTabs().finally(() => openAppTab());
    }
  });
});
