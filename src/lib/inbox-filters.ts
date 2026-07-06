import type { Conversation } from '@/types/conversation';

/**
 * The single definition of the Focused tab's category rule: PRIMARY_INBOX,
 * legacy 'INBOX' rows, and rows with no category at all (old data). Shared by
 * the conversation list and the toolbar badge so they can never disagree.
 */
export function isFocusedCategory(category: string | undefined): boolean {
  return !category || category === 'PRIMARY_INBOX' || category === 'INBOX';
}

/**
 * "Belongs to the Focused tab" for badge purposes: focused category, not
 * archived, and not a compose draft. (The list itself still SHOWS drafts —
 * they just never count as unread.)
 */
export function isFocusedConversation(
  c: Pick<Conversation, 'archived' | 'category' | 'draft'>
): boolean {
  if (c.draft === 1) return false;
  if (c.archived === 1) return false;
  return isFocusedCategory(c.category);
}

/** Count unread Focused-tab conversations (drives the toolbar badge). */
export async function countUnreadFocused(db: {
  conversations: { where(index: string): { equals(v: number): { filter(f: (c: Conversation) => boolean): { count(): Promise<number> } } } };
}): Promise<number> {
  return db.conversations
    .where('read')
    .equals(0)
    .filter((c) => isFocusedConversation(c))
    .count();
}
