// Regression: three ways the invitation walk lost invitations on a real
// account (382 pending, which is where all of these start to bite).
//
// 1. The early-break compared the NORMALIZED row count against the page size,
//    so a full server page where some entities failed to parse read as "end of
//    list" — and because that also set `complete`, the prune then deleted every
//    local pending row past the truncation point.
// 2. A single failed page threw out of the loop before `bulkPut`, discarding
//    every invitation already fetched. Ten-plus sequential Voyager calls will
//    occasionally trip a rate limit, so this was a routine total loss.
// 3. MAX_PAGES was 10 (400 invitations) — a ceiling this account was already
//    at 382 of.
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Invitation } from '@/types/network';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
  mergeProfiles: vi.fn().mockResolvedValue(undefined),
}));

const fetchInvitationsRaw = vi.fn();
vi.mock('../../entrypoints/background/api/relationships', () => ({
  fetchInvitationsRaw: (...a: any[]) => fetchInvitationsRaw(...a),
  fetchConnectionsRaw: vi.fn(),
  respondToInvitation: vi.fn(),
}));

vi.mock('@/lib/network-normalizer', () => ({
  normalizeInvitations: (raw: any) => ({
    invitations: raw.rows,
    profiles: raw.profiles ?? [],
    rawCount: raw.rawCount ?? raw.rows.length,
  }),
  normalizeConnections: vi.fn(),
  invitationPaging: (raw: any) => (raw.total === undefined ? null : { total: raw.total }),
}));

vi.mock('../../entrypoints/background/api/conversations', () => ({
  archiveConversation: vi.fn(), unarchiveConversation: vi.fn(), moveToOther: vi.fn(),
  moveToFocused: vi.fn(), moveToSpam: vi.fn(), markConversationRead: vi.fn(),
  markConversationUnread: vi.fn(), deleteConversation: vi.fn(), starConversation: vi.fn(),
  unstarConversation: vi.fn(), searchConversations: vi.fn(),
}));
vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn(), fetchAllMessages: vi.fn(), sendMessage: vi.fn(), editMessage: vi.fn(),
  createConversation: vi.fn(), reactWithEmoji: vi.fn(), recallMessage: vi.fn(),
}));
vi.mock('../../entrypoints/background/api/typeahead', () => ({ searchTypeahead: vi.fn() }));
vi.mock('../../entrypoints/background/api/posts', () => ({ fetchPost: vi.fn() }));
vi.mock('../../entrypoints/background/auth/session', () => ({
  getSession: vi.fn().mockResolvedValue({ authenticated: true }),
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));
vi.mock('../../entrypoints/background/sync/sync-engine', () => ({ syncConversations: vi.fn(), syncCategory: vi.fn() }));
vi.mock('../../entrypoints/background/sync/sync-coordinator', () => ({
  burstDiscover: vi.fn(), toggleSyncPause: vi.fn(), broadcastProgress: vi.fn(),
}));
vi.mock('../../entrypoints/background/sync/sync-backfill', () => ({ backfillBatch: vi.fn() }));
vi.mock('../../entrypoints/background/sync/prefetch-posts', () => ({
  prefetchSharedPosts: vi.fn().mockResolvedValue(undefined), POST_CACHE_TTL: 0,
}));
vi.mock('../../entrypoints/background/sync/repair-participants', () => ({
  repairConversationParticipants: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../entrypoints/background/sync/reconcile-messages', () => ({ reconcileRecalledMessages: vi.fn() }));
vi.mock('../../entrypoints/background/sync/merge-conversation', () => ({ mergeConversation: vi.fn() }));
vi.mock('../../entrypoints/background/diagnostic', () => ({ runDiagnosticSync: vi.fn() }));
vi.mock('../../entrypoints/background/realtime/sse-client', () => ({ getSSEStatus: vi.fn() }));
vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  recordMarkRead: vi.fn(), recordMutation: vi.fn(),
}));
vi.mock('../../entrypoints/background/send-queue', () => ({ enqueueSend: vi.fn() }));
vi.mock('../../entrypoints/background/update-check', () => ({ checkForUpdate: vi.fn() }));
vi.mock('../../entrypoints/background/db-ready', () => ({ dbReady: Promise.resolve(), markDbReady: vi.fn() }));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn(), getDebugLogs: vi.fn(), clearDebugLogs: vi.fn() }));

import { handleMessage } from '../../entrypoints/background/messages';
import { mergeProfiles } from '@/db/database';

const PAGE = 40;

function inv(id: string): Invitation {
  return {
    id, sharedSecret: `s-${id}`, fromUrn: `urn:li:fsd_profile:${id}`, name: `Person ${id}`,
    headline: '', pictureUrl: '', publicId: id, message: '', sentAt: 1750000000000,
    status: 'pending', mutualCount: 0, mutualNames: [],
  };
}

const page = (from: number, n: number, extra: Record<string, unknown> = {}) => ({
  rows: Array.from({ length: n }, (_, i) => inv(`inv-${from + i}`)),
  ...extra,
});

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_inv_resil_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});
afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

describe('invitation walk resilience', () => {
  it('keeps walking when a full page normalizes short', async () => {
    // The server sent 40, only 31 survived parsing. That is NOT the end of the
    // list — the old code stopped here and lost everything after page 1.
    fetchInvitationsRaw
      .mockResolvedValueOnce(page(0, 31, { rawCount: PAGE }))
      .mockResolvedValueOnce(page(40, 12));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(fetchInvitationsRaw).toHaveBeenCalledTimes(2);
    expect(await testDb.invitations.count()).toBe(43);
  });

  it('does not prune on a page that only looked short', async () => {
    await testDb.invitations.put(inv('inv-99'));
    // A full page that parsed short (so the walk must continue), then a
    // failure. `inv-99` is in neither page, and the old code would have called
    // page 1 the end of the list and pruned it.
    fetchInvitationsRaw.mockResolvedValueOnce(page(0, 5, { rawCount: PAGE }));
    fetchInvitationsRaw.mockRejectedValueOnce(new Error('429 Too Many Requests'));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    // Walk never proved completeness, so nothing is pruned.
    expect(await testDb.invitations.get('inv-99')).toBeTruthy();
  });

  it('stores the invitations it already fetched when a later page fails', async () => {
    fetchInvitationsRaw
      .mockResolvedValueOnce(page(0, PAGE))
      .mockResolvedValueOnce(page(40, PAGE))
      .mockRejectedValueOnce(new Error('429 Too Many Requests'));

    const res = await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    // The old handler threw straight past bulkPut and stored none of these.
    expect(res.success).toBe(true);
    expect((res.data as any).complete).toBe(false);
    expect(await testDb.invitations.count()).toBe(80);
  });

  it('walks past the old 400-invitation ceiling', async () => {
    // 382 pending is inside the old cap; 420 is not.
    // A server holding exactly 420, so the last page is a partial one.
    fetchInvitationsRaw.mockImplementation(async (start: number) =>
      page(start, Math.max(0, Math.min(PAGE, 420 - start)))
    );

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(await testDb.invitations.count()).toBe(420);
  });

  // `paging.total` is only trusted in the direction of fetching MORE. An
  // earlier attempt at this used it as a stop condition, which cost a
  // 382-invitation account everything past the first page: the endpoint
  // reported `total` as the page size, so the walk stopped at 40, called
  // itself complete, and the prune deleted the other 342.
  it('does not stop at a paging.total that only describes the page', async () => {
    fetchInvitationsRaw.mockImplementation(async (start: number) =>
      page(start, Math.max(0, Math.min(PAGE, 382 - start)), { total: PAGE })
    );

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(await testDb.invitations.count()).toBe(382);
  });

  it('does not delete stored invitations when a truncated walk claims completeness', async () => {
    await testDb.invitations.bulkPut(
      Array.from({ length: 382 }, (_, i) => inv(`inv-${i}`))
    );
    // One short page that (wrongly) reads as the whole list.
    fetchInvitationsRaw.mockResolvedValueOnce(page(0, 3));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    // Would have pruned 379 rows. The guard declines and logs instead.
    expect(await testDb.invitations.count()).toBe(382);
  });

  it('keeps walking past a short page when paging.total says there is more', async () => {
    fetchInvitationsRaw
      .mockResolvedValueOnce(page(0, 30, { total: 45 }))
      .mockResolvedValueOnce(page(30, 15, { total: 45 }));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(fetchInvitationsRaw).toHaveBeenCalledTimes(2);
    expect(await testDb.invitations.count()).toBe(45);
  });

  it('feeds sender profiles to the shared profile cache', async () => {
    const profiles = [{ urn: 'urn:li:fsd_profile:x', publicId: 'x', firstName: 'X', lastName: 'Y',
      fullName: 'X Y', occupation: '', location: '', pictureUrl: 'https://pic' }];
    fetchInvitationsRaw.mockResolvedValueOnce(page(0, 1, { profiles }));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(mergeProfiles).toHaveBeenCalledWith(profiles);
  });
});
