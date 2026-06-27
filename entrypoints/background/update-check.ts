/**
 * Periodically checks GitHub Releases for a newer version and records the result
 * in chrome.storage.local. The UI (UpdateBanner) reads it and, if the latest
 * release is newer than the running build, prompts the user to update.
 *
 * inflow is loaded unpacked (not from the Web Store), so Chrome can't auto-update
 * it — this is a notify-to-update mechanism, not a binary updater.
 */

import { debugLog } from '@/lib/debug-log';
import { isNewerVersion, UPDATE_STORAGE_KEY, type UpdateStatus } from '@/lib/update';

const ALARM_NAME = 'inflow-update-check';
const CHECK_INTERVAL_MINUTES = 12 * 60; // twice a day
const RELEASES_API = 'https://api.github.com/repos/grinich/inflow/releases/latest';

/**
 * Fetch the latest release, cache it, and return the status (or null on
 * failure). Called on a schedule and on demand from the "Check for updates"
 * command.
 */
export async function checkForUpdate(): Promise<UpdateStatus | null> {
  // api.github.com is declared in host_permissions (wxt.config.ts) so the
  // service worker fetch is reliable (CORS-exempt) across Chrome versions.
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      debugLog('warn', `[UPDATE] Release check failed: HTTP ${res.status}`);
      return null;
    }
    const release = await res.json();
    // /releases/latest already excludes drafts and prereleases, but guard anyway.
    if (release.draft || release.prerelease) return null;

    const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
    if (!latestVersion) return null;

    const current = chrome.runtime.getManifest().version;
    const status: UpdateStatus = {
      latestVersion,
      releaseUrl: release.html_url || '',
      releaseNotes: release.body || '',
      publishedAt: release.published_at || '',
      checkedAt: Date.now(),
    };
    await chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: status });

    if (isNewerVersion(latestVersion, current)) {
      debugLog('info', `[UPDATE] New version available: v${latestVersion} (running v${current})`);
    } else {
      debugLog('info', `[UPDATE] Up to date (v${current})`);
    }
    return status;
  } catch (err) {
    // Offline or transient error — keep the last cached status, try again later.
    debugLog('warn', `[UPDATE] Release check error: ${err}`);
    return null;
  }
}

export function setupUpdateChecker(): void {
  // Check once on startup, then on a recurring alarm.
  checkForUpdate();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) checkForUpdate();
  });
}
