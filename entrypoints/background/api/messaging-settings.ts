import { voyagerFetch } from './client';
import { debugLog } from '@/lib/debug-log';

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
