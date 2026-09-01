import { useEffect, useState } from 'react';
import { FOCUSED_INBOX_KEY, getFocusedInboxEnabled } from '@/lib/focused-inbox';

/**
 * Whether this account uses LinkedIn's Focused/Other split. False means the
 * user turned it off, so inflow shows one inbox the way LinkedIn does.
 *
 * Starts true (the default and common case) and corrects itself once the
 * stored value loads; the background refreshes it from LinkedIn, and
 * storage.onChanged carries a mid-session change straight through.
 */
export function useFocusedInbox(): boolean {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    let disposed = false;
    const load = () => {
      void getFocusedInboxEnabled().then((v) => {
        if (!disposed) setEnabled(v);
      });
    };
    load();
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === 'local' && FOCUSED_INBOX_KEY in changes) load();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      disposed = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  return enabled;
}
