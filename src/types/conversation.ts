export interface Conversation {
  id: string;
  participantUrns: string[];
  participantNames: string[];
  participantPictures: string[];
  lastMessage: string;
  lastActivityAt: number;
  read: number; // 0 = unread, 1 = read (number for IndexedDB indexing)
  archived: number; // 0 = not archived, 1 = archived (number for IndexedDB indexing)
  category: string;
  hasAttachments?: number; // 0 = no, 1 = yes (number for IndexedDB indexing)
  starred?: number; // 0 = not starred, 1 = starred (number for IndexedDB indexing)
  draft?: number; // 0 or 1 — temporary conversation created from composer before send
  /** Local wall-clock timestamp of the last time SERVER data merged into this
   *  row. Used by the deletion sweep to detect rows the server stopped returning. */
  seenInSyncAt?: number;
  /** Consecutive completed discoveries that did not return this conversation.
   *  Reset on every server merge; at 2 the sweep deletes the row. */
  missedSyncCycles?: number;
  /** Other conversation IDs merged into this one (computed at query time, not persisted). */
  mergedIds?: string[];
}

/**
 * A conversation as parsed from a server payload. Flags the payload OMITTED are
 * `undefined` ("unknown") rather than defaulted — merges must keep the existing
 * local value instead of fabricating state from a sparse endpoint (e.g. search).
 */
export interface ServerConversation extends Omit<Conversation, 'read' | 'archived' | 'category'> {
  read?: number;
  archived?: number;
  category?: string;
}
