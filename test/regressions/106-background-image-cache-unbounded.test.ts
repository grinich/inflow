// @vitest-environment jsdom
/**
 * Regression: the background profile-photo prefetch grew the imageCache table
 * without limit.
 *
 * The durable image cache has a 1000-row cap, but the eviction only ran from
 * the UI read-through path (useCachedImage, every 50th hook write). The
 * background sync's cacheProfilePhotos — which writes far MORE rows, on every
 * discovery page — never pruned. And because the background pre-caches
 * everything, the UI path rarely writes at all, so the cap was practically
 * unenforced. LinkedIn CDN photo URLs are signed and rotate, so the same
 * photo re-enters the cache under a new key every rotation: unbounded growth
 * (~50KB per row per the DebugPanel's own estimate).
 *
 * Fix: pruneImageCache lives in src/lib/image-cache.ts and runs after the
 * background bulkPut too.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { mockFetch, resetFetchMock } from '../mocks/fetch';

let testDb: any;

/**
 * A stand-in for the CDN's image response.
 *
 * Not `new Response(new Blob(...))`: this file runs in jsdom, whose Blob has
 * no .stream(), so undici's Response constructor throws
 * ("object.stream is not a function") on Node 22 — and because
 * cacheProfilePhotos swallows fetch errors, the test failed with nothing
 * cached rather than with the real reason. Building the Response from a
 * string instead trades one break for another: the undici Blob that
 * res.blob() then returns is rejected by jsdom's FileReader.
 *
 * cacheProfilePhotos only reads `ok` and `blob()`, so hand it a jsdom Blob
 * directly — the same thing a real browser gives it, and it works on every
 * Node version.
 */
const imageResponse = () =>
  ({
    ok: true,
    blob: async () => new Blob(['img-bytes'], { type: 'image/jpeg' }),
  }) as unknown as Response;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { cacheProfilePhotos } from '../../entrypoints/background/sync/sync-engine';
import { IMAGE_CACHE_MAX } from '@/lib/image-cache';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_106_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  resetFetchMock();
  mockFetch('cdn.example', async () => imageResponse());
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('background photo caching evicts oldest entries beyond the cap', async () => {
  // Cache already at the cap, oldest first.
  const seed = Array.from({ length: IMAGE_CACHE_MAX }, (_, i) => ({
    url: `https://cdn.example/old-${i}.jpg`,
    dataUrl: 'data:image/jpeg;base64,AAAA',
    cachedAt: 1_000_000 + i,
  }));
  await testDb.imageCache.bulkPut(seed);

  await cacheProfilePhotos(['https://cdn.example/new-1.jpg', 'https://cdn.example/new-2.jpg']);

  const count = await testDb.imageCache.count();
  expect(count).toBeLessThanOrEqual(IMAGE_CACHE_MAX);
  // The new entries are cached; the two oldest were evicted. Assert the stored
  // data URL, not just the row: a broken mock used to leave nothing cached at
  // all, and `toBeTruthy` on a missing row reported that as an opaque
  // "expected undefined to be truthy".
  expect((await testDb.imageCache.get('https://cdn.example/new-1.jpg'))?.dataUrl)
    .toMatch(/^data:image\/jpeg;base64,/);
  expect((await testDb.imageCache.get('https://cdn.example/new-2.jpg'))?.dataUrl)
    .toMatch(/^data:image\/jpeg;base64,/);
  expect(await testDb.imageCache.get('https://cdn.example/old-0.jpg')).toBeUndefined();
  expect(await testDb.imageCache.get('https://cdn.example/old-1.jpg')).toBeUndefined();
});
