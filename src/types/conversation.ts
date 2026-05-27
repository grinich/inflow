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
  /** Other conversation IDs merged into this one (computed at query time, not persisted). */
  mergedIds?: string[];
}
