// Regression: FETCH_INVITATIONS fetched only `start=0&count=40`. Neither the
// handler nor NetworkView exposed a later page, so on accounts with more than
// 40 pending invitations everything past the first 40 was permanently
// unreachable in the network view. Walk every page instead, and only prune
// local pending rows once we've actually seen the complete server set.
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

// `raw` is opaque to the handler — it only round-trips through the normalizer.
// `rawCount` defaults to the row count but a fixture can set it independently,
// which is what lets us reproduce a full server page that parses short.
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

const PAGE = 40;

function inv(id: string): Invitation {
  return {
    id, sharedSecret: `s-${id}`, fromUrn: `urn:li:fsd_profile:${id}`, name: `Person ${id}`,
    headline: '', pictureUrl: '', publicId: id, message: '', sentAt: 1750000000000,
    status: 'pending', mutualCount: 0, mutualNames: [],
  };
}

/** n invitations numbered from `from`. */
const page = (from: number, n: number) =>
  ({ rows: Array.from({ length: n }, (_, i) => inv(`inv-${from + i}`)) });

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_inv_page_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});
afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

describe('FETCH_INVITATIONS pagination', () => {
  it('walks every page until a short one and stores them all', async () => {
    fetchInvitationsRaw
      .mockResolvedValueOnce(page(0, PAGE))
      .mockResolvedValueOnce(page(40, PAGE))
      .mockResolvedValueOnce(page(80, 7));

    const res = await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(res.success).toBe(true);
    expect((res.data as any).count).toBe(87);
    expect(fetchInvitationsRaw.mock.calls.map((c) => c[0])).toEqual([0, 40, 80]);
    expect(await testDb.invitations.count()).toBe(87);
    // The page-2+ rows the old single-page fetch could never reach.
    expect(await testDb.invitations.get('inv-86')).toBeTruthy();
  });

  it('stops after one request when the first page is short', async () => {
    fetchInvitationsRaw.mockResolvedValueOnce(page(0, 3));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(fetchInvitationsRaw).toHaveBeenCalledTimes(1);
    expect(await testDb.invitations.count()).toBe(3);
  });

  it('prunes local pending rows the full walk did not return', async () => {
    await testDb.invitations.bulkPut([inv('stale'), inv('inv-0')]);
    fetchInvitationsRaw
      .mockResolvedValueOnce(page(0, PAGE))
      .mockResolvedValueOnce(page(40, 1));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(await testDb.invitations.get('stale')).toBeUndefined();
    expect(await testDb.invitations.get('inv-0')).toBeTruthy();
  });

  it('keeps locally-acted-on invitations out of the pending list', async () => {
    await testDb.invitations.put({ ...inv('inv-0'), status: 'ignored' });
    fetchInvitationsRaw.mockResolvedValueOnce(page(0, 2));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect((await testDb.invitations.get('inv-0')).status).toBe('ignored');
  });

  it('does not prune when it stops at the page cap', async () => {
    await testDb.invitations.put(inv('stale'));
    // Always a full page — the walk hits MAX_PAGES without proving completeness.
    fetchInvitationsRaw.mockImplementation(async (start: number) => page(start, PAGE));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(fetchInvitationsRaw).toHaveBeenCalledTimes(50);
    expect(await testDb.invitations.get('stale')).toBeTruthy();
  });

  it('stops instead of looping when the server ignores `start`', async () => {
    // Same full page every time — without the dedup guard this runs to the cap.
    fetchInvitationsRaw.mockResolvedValue(page(0, PAGE));

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(fetchInvitationsRaw).toHaveBeenCalledTimes(2);
    expect(await testDb.invitations.count()).toBe(PAGE);
  });
});
