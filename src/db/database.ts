import Dexie, { type EntityTable } from 'dexie';
import type { Conversation } from '@/types/conversation';
import type { Message } from '@/types/message';
import type { Profile } from '@/types/profile';

export interface PendingAction {
  id: string;
  type: 'archive' | 'unarchive' | 'markRead' | 'markUnread' | 'send';
  conversationId: string;
  status: 'pending' | 'confirmed' | 'failed';
  timestamp: number;
  rollbackData?: any;
}

export interface CachedImage {
  url: string;
  dataUrl: string;
  cachedAt: number;
}

export interface CachedPost {
  urn: string;
  authorName: string;
  authorHeadline: string;
  authorPicture: string;
  text: string;
  imageUrl: string;
  activityUrl: string;
  cachedAt: number;
}

export interface SyncState {
  category: string;
  phase: 'idle' | 'discovering' | 'backfilling' | 'complete';
  cursor: string;
  totalDiscovered: number;
  discoveryCompletedAt: number;
  lastSyncStartedAt: number;
  lastSyncCompletedAt: number;
}

export interface DraftAttachment {
  conversationId: string;
  files: Blob[];     // stored as native blobs — no base64 overhead
  names: string[];
  types: string[];
}

export interface SyncQueueItem {
  conversationId: string;
  category: string;
  lastActivityAt: number;
  messagesSyncedAt: number;
  status: 'pending' | 'syncing' | 'done' | 'failed';
  failCount: number;
  lastFailedAt: number;
  priority: number;
}

const database = new Dexie('InflowDB') as Dexie & {
  conversations: EntityTable<Conversation, 'id'>;
  messages: EntityTable<Message, 'id'>;
  profiles: EntityTable<Profile, 'urn'>;
  pendingActions: EntityTable<PendingAction, 'id'>;
  imageCache: EntityTable<CachedImage, 'url'>;
  postCache: EntityTable<CachedPost, 'urn'>;
  syncState: EntityTable<SyncState, 'category'>;
  syncQueue: EntityTable<SyncQueueItem, 'conversationId'>;
  draftAttachments: EntityTable<DraftAttachment, 'conversationId'>;
};

database.version(1).stores({
  conversations: 'id, lastActivityAt, archived, read, [archived+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
});

// v2: archived and read changed from boolean to number (0/1) for IndexedDB key compat
database.version(2).stores({
  conversations: 'id, lastActivityAt, archived, read, [archived+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
}).upgrade(tx => {
  return tx.table('conversations').toCollection().modify(conv => {
    conv.archived = conv.archived ? 1 : 0;
    conv.read = conv.read ? 1 : 0;
  });
});

// v3: add image cache table
database.version(3).stores({
  conversations: 'id, lastActivityAt, archived, read, [archived+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
  imageCache: 'url, cachedAt',
});

// v4: add category index for inbox filtering
database.version(4).stores({
  conversations: 'id, lastActivityAt, archived, read, category, [archived+lastActivityAt], [category+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
  imageCache: 'url, cachedAt',
}).upgrade(tx => {
  return tx.table('conversations').toCollection().modify(conv => {
    if (!conv.category) {
      conv.category = conv.archived ? 'ARCHIVE' : 'PRIMARY_INBOX';
    }
  });
});

// v5: add hasAttachments index for search filtering
database.version(5).stores({
  conversations: 'id, lastActivityAt, archived, read, category, hasAttachments, [archived+lastActivityAt], [category+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
  imageCache: 'url, cachedAt',
}).upgrade(async (tx) => {
  // Backfill: scan messages to find conversations with attachments
  const messages = await tx.table('messages').toArray();
  const convsWithAttachments = new Set<string>();
  for (const msg of messages) {
    if (msg.attachments && msg.attachments.length > 0) {
      convsWithAttachments.add(msg.conversationId);
    }
  }
  await tx.table('conversations').toCollection().modify((conv) => {
    conv.hasAttachments = convsWithAttachments.has(conv.id) ? 1 : 0;
  });
});

// v6: add postCache table for pre-fetched shared post data
database.version(6).stores({
  conversations: 'id, lastActivityAt, archived, read, category, hasAttachments, [archived+lastActivityAt], [category+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
  imageCache: 'url, cachedAt',
  postCache: 'urn, cachedAt',
});

// v7: add syncState + syncQueue tables for comprehensive sync engine
database.version(7).stores({
  conversations: 'id, lastActivityAt, archived, read, category, hasAttachments, [archived+lastActivityAt], [category+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
  imageCache: 'url, cachedAt',
  postCache: 'urn, cachedAt',
  syncState: 'category',
  syncQueue: 'conversationId, status, priority, [status+priority]',
});

// v8: cursor changed from number to string for real LinkedIn pagination —
// clear syncState so discovery restarts with string cursors.
database.version(8).stores({
  conversations: 'id, lastActivityAt, archived, read, category, hasAttachments, [archived+lastActivityAt], [category+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
  imageCache: 'url, cachedAt',
  postCache: 'urn, cachedAt',
  syncState: 'category',
  syncQueue: 'conversationId, status, priority, [status+priority]',
}).upgrade(tx => {
  // Clear sync state so it re-initializes with string cursors
  return tx.table('syncState').clear();
});

// v9: add draftAttachments table for persisting file drafts (blobs in IndexedDB, not localStorage)
database.version(9).stores({
  conversations: 'id, lastActivityAt, archived, read, category, hasAttachments, [archived+lastActivityAt], [category+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
  imageCache: 'url, cachedAt',
  postCache: 'urn, cachedAt',
  syncState: 'category',
  syncQueue: 'conversationId, status, priority, [status+priority]',
  draftAttachments: 'conversationId',
});

// v10: add starred index for star/unstar conversations
database.version(10).stores({
  conversations: 'id, lastActivityAt, archived, read, category, hasAttachments, starred, [archived+lastActivityAt], [category+lastActivityAt]',
  messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
  profiles: 'urn, publicId',
  pendingActions: 'id, type, status, timestamp',
  imageCache: 'url, cachedAt',
  postCache: 'urn, cachedAt',
  syncState: 'category',
  syncQueue: 'conversationId, status, priority, [status+priority]',
  draftAttachments: 'conversationId',
}).upgrade(tx => {
  return tx.table('conversations').toCollection().modify(conv => {
    if (conv.starred === undefined) conv.starred = 0;
  });
});

export const db = database;

/**
 * Upsert profiles while preserving enriched fields (company, title, location)
 * that the messaging API doesn't provide but were fetched from profile pages.
 */
export async function mergeProfiles(profiles: Profile[]): Promise<void> {
  if (profiles.length === 0) return;
  const urns = profiles.map((p) => p.urn);
  const existing = await db.profiles.bulkGet(urns);
  for (let i = 0; i < profiles.length; i++) {
    const prev = existing[i];
    if (prev) {
      if (prev.company && !profiles[i].company) profiles[i].company = prev.company;
      if (prev.title && !profiles[i].title) profiles[i].title = prev.title;
      if (prev.location && !profiles[i].location) profiles[i].location = prev.location;
      if (prev.companyLogoUrl && !profiles[i].companyLogoUrl) profiles[i].companyLogoUrl = prev.companyLogoUrl;
    }
  }
  await db.profiles.bulkPut(profiles);
}
