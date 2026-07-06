/**
 * Regression: FETCH_POST served stale post-cache entries forever.
 *
 * prefetchSharedPosts refreshes cached posts after a 7-day TTL, but the
 * on-demand FETCH_POST handler returned any cached row unconditionally —
 * including "not found" sentinels. A post that was temporarily unfetchable
 * (rate limit, transient error) was cached as not-found and never retried on
 * the on-demand path, and edited/deleted posts never refreshed.
 *
 * Fix: FETCH_POST honors the same TTL and refetches stale entries.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

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

vi.mock('../../entrypoints/background/db-ready', () => ({
  dbReady: Promise.resolve(),
  markDbReady: vi.fn(),
}));

vi.mock('../../entrypoints/background/api/conversations', () => ({
  archiveConversation: vi.fn(),
  unarchiveConversation: vi.fn(),
  moveToOther: vi.fn(),
  moveToFocused: vi.fn(),
  moveToSpam: vi.fn(),
  markConversationRead: vi.fn(),
  markConversationUnread: vi.fn(),
  deleteConversation: vi.fn(),
  starConversation: vi.fn(),
  unstarConversation: vi.fn(),
  searchConversations: vi.fn(),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn(),
  fetchAllMessages: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  createConversation: vi.fn(),
  reactWithEmoji: vi.fn(),
  recallMessage: vi.fn(),
}));

vi.mock('../../entrypoints/background/api/typeahead', () => ({ searchTypeahead: vi.fn() }));
vi.mock('../../entrypoints/background/api/profiles', () => ({ fetchProfileByUrn: vi.fn() }));
vi.mock('../../entrypoints/background/api/posts', () => ({ fetchPost: vi.fn() }));
vi.mock('../../entrypoints/background/auth/session', () => ({
  getSession: vi.fn().mockResolvedValue({ authenticated: true, memberUrn: 'urn:li:fsd_profile:SELF' }),
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));
vi.mock('../../entrypoints/background/sync/sync-engine', () => ({
  syncConversations: vi.fn(),
  syncCategory: vi.fn(),
}));
vi.mock('../../entrypoints/background/sync/sync-coordinator', () => ({
  burstDiscover: vi.fn(),
  toggleSyncPause: vi.fn(),
  broadcastProgress: vi.fn(),
}));
vi.mock('../../entrypoints/background/sync/sync-backfill', () => ({ backfillBatch: vi.fn() }));
vi.mock('../../entrypoints/background/sync/prefetch-posts', () => ({
  prefetchSharedPosts: vi.fn(),
  POST_CACHE_TTL: 7 * 24 * 60 * 60 * 1000,
}));
vi.mock('../../entrypoints/background/sync/repair-participants', () => ({
  repairConversationParticipants: vi.fn(),
}));
vi.mock('../../entrypoints/background/diagnostic', () => ({ runDiagnosticSync: vi.fn() }));
vi.mock('../../entrypoints/background/realtime/sse-client', () => ({ getSSEStatus: vi.fn() }));
vi.mock('../../entrypoints/background/update-check', () => ({ checkForUpdate: vi.fn() }));
vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
  getDebugLogs: vi.fn(),
  clearDebugLogs: vi.fn(),
}));
vi.mock('@/lib/sync-settings', () => ({ getBackfillCutoff: vi.fn().mockResolvedValue(0) }));

import { handleMessage } from '../../entrypoints/background/messages';
import { fetchPost } from '../../entrypoints/background/api/posts';

const URN = 'urn:li:activity:12345';
const STALE = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days — past the 7d TTL

function cachedPost(overrides: Record<string, any> = {}) {
  return {
    urn: URN,
    authorName: 'Old Author',
    authorHeadline: '',
    authorPicture: '',
    text: 'old cached text',
    imageUrl: '',
    activityUrl: '',
    cachedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_73_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  vi.mocked(fetchPost).mockReset();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('FETCH_POST cache TTL', () => {
  it('returns a fresh cached post without refetching', async () => {
    await testDb.postCache.put(cachedPost());

    const res = await handleMessage({ type: 'FETCH_POST', activityUrn: URN } as any);

    expect(res.success).toBe(true);
    expect(res.data.text).toBe('old cached text');
    expect(fetchPost).not.toHaveBeenCalled();
  });

  it('refetches a stale cached post (same TTL as prefetch)', async () => {
    await testDb.postCache.put(cachedPost({ cachedAt: STALE }));
    vi.mocked(fetchPost).mockResolvedValue({
      authorName: 'New Author',
      authorHeadline: '',
      authorPicture: '',
      text: 'refreshed text',
      imageUrl: '',
      activityUrl: '',
    });

    const res = await handleMessage({ type: 'FETCH_POST', activityUrn: URN } as any);

    expect(fetchPost).toHaveBeenCalledWith(URN);
    expect(res.data.text).toBe('refreshed text');
    // Cache updated with the fresh copy
    const row = await testDb.postCache.get(URN);
    expect(row.text).toBe('refreshed text');
    expect(row.cachedAt).toBeGreaterThan(STALE);
  });

  it('retries a stale not-found sentinel instead of returning null forever', async () => {
    await testDb.postCache.put(
      cachedPost({ authorName: '', text: '', cachedAt: STALE })
    );
    vi.mocked(fetchPost).mockResolvedValue({
      authorName: 'Now Available',
      authorHeadline: '',
      authorPicture: '',
      text: 'the post exists after all',
      imageUrl: '',
      activityUrl: '',
    });

    const res = await handleMessage({ type: 'FETCH_POST', activityUrn: URN } as any);

    expect(fetchPost).toHaveBeenCalledWith(URN);
    expect(res.data?.text).toBe('the post exists after all');
  });

  it('still returns null for a FRESH not-found sentinel without refetching', async () => {
    await testDb.postCache.put(cachedPost({ authorName: '', text: '' }));

    const res = await handleMessage({ type: 'FETCH_POST', activityUrn: URN } as any);

    expect(res.data).toBeNull();
    expect(fetchPost).not.toHaveBeenCalled();
  });
});
