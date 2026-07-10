import { useEffect } from 'react';
import { navigateToConversation } from '@/lib/navigate-to-conversation';
import {
  consumePendingNavigation,
  clearPendingNavigation,
  PENDING_NAVIGATION_KEY,
  type PendingNavigation as PendingNavigationTarget,
} from '@/lib/pending-navigation';

/**
 * Bridges native-notification clicks to in-app navigation. Renders nothing.
 *
 * Mounted inside AuthGate, so `db` is ready by the time it runs:
 * - On mount: consume any target left by a click that opened this tab.
 * - While open: react to live writes (a click when the tab already exists).
 */
export function PendingNavigation() {
  useEffect(() => {
    consumePendingNavigation()
      .then((pending) => {
        if (pending) navigateToConversation(pending.conversationId);
      })
      .catch(() => {});

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string
    ) => {
      if (area !== 'session') return;
      const change = changes[PENDING_NAVIGATION_KEY];
      if (!change) return;
      const next = change.newValue as PendingNavigationTarget | null | undefined;
      if (!next || !next.conversationId) return;
      // Consume so a reload can't replay it.
      clearPendingNavigation().catch(() => {});
      navigateToConversation(next.conversationId);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  return null;
}
