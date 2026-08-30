// Opening the network view re-read every page of both invitation lists — ~32
// sequential requests for a few hundred sent requests, the first of them a
// 600KB page — to rediscover a list that had not changed.
//
// A walk that recognises what it is reading now stops. The bar for stopping is
// deliberately high, because the one change an incremental walk cannot see is
// a REMOVAL: a withdrawn, accepted or expired request just vanishes from the
// middle of the list, leaving a stale row behind. So it stops only when a
// whole page was already stored AND the pending count agrees with the server's
// own total AND an earlier walk is on record as having read everything AND
// that walk was recent. These pin each of those, and the pruning rule that
// depends on them.
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
  mergeProfiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/background/api/relationships', () => ({
  fetchInvitationsRaw: vi.fn(),
  fetchConnectionsRaw: vi.fn(),
  respondToInvitation: vi.fn(),
}));

const fetchSentInvitationsPage = vi.fn();
const fetchSentInvitationsAt = vi.fn();
const withdrawSentInvitation = vi.fn();
vi.mock('../../entrypoints/background/api/sent-invitations', () => ({
  fetchSentInvitationsPage: (...a: any[]) => fetchSentInvitationsPage(...a),
  fetchSentInvitationsAt: (...a: any[]) => fetchSentInvitationsAt(...a),
  withdrawSentInvitation: (...a: any[]) => withdrawSentInvitation(...a),
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

function row(id: string, first: string, last: string) {
  return (
    '\\"trackingActionType\\":\\"INVITATION_MANAGER_WITHDRAW\\",' +
    '\\"inviteeVanityName\\":\\"' + first.toLowerCase() + '\\",' +
    '\\"firstName\\":\\"' + first + '\\",\\"lastName\\":\\"' + last + '\\",' +
    '\\"profileUrn\\":\\"ACoAA' + id + '\\",' +
    '\\"invitationUrn\\":{\\"invitationId\\":\\"' + id + '\\"}'
  );
}

function page(rows: Array<[string, string, string]>, total: number) {
  return '<html><body><div>People (' + total + ')</div><script>' +
    rows.map(([id, f, l]) => '{' + row(id, f, l) + '}').join('') +
    '</script></body></html>';
}

/** Ten rows starting at `from`, so the walk keeps going. */
function fullPage(from: number, total = 25) {
  return page(
    Array.from({ length: 10 }, (_, i) => [String(from + i), 'P' + (from + i), 'Last'] as [string, string, string]),
    total
  );
}

/** The whole list: 25 rows over three pages. */
function serveWholeList(total = 25) {
  fetchSentInvitationsPage.mockResolvedValue(fullPage(0, total));
  fetchSentInvitationsAt.mockImplementation(async (start: number) =>
    start >= 20
      ? page(Array.from({ length: 5 }, (_, i) => [String(20 + i), 'P' + (20 + i), 'Last'] as [string, string, string]), total)
      : fullPage(start, total)
  );
}

const requestCount = () =>
  fetchSentInvitationsPage.mock.calls.length + fetchSentInvitationsAt.mock.calls.length;

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_walkskip_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});
afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
  vi.useRealTimers();
});

/** Walk the whole list once, as a first-ever sync would. */
async function primeFromScratch(total = 25) {
  serveWholeList(total);
  await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);
  vi.clearAllMocks();
  serveWholeList(total);
}

describe('regression #170: a walk that recognises the list stops early', () => {
  it('reads every page the first time', async () => {
    serveWholeList();

    const res = await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(res.data.complete).toBe(true);
    expect(await testDb.sentInvitations.count()).toBe(25);
    expect(requestCount()).toBe(3);
  });

  it('reads one page when nothing has changed', async () => {
    // The point of the whole exercise.
    await primeFromScratch();

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(requestCount()).toBe(1);
    expect(await testDb.sentInvitations.count()).toBe(25);
  });

  it('does not record an early stop as having covered the list', async () => {
    // If it did, the TTL would never expire and a removal would go unnoticed
    // forever.
    await primeFromScratch();
    const before = (await testDb.walkState.get('sentInvitations')).completedAt;

    const res = await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(res.data.complete).toBe(false);
    expect((await testDb.walkState.get('sentInvitations')).completedAt).toBe(before);
  });

  it('keeps reading when the front of the list has changed', async () => {
    // A newly sent request lands on page one, so the first page is not
    // recognised and the walk carries on.
    await primeFromScratch(26);
    fetchSentInvitationsPage.mockResolvedValue(
      page([['99', 'Brand', 'New'], ...Array.from({ length: 9 }, (_, i) => [String(i), 'P' + i, 'Last'] as [string, string, string])], 26)
    );

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(requestCount()).toBeGreaterThan(1);
    expect(await testDb.sentInvitations.get('99')).toBeTruthy();
  });

  it('reads everything again when the server total disagrees', async () => {
    // The signature of a removal: page one looks familiar, but the heading
    // says there are fewer than we hold. Stopping here would leave the
    // withdrawn one on screen indefinitely.
    await primeFromScratch();
    serveWholeList(24);

    const res = await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(requestCount()).toBe(3);
    expect(res.data.complete).toBe(true);
  });

  it('prunes a row that vanished from the server', async () => {
    // The full walk that the disagreement triggered has to actually clean up.
    await primeFromScratch();
    fetchSentInvitationsPage.mockResolvedValue(
      page(Array.from({ length: 9 }, (_, i) => [String(i + 1), 'P' + (i + 1), 'Last'] as [string, string, string]), 24)
    );
    fetchSentInvitationsAt.mockImplementation(async (start: number) =>
      page(Array.from({ length: start >= 20 ? 5 : 10 }, (_, i) => [String(start + i), 'P' + (start + i), 'Last'] as [string, string, string]), 24)
    );

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(await testDb.sentInvitations.get('0')).toBeUndefined();
  });

  it('reads everything again once the record goes stale', async () => {
    await primeFromScratch();
    // Six hours on: removals we could not have seen are now worth re-reading.
    await testDb.walkState.put({
      name: 'sentInvitations', completedAt: Date.now() - 7 * 60 * 60 * 1000, total: 25,
    });

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(requestCount()).toBe(3);
  });

  it('reads everything when no walk was ever completed', async () => {
    // A previous walk that stopped short — a failed page, the runaway cap —
    // records nothing, so the next one cannot take the list on trust. This is
    // the guard that keeps a truncated sync from becoming permanent.
    serveWholeList();
    await testDb.sentInvitations.bulkPut(
      Array.from({ length: 25 }, (_, i) => ({
        id: String(i), toUrn: 'urn:li:fsd_profile:ACoAA' + i, name: 'P' + i,
        headline: '', pictureUrl: '', publicId: 'p' + i, message: '', sentAt: 0,
        status: 'pending' as const,
      }))
    );

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(requestCount()).toBe(3);
  });

  it('starts over after the database is reset', async () => {
    // RESET_DB empties the tables; a leftover completion record would have the
    // next walk stop after one page over an empty list.
    await primeFromScratch();

    await handleMessage({ type: 'RESET_DB' } as any);

    expect(await testDb.walkState.get('sentInvitations')).toBeUndefined();
  });
});
