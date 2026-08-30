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

export function moveTargetLabel(target: MoveTarget): string {
  return target === 'focused' ? 'Move to Focused' : 'Move to Other';
}
