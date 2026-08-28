/**
 * Regression: the shared-post cache grew without bound.
 *
 * postCache rows are keyed by stable post URNs, so unlike the image cache
 * they don't churn on URL rotation — but nothing ever evicted them either:
 * the 7-day TTL only governs refresh, not removal, so every shared post ever
 * seen stayed in IndexedDB forever (~1KB each per the DebugPanel estimate).
 *
 * Fix: cap the table like the image cache — oldest entries (by cachedAt)
 * evicted beyond the cap after each write.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { mockFetch, resetFetchMock } from '../mocks/fetch';

let testDb: any;

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

const fetchPost = vi.fn();
vi.mock('../../entrypoints/background/api/posts', () => ({
  fetchPost: (...args: any[]) => fetchPost(...args),
}));

import { prefetchSharedPosts, POST_CACHE_MAX } from '../../entrypoints/background/sync/prefetch-posts';
import type { Message } from '@/types/message';

function sharedPostMessage(postUrn: string): Message {
  return {
    id: `urn:li:msg_message:(2-p,${postUrn})`,
    conversationId: '2-p',
    senderUrn: 'urn:li:fsd_profile:OTHER',
    senderName: 'Other',
    senderPicture: '',
    body: '',
    createdAt: 1000,
    isFromMe: false,
    attachments: [{ type: 'sharedPost', postUrn }],
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_122_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  resetFetchMock();
  fetchPost.mockReset().mockResolvedValue({
    authorName: 'A', authorHeadline: '', authorPicture: '', text: 'post', imageUrl: '', activityUrl: '',
  });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('evicts oldest cached posts beyond the cap', async () => {
  const seed = Array.from({ length: POST_CACHE_MAX }, (_, i) => ({
    urn: `urn:li:activity:old-${i}`,
    authorName: 'A', authorHeadline: '', authorPicture: '', text: 'old', imageUrl: '', activityUrl: '',
    cachedAt: 1_000_000 + i,
  }));
  await testDb.postCache.bulkPut(seed);

  await prefetchSharedPosts([sharedPostMessage('urn:li:activity:brand-new')]);

  expect(await testDb.postCache.count()).toBeLessThanOrEqual(POST_CACHE_MAX);
  expect(await testDb.postCache.get('urn:li:activity:brand-new')).toBeTruthy();
  expect(await testDb.postCache.get('urn:li:activity:old-0')).toBeUndefined();
});
