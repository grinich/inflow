import type { Conversation } from '@/types/conversation';
import type { InboxTab } from '@/store/ui-store';

export type MoveTarget = 'focused' | 'other';

/**
 * Where the `O` slot sends a conversation.
 *
 * Outside Archive the slot toggles: one already sitting in Other goes back to
 * Focused, anything else goes to Other.
 *
 * Inside Archive that toggle is meaningless — the conversation is in Archive,
 * not in Other — and it made `O` duplicate `E`, which already restores to
 * Focused. Every surface then rendered two identical "Move to Focused" entries
 * for a conversation archived out of Other, and `O` did nothing `E` didn't.
 * In Archive the slot restores to Other instead, so `E` and `O` are the two
 * complementary ways back out.
 *
 * Shared by the command palette, the thread-list context menu, the thread
 * header dropdown, and the `o` shortcut, so the label a surface shows and the
 * move it performs can never drift apart.
 */
export function otherSlotTarget(
  conversation: Pick<Conversation, 'category'>,
  inboxTab: InboxTab
): MoveTarget {
  if (inboxTab === 'archived') return 'other';
  return conversation.category === 'SECONDARY_INBOX' ? 'focused' : 'other';
}

export function moveTargetLabel(target: MoveTarget, combineInbox = false): string {
  // With LinkedIn's Focused/Other split off there is one inbox, so naming
  // either half would describe a place the user cannot see.
  if (combineInbox) return 'Move to Inbox';
  return target === 'focused' ? 'Move to Focused' : 'Move to Other';
}

/**
 * Whether the `O` slot has anything to offer.
 *
 * With the split off, shuffling a conversation between Focused and Other is a
 * move between two halves of one list — invisible, so the surfaces hide it.
 * It still earns its place in two tabs: Archive (where it is one of the two
 * ways back out, alongside `E`) and Spam (where it is "not spam").
 */
export function otherSlotApplies(
  conversation: Pick<Conversation, 'category'>,
  inboxTab: InboxTab,
  combineInbox = false
): boolean {
  if (!combineInbox) return true;
  return inboxTab === 'archived' || conversation.category === 'SPAM';
}
