import { db } from '@/db/database';

/** Durable image-cache cap — oldest entries (by cachedAt) evicted beyond it. */
export const IMAGE_CACHE_MAX = 1000;

/**
 * Bound the durable IndexedDB image cache so it can't grow without limit.
 * LinkedIn CDN photo URLs are signed and rotate, so the same photo re-enters
 * the cache under a new key every rotation — without eviction the table grows
 * forever. Shared by the UI read-through cache (useCachedImage) and the
 * background photo prefetch (sync-engine), which writes far more rows than
 * the UI path.
 */
export async function pruneImageCache(): Promise<void> {
  try {
    const count = await db.imageCache.count();
    if (count <= IMAGE_CACHE_MAX) return;
    const oldest = await db.imageCache
      .orderBy('cachedAt')
      .limit(count - IMAGE_CACHE_MAX)
      .primaryKeys();
    if (oldest.length) await db.imageCache.bulkDelete(oldest as string[]);
  } catch {
    // best-effort maintenance — never block the write path
  }
}
