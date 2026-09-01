import { useEffect } from 'react';
import { FOCUSED_INBOX_KEY, getFocusedInboxEnabled } from '@/lib/focused-inbox';
import { sendBridgeMessage } from '@/lib/bridge';
import { useUIStore } from '@/store/ui-store';

/** Don't re-ask LinkedIn more than this often, however often focus bounces. */
const REFRESH_THROTTLE_MS = 60_000;
let lastRefreshAt = 0;

/**
 * Ask the background to re-read the preference from LinkedIn. There is no
 * push for it — the realtime stream carries no settings topic — so the moment
 * the user looks at inflow is the best cue we get that a change made in
 * another tab should be picked up.
 */
function requestRefresh(): void {
  const now = Date.now();
  if (now - lastRefreshAt < REFRESH_THROTTLE_MS) return;
  lastRefreshAt = now;
  // Wrapped rather than chained: this is a fire-and-forget nicety, and it must
  // not throw into a render when the bridge is stubbed or absent.
  try {
    void Promise.resolve(sendBridgeMessage({ type: 'REFRESH_MESSAGING_SETTINGS' })).catch(
      () => {}
    );
  } catch {}
}

/**
 * Whether this account uses LinkedIn's Focused/Other split. False means the
 * user turned it off, so inflow shows one inbox the way LinkedIn does.
 *
 * Starts true (the default and common case) and corrects itself once the
 * stored value loads; the background refreshes it from LinkedIn, and
 * storage.onChanged carries a mid-session change straight through.
 */
export function useFocusedInbox(): boolean {
  // Kept in the UI store, not local state: setInboxTab reads it to refuse a
  // tab that no longer exists, and that has to work from the keyboard handler
  // and command palette too, not just from components.
  const enabled = useUIStore((s) => s.focusedInboxEnabled);
  const setEnabled = useUIStore((s) => s.setFocusedInboxEnabled);

  useEffect(() => {
    let disposed = false;
    const load = () => {
      void getFocusedInboxEnabled().then((v) => {
        if (!disposed) setEnabled(v);
      });
    };
    load();
    requestRefresh();
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && FOCUSED_INBOX_KEY in changes) load();
    };
    chrome.storage.onChanged.addListener(listener);
    // Changing the setting on linkedin.com and coming back is the flow this
    // catches; the background's hourly poll is the backstop.
    const onFocus = () => requestRefresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(listener);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [setEnabled]);

  return enabled;
}
