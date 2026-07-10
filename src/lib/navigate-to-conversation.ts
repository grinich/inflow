import { db } from '@/db/database';
import { useUIStore } from '@/store/ui-store';

/**
 * Navigate the app to a conversation and open its thread.
 *
 * Switches to the inbox tab the conversation lives in FIRST so it's present in
 * the rendered (tab-filtered) list — otherwise App's auto-select effect can't
 * find it and lands on an unrelated fallback conversation. If the conversation
 * isn't in the local DB yet (e.g. a brand-new thread still syncing), we leave
 * the current tab and let App reconcile once it appears.
 */
export async function navigateToConversation(conversationId: string): Promise<void> {
  if (!db) return;
  const conv = await db.conversations.get(conversationId);
  if (conv) {
    const tab = conv.archived === 1 ? 'archived'
      : conv.category === 'SPAM' ? 'spam'
      : conv.category === 'SECONDARY_INBOX' ? 'other'
      : 'focused';
    useUIStore.getState().setInboxTab(tab);
  }
  // Don't let setInboxTab's remembered-selection restore hijack our target.
  useUIStore.setState({ _pendingRestore: null });
  // The index is reconciled by App's auto-select effect once the conv is listed.
  useUIStore.getState().openThread(conversationId, 0);
}
