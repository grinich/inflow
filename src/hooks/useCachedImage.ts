import { useEffect, useSyncExternalStore } from 'react';
import { db } from '@/db/database';

// ── In-memory cache ──────────────────────────────────────────────────
// Sits in front of IndexedDB so repeated renders get data synchronously
// on the very first frame — no async gap, no layout jitter.
const mem = new Map<string, string>();       // url → dataUrl
const refCount = new Map<string, number>();  // url → number of active consumers
const pending = new Set<string>();           // in-flight fetches
const subscribers = new Set<() => void>();   // useSyncExternalStore listeners

// Batch notify: coalesce multiple synchronous cache fills into one re-render
let notifyScheduled = false;
function scheduleNotify() {
  if (notifyScheduled) return;
  notifyScheduled = true;
  queueMicrotask(() => {
    notifyScheduled = false;
    for (const cb of subscribers) cb();
  });
}

function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// Concurrency limiter: max 6 concurrent loadAndCache calls
const MAX_CONCURRENT = 6;
let activeLoads = 0;
const loadQueue: (() => void)[] = [];

function enqueueLoad(url: string) {
  if (activeLoads < MAX_CONCURRENT) {
    activeLoads++;
    loadAndCache(url).finally(() => {
      activeLoads--;
      pending.delete(url);
      if (loadQueue.length > 0) loadQueue.shift()!();
    });
  } else {
    loadQueue.push(() => {
      activeLoads++;
      loadAndCache(url).finally(() => {
        activeLoads--;
        pending.delete(url);
        if (loadQueue.length > 0) loadQueue.shift()!();
      });
    });
  }
}

/**
 * Returns a cached data URL for an image, falling back to the original URL.
 * Uses a synchronous in-memory Map so cached images render on the first
 * frame with no flicker. IndexedDB is the durable backing store; on cold
 * start the in-memory cache is populated from it transparently.
 *
 * Ref-counted: when all consumers of a URL unmount, the in-memory entry
 * is released (IndexedDB keeps the durable copy).
 */
export function useCachedImage(url: string | undefined): string {
  // Synchronous read from in-memory map — no async tick
  const dataUrl = useSyncExternalStore(subscribe, () => (url ? mem.get(url) : undefined));

  useEffect(() => {
    if (!url) return;

    // Ref-count: retain while mounted
    refCount.set(url, (refCount.get(url) || 0) + 1);

    if (!mem.has(url) && !pending.has(url)) {
      pending.add(url);
      enqueueLoad(url);
    }

    return () => {
      const count = (refCount.get(url) || 1) - 1;
      if (count <= 0) {
        refCount.delete(url);
        mem.delete(url); // release memory; IndexedDB still has it
      } else {
        refCount.set(url, count);
      }
    };
  }, [url]);

  return dataUrl || url || '';
}

/**
 * Preload images into the in-memory cache without rendering them.
 * Call with a list of URLs (e.g. participant pictures for visible conversations).
 * Each preloaded URL is ref-counted — call the returned cleanup function
 * when the images are no longer needed (e.g. row scrolls out of view).
 */
export function preloadImages(urls: string[]): () => void {
  const valid = urls.filter((u) => u && !mem.has(u) && !pending.has(u));
  for (const url of valid) {
    refCount.set(url, (refCount.get(url) || 0) + 1);
    pending.add(url);
    enqueueLoad(url);
  }
  // Also ref-count URLs that were already cached
  for (const url of urls) {
    if (url && !valid.includes(url)) {
      refCount.set(url, (refCount.get(url) || 0) + 1);
    }
  }

  return () => {
    for (const url of urls) {
      if (!url) continue;
      const count = (refCount.get(url) || 1) - 1;
      if (count <= 0) {
        refCount.delete(url);
        mem.delete(url);
      } else {
        refCount.set(url, count);
      }
    }
  };
}

async function loadAndCache(url: string): Promise<void> {
  // 1. Check IndexedDB
  try {
    const row = await db.imageCache.get(url);
    if (row?.dataUrl) {
      mem.set(url, row.dataUrl);
      scheduleNotify();
      return;
    }
  } catch {}

  // 2. Fetch from network and cache in both layers
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    mem.set(url, dataUrl);
    scheduleNotify();
    await db.imageCache.put({ url, dataUrl, cachedAt: Date.now() });
  } catch {
    // silently fail — original URL will continue to be used
  }
}
