import { db } from '@/db/database';
import { useUIStore } from '@/store/ui-store';
import { belongsToTab } from '@/lib/inbox-filters';

/** The tabs in the order navigation should prefer them. */
const TABS = ['archived', 'spam', 'other', 'focused'] as const;

/**
 * Navigate the app to a conversation and open its thread.
 *
 * Switches to the inbox tab the conversation lives in FIRST so it's present in
 * the rendered (tab-filtered) list — otherwise App's auto-select effect can't
 * find it and lands on an unrelated fallback conversation. A search or filter
 * hides it just as effectively as the wrong tab, so that is cleared too: every
 * caller here is an external jump — a notification, a shell link, an accepted
 * invitation — and being taken to a thread you cannot see is the same bug.
 *
 * If the conversation isn't in the local DB yet (e.g. a brand-new thread still
 * syncing), we leave the current tab and let App reconcile once it appears.
 */
export async function navigateToConversation(conversationId: string): Promise<void> {
  if (!db) return;
  const conv = await db.conversations.get(conversationId);
  if (conv) {
    // Same rule the list itself uses, so the two can't disagree about where a
    // conversation lives. With LinkedIn's Focused/Other split off there is no
    // Other tab to send anyone to — those rows live in the combined inbox — so
    // it is dropped from the candidates rather than relying on setInboxTab to
    // bounce us back out of it.
    const combined = !useUIStore.getState().focusedInboxEnabled;
    const candidates = combined ? TABS.filter((t) => t !== 'other') : TABS;
    const tab = candidates.find((t) => belongsToTab(conv, t, combined)) ?? 'focused';
    useUIStore.getState().setInboxTab(tab);
  }
  // Don't let setInboxTab's remembered-selection restore hijack our target,
  // and don't leave a filter in place that would hide it.
  useUIStore.setState({ _pendingRestore: null, searchQuery: '' });
  // The index is reconciled by App's auto-select effect once the conv is listed.
  useUIStore.getState().openThread(conversationId, 0);
}
