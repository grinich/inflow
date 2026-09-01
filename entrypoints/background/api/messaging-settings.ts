import { voyagerFetch } from './client';
import { debugLog } from '@/lib/debug-log';
import { setFocusedInboxEnabled } from '@/lib/focused-inbox';

/**
 * LinkedIn's own messaging preferences. inflow reads exactly one of them:
 * whether the account uses the Focused/Other split.
 *
 * Turning Focused inbox off in LinkedIn's settings does NOT stop the server
 * categorising conversations — a PRIMARY_INBOX / SECONDARY_INBOX query still
 * returns rows either way, so sync keeps working untouched. What changes is
 * the presentation: LinkedIn shows one list, and inflow must too, or the user
 * sees their inbox split across two tabs they deliberately turned off (and
 * quietly misses whatever landed in Other).
 */
export async function fetchFocusedInboxEnabled(): Promise<boolean | null> {
  try {
    const res = await voyagerFetch('/voyagerMessagingDashMessagingSettings');
    if (!res.ok) return null;
    const data = await res.json();
    const enabled = data?.data?.focusedInboxEnabled;
    return typeof enabled === 'boolean' ? enabled : null;
  } catch (e) {
    debugLog('warn', `[SETTINGS] focused-inbox read failed: ${e}`);
    return null;
  }
}

/**
 * Mirror the preference into local storage for the UI. Best-effort: an
 * unreadable setting keeps whatever was stored, so a network blip can't
 * collapse or split the inbox behind the user's back.
 *
 * There is no push for this. LinkedIn's realtime stream subscribes to
 * conversations, messages, seen receipts, invitations, badges and alerts —
 * verified by reading its ClientConnection topic list, and by toggling the
 * setting twice with the stream open and seeing nothing but heartbeats. So
 * this is polled: on startup, hourly, and whenever the app is looked at.
 */
export function refreshFocusedInboxSetting(): void {
  void fetchFocusedInboxEnabled()
    .then((enabled) => {
      if (enabled !== null) return setFocusedInboxEnabled(enabled);
    })
    .catch(() => {});
}
