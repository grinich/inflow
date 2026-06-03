import Dexie, { type EntityTable } from 'dexie';
import type { Conversation } from '@/types/conversation';
import type { Message } from '@/types/message';
import type { Profile } from '@/types/profile';

export interface PendingAction {
  id: string;
  type: 'archive' | 'unarchive' | 'markRead' | 'markUnread' | 'send' | 'move_to_focused' | 'move_to_other' | 'move_to_spam' | 'star' | 'unstar' | 'delete' | 'edit_message' | 'react_emoji' | 'recall_message';
  conversationId: string;
  status: 'pending' | 'confirmed' | 'failed' | 'queued';
  timestamp: number;
  rollbackData?: any;
  /** Exact bridge payload to replay when draining the queue. */
  bridgeMessage?: any;
  /** For send actions — links to the temp-* message ID. */
  tempMessageId?: string;
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
  text?: string;     // draft message text
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

type InflowDatabase = Dexie & {
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

export function applySchema(database: Dexie): void {
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

  // v8: cursor changed from number to string for real LinkedIn pagination
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
    return tx.table('syncState').clear();
  });

  // v9: add draftAttachments table for persisting file drafts
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

  // v11: migrate text drafts from localStorage into draftAttachments table
  database.version(11).stores({
    conversations: 'id, lastActivityAt, archived, read, category, hasAttachments, starred, [archived+lastActivityAt], [category+lastActivityAt]',
    messages: 'id, conversationId, createdAt, [conversationId+createdAt]',
    profiles: 'urn, publicId',
    pendingActions: 'id, type, status, timestamp',
    imageCache: 'url, cachedAt',
    postCache: 'urn, cachedAt',
    syncState: 'category',
    syncQueue: 'conversationId, status, priority, [status+priority]',
    draftAttachments: 'conversationId',
  });
  // NOTE: the legacy localStorage→draftAttachments draft migration runs in the UI
  // via migrateDraftsFromLocalStorage(). It cannot run here: this upgrade normally
  // executes first in the service worker, where `localStorage` is undefined, so the
  // migration silently no-oped and the version still advanced (never re-running).
}

function createDatabase(name: string): InflowDatabase {
  const database = new Dexie(name) as InflowDatabase;
  applySchema(database);
  return database;
}

// ---------------------------------------------------------------------------
// Simple per-account database: InflowDB_<memberId>
//
// The active account ID is persisted via chrome.storage.session so it
// survives service worker restarts and hot reloads. On module init we
// synchronously check for a cached value; if not available the DB starts
// as 'InflowDB' and is swapped once switchDatabase() is called.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'inflow-active-member-id';

/** In-memory cache — synced to/from chrome.storage.session. */
let activeMemberId: string | null = null;

// No default DB — created lazily by switchDatabase() or the storage init below.
let _db: InflowDatabase = null as any;
export let db: InflowDatabase = null as any;

// Eagerly restore the persisted account ID on module init.
// Opens the correct DB before any switchDatabase() call arrives.
(async () => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const result = await chrome.storage.session.get(STORAGE_KEY);
      const stored = result[STORAGE_KEY] as string | undefined;
      if (stored && stored !== 'demo' && !activeMemberId) {
        activeMemberId = stored;
        _db = createDatabase(`InflowDB_${stored}`);
        db = _db;
        await _db.open();
      }
    }
  } catch {}
})();

export function getActiveAccountId(): string | null {
  return activeMemberId;
}

/**
 * Switch to the database for a specific member.
 * Each account gets its own IndexedDB: InflowDB_<memberId>
 * Persists the choice to chrome.storage.session so it survives restarts.
 */
// Serialize switches so concurrent callers (startup IIFE, cookie-change,
// session refresh) can't interleave close()/open() on the shared handle and
// leave `db` pointing at a half-open or wrong database.
let _switchChain: Promise<void> = Promise.resolve();

export function switchDatabase(memberId: string): Promise<void> {
  _switchChain = _switchChain.then(
    () => _doSwitchDatabase(memberId),
    () => _doSwitchDatabase(memberId),
  );
  return _switchChain;
}

async function _doSwitchDatabase(memberId: string): Promise<void> {
  const newName = `InflowDB_${memberId}`;

  // Already on the right DB
  if (activeMemberId === memberId && _db?.name === newName) return;

  if (_db) _db.close();
  _db = createDatabase(newName);
  db = _db;
  activeMemberId = memberId;
  _dbGeneration++;
  persistAccountId(memberId);
  await _db.open();
}

/**
 * Monotonic counter bumped on every account/database switch. Long-running
 * background loops (backfill, drain, discovery) capture it and bail if it
 * changes mid-loop, so an account switch can't redirect their writes into the
 * newly-active account's database.
 */
let _dbGeneration = 0;
export function getDbGeneration(): number {
  return _dbGeneration;
}

/** Persist account ID to chrome.storage.session (fire-and-forget). */
function persistAccountId(memberId: string): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      chrome.storage.session.set({ [STORAGE_KEY]: memberId }).catch(() => {});
    }
  } catch {}
}

/**
 * Extract the short member ID from a memberUrn.
 * e.g. "urn:li:fsd_profile:ACoAAA..." -> "ACoAAA..."
 */
export function memberIdFromUrn(memberUrn: string): string {
  return memberUrn.split(':').pop() || '';
}

/**
 * One-time, idempotent migration of legacy text drafts from localStorage into
 * the draftAttachments table. Must run in a context where localStorage exists
 * (the UI page) — not the service worker, where the old Dexie v11 upgrade tried
 * (and failed) to do this. Safe to call repeatedly: it clears the localStorage
 * key only after a successful migration.
 */
export async function migrateDraftsFromLocalStorage(): Promise<void> {
  if (typeof localStorage === 'undefined' || !db) return;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem('inflow-drafts');
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const textDrafts: Record<string, string> = JSON.parse(raw);
    for (const [convId, text] of Object.entries(textDrafts)) {
      if (!text) continue;
      const existing = await db.draftAttachments.get(convId);
      if (existing) {
        // Don't clobber a newer draft already saved in the table.
        if (!existing.text) await db.draftAttachments.update(convId, { text });
      } else {
        await db.draftAttachments.put({ conversationId: convId, text, files: [], names: [], types: [] });
      }
    }
    localStorage.removeItem('inflow-drafts');
  } catch {
    // Leave the localStorage key intact so a future run can retry.
  }
}

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
      const p = profiles[i];
      // Never overwrite a previously-known value with an empty one. The Messenger
      // API returns sparse profiles (often missing publicId/occupation/picture),
      // so a routine poll must not wipe fields enriched from full profile pages.
      if (prev.publicId && !p.publicId) p.publicId = prev.publicId;
      if (prev.fullName && !p.fullName) p.fullName = prev.fullName;
      if (prev.firstName && !p.firstName) p.firstName = prev.firstName;
      if (prev.lastName && !p.lastName) p.lastName = prev.lastName;
      if (prev.occupation && !p.occupation) p.occupation = prev.occupation;
      if (prev.pictureUrl && !p.pictureUrl) p.pictureUrl = prev.pictureUrl;
      if (prev.company && !p.company) p.company = prev.company;
      if (prev.title && !p.title) p.title = prev.title;
      if (prev.location && !p.location) p.location = prev.location;
      if (prev.companyLogoUrl && !p.companyLogoUrl) p.companyLogoUrl = prev.companyLogoUrl;
    }
  }
  await db.profiles.bulkPut(profiles);
}
