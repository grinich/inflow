import { fetchConversationsPage, type InboxCategory } from '../api/conversations';
import { getMemberUrn } from '../auth/session';
import { normalizeConversations } from '@/lib/voyager-normalizer';
import { debugLog } from '@/lib/debug-log';
import { db, mergeProfiles } from '@/db/database';
import { mergeConversation } from './merge-conversation';
import type { Conversation } from '@/types/conversation';
import type { Profile } from '@/types/profile';

const IMAGE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function cacheProfilePhotos(urls: string[]): Promise<void> {
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  if (uniqueUrls.length === 0) return;

  const now = Date.now();
  const existing = await db.imageCache.where('url').anyOf(uniqueUrls).toArray();
  const existingMap = new Map(existing.map(e => [e.url, e]));

  const toFetch = uniqueUrls.filter(url => {
    const cached = existingMap.get(url);
    return !cached || (now - cached.cachedAt > IMAGE_CACHE_TTL);
  });

  if (toFetch.length === 0) return;
  debugLog('info', `Caching ${toFetch.length} profile photos`);

  const results = await Promise.allSettled(
    toFetch.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const blob = await res.blob();
        return new Promise<{ url: string; dataUrl: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({ url, dataUrl: reader.result as string });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch {
        return undefined;
      }
    })
  );

  const toStore = results
    .filter((r): r is PromiseFulfilledResult<{ url: string; dataUrl: string } | undefined> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(Boolean)
    .map(item => ({ url: item!.url, dataUrl: item!.dataUrl, cachedAt: now }));

  if (toStore.length > 0) {
    await db.imageCache.bulkPut(toStore);
    debugLog('info', `Cached ${toStore.length} profile photos`);
  }
}

function broadcastSyncStatus(state: 'syncing' | 'idle' | 'error', message?: string) {
  chrome.runtime.sendMessage({ type: 'SYNC_STATUS', state, message }).catch(() => {});
}

/** Per-category lock — prevents concurrent syncs for the same category. */
const _syncingCategories = new Set<string>();

/**
 * Quick poll: sync most recent Focused inbox conversations.
 * Called by the periodic poller and manual sync button.
 *
 * Uses the paginated query to fetch one page of PRIMARY_INBOX (20 conversations).
 * This is the fastest path to populate the UI on startup.
 * Full discovery/pagination is handled by the coordinator's discovery phase.
 */
export async function syncConversations(): Promise<void> {
  if (_syncingCategories.has('PRIMARY_INBOX')) return;
  _syncingCategories.add('PRIMARY_INBOX');

  try {
    broadcastSyncStatus('syncing', 'Syncing conversations...');
    const memberUrn = await getMemberUrn();
    debugLog('info', `Member URN: ${memberUrn}`);

    // Fetch first page using the paginated endpoint (fastest single request)
    const { response: pageRaw } = await fetchConversationsPage('PRIMARY_INBOX', null);
    const totalStored = await storeConversationPage(pageRaw, memberUrn);

    debugLog('info', `Quick poll: synced ${totalStored} conversations`);

    // Notify any open tabs that sync completed
    broadcastSyncStatus('idle');
    chrome.runtime.sendMessage({ type: 'SYNC_COMPLETE' }).catch(() => {});

  } catch (err) {
    broadcastSyncStatus('error', 'Sync failed');
    debugLog('error', `Sync failed: ${err}`);
    throw err;
  } finally {
    _syncingCategories.delete('PRIMARY_INBOX');
  }
}

/**
 * Quick poll for a specific category (Other, Archived, Spam).
 * Called on-demand when the user switches to that inbox view.
 * Fetches first page only — burst discovery handles full pagination.
 */
export async function syncCategory(category: InboxCategory): Promise<void> {
  if (category === 'PRIMARY_INBOX') {
    await syncConversations();
    return;
  }

  if (_syncingCategories.has(category)) return;
  _syncingCategories.add(category);

  try {
    const label = category === 'SECONDARY_INBOX' ? 'Other' : category === 'ARCHIVE' ? 'Archived' : category === 'SPAM' ? 'Spam' : category;
    broadcastSyncStatus('syncing', `Syncing ${label}...`);
    const memberUrn = await getMemberUrn();
    debugLog('info', `Syncing category: ${category}`);

    const { response: raw } = await fetchConversationsPage(category, null);
    const totalStored = await storeConversationPage(raw, memberUrn);

    debugLog('info', `Synced ${totalStored} conversations for ${category}`);

    broadcastSyncStatus('idle');
    chrome.runtime.sendMessage({ type: 'SYNC_COMPLETE' }).catch(() => {});
  } catch (err) {
    broadcastSyncStatus('error', 'Sync failed');
    debugLog('error', `Category sync failed (${category}): ${err}`);
    throw err;
  } finally {
    _syncingCategories.delete(category);
  }
}

/**
 * Process and store a single page of raw Voyager response:
 * normalize, deduplicate, store to IndexedDB, cache profile photos.
 *
 * No message fetching — that's handled by the backfill system and
 * on-demand fetch in useThread.
 *
 * Returns the number of conversations stored.
 */
async function storeConversationPage(
  raw: any,
  memberUrn: string
): Promise<number> {
  const { conversations: rawConversations, profiles: rawProfiles } = normalizeConversations(raw, memberUrn);

  // Deduplicate within the page
  const conversationMap = new Map<string, Conversation>();
  for (const conv of rawConversations) {
    const existing = conversationMap.get(conv.id);
    if (!existing || conv.lastActivityAt > existing.lastActivityAt) {
      conversationMap.set(conv.id, conv);
    }
  }
  const conversations = [...conversationMap.values()];

  const profileMap = new Map<string, Profile>();
  for (const p of rawProfiles) {
    profileMap.set(p.urn, p);
  }
  const profiles = [...profileMap.values()];

  if (conversations.length === 0 && profiles.length === 0) return 0;

  debugLog('info', `Storing page: ${conversations.length} conversations, ${profiles.length} profiles`);

  // Store immediately so UI updates via useLiveQuery
  // mergeConversation preserves local-only fields and respects pending actions
  await db.transaction('rw', [db.conversations, db.profiles, db.pendingActions], async () => {
    await mergeProfiles(profiles);
    for (const conv of conversations) {
      await mergeConversation(conv);
    }
  });

  // Cache profile photos in background (non-blocking)
  const allPhotoUrls = [
    ...conversations.flatMap(c => c.participantPictures),
    ...profiles.map(p => p.pictureUrl),
  ];
  cacheProfilePhotos(allPhotoUrls).catch((err) => {
    debugLog('warn', `Photo caching failed: ${err}`);
  });


  return conversations.length;
}
