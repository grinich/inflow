// FETCH_SENT_INVITATIONS walks LinkedIn's invitation manager: page one as
// HTML, the rest through the pagination action its infinite scroll uses,
// cursored on a plain offset.
//
// Pruning is only safe once that walk finishes. A partial read — a later page
// failing, or the runaway stop tripping — must not be mistaken for "these
// invitations are gone", or a sync would wipe hundreds of rows.
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { SentInvitation } from '@/types/network';

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

/** A page carrying `rows` and claiming `total` outstanding overall. */
function page(rows: Array<[string, string, string]>, total: number) {
  return '<html><body><div>People (' + total + ')</div><script>' +
    rows.map(([id, f, l]) => '{' + row(id, f, l) + '}').join('') +
    '</script></body></html>';
}

function stored(id: string): SentInvitation {
  return {
    id, toUrn: 'urn:li:fsd_profile:ACoAA' + id, name: 'Person ' + id,
    headline: '', pictureUrl: '', publicId: 'p' + id, message: '', sentAt: 0,
    status: 'pending',
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_sentfetch_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});
afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

/** A full page of 10, so the walk keeps going. */
function fullPage(from: number, total?: number) {
  return page(
    Array.from({ length: 10 }, (_, i) => [String(from + i), 'P' + (from + i), 'Last'] as [string, string, string]),
    total ?? 311
  );
}

describe('FETCH_SENT_INVITATIONS', () => {
  it('stores the rows from page one', async () => {
    fetchSentInvitationsPage.mockResolvedValueOnce(page([['1', 'Dillon', 'Mulroy'], ['2', 'Steve', 'Hamrick']], 2));

    const res = await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(res.success).toBe(true);
    expect(await testDb.sentInvitations.count()).toBe(2);
  });

  it('walks past the first page', async () => {
    // The whole point: 311 outstanding, 10 per page.
    fetchSentInvitationsPage.mockResolvedValueOnce(fullPage(0));
    fetchSentInvitationsAt
      .mockResolvedValueOnce(fullPage(10))
      .mockResolvedValueOnce(page([['20', 'Last', 'One']], 311));

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(fetchSentInvitationsAt.mock.calls.map((c) => c[0])).toEqual([10, 20]);
    expect(await testDb.sentInvitations.count()).toBe(21);
  });

  it('stops once it has as many as the heading claimed', async () => {
    fetchSentInvitationsPage.mockResolvedValueOnce(fullPage(0, 20));
    fetchSentInvitationsAt.mockResolvedValueOnce(fullPage(10, 20));

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(fetchSentInvitationsAt).toHaveBeenCalledTimes(1);
    expect(await testDb.sentInvitations.count()).toBe(20);
  });

  it('keeps walking when a full page has an unreadable row', async () => {
    // The page held ten rows; one is unreadable, so nine come back. Judging
    // "end of list" by the nine would stop here and let the prune delete
    // everything beyond — rawCount is what keeps the walk honest.
    // One row carries a non-numeric id, so the parser cannot use it — no
    // string surgery, which kept hitting profileUrn instead of the id.
    const rows = Array.from(
      { length: 10 },
      (_, i) => [i === 5 ? 'not-a-number' : String(100 + i), 'P' + i, 'Last'] as [string, string, string]
    );
    const damaged = page(rows, 311);
    fetchSentInvitationsPage.mockResolvedValueOnce(damaged);
    fetchSentInvitationsAt.mockResolvedValueOnce(page([['99', 'Last', 'One']], 311));

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(fetchSentInvitationsAt).toHaveBeenCalledTimes(1);
    expect(await testDb.sentInvitations.count()).toBe(10); // 9 readable + the next page
  });

  it('stops instead of looping when a page repeats what it already has', async () => {
    fetchSentInvitationsPage.mockResolvedValueOnce(fullPage(0));
    fetchSentInvitationsAt.mockResolvedValue(fullPage(0));

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(fetchSentInvitationsAt).toHaveBeenCalledTimes(1);
    expect(await testDb.sentInvitations.count()).toBe(10);
  });

  it('reports the real total from the heading', async () => {
    fetchSentInvitationsPage.mockResolvedValueOnce(page([['1', 'Dillon', 'Mulroy']], 311));

    const res = await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect((res.data as any).total).toBe(311);
  });

  it('prunes what a completed walk did not return', async () => {
    await testDb.sentInvitations.put(stored('gone'));
    fetchSentInvitationsPage.mockResolvedValueOnce(page([['1', 'Dillon', 'Mulroy']], 1));

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(await testDb.sentInvitations.get('gone')).toBeUndefined();
    expect(await testDb.sentInvitations.get('1')).toBeTruthy();
  });

  it('prunes nothing when a later page failed', async () => {
    // The dangerous case: a partial read looks exactly like a shrunken list.
    await testDb.sentInvitations.bulkPut(
      Array.from({ length: 300 }, (_, i) => stored('old-' + i))
    );
    fetchSentInvitationsPage.mockResolvedValueOnce(fullPage(0));
    fetchSentInvitationsAt.mockRejectedValueOnce(new Error('429'));

    const res = await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect((res.data as any).complete).toBe(false);
    expect(await testDb.sentInvitations.count()).toBe(310);
  });

  it('keeps the pages it already read when a later one fails', async () => {
    fetchSentInvitationsPage.mockResolvedValueOnce(fullPage(0));
    fetchSentInvitationsAt
      .mockResolvedValueOnce(fullPage(10))
      .mockRejectedValueOnce(new Error('429'));

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(await testDb.sentInvitations.count()).toBe(20);
  });

  it('lets a failed first page reject rather than reporting an empty list', async () => {
    // handleMessage rethrows; the onMessage listener turns that into
    // {success:false, error}, which is what NetworkView renders. Reporting
    // zero sent invitations here would be the dangerous outcome.
    fetchSentInvitationsPage.mockRejectedValueOnce(new Error('Sent invitations page failed: 999'));

    await expect(handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any)).rejects.toThrow('999');
    expect(await testDb.sentInvitations.count()).toBe(0);
  });

  it('keeps a locally withdrawn row withdrawn when the page still lists it', async () => {
    await testDb.sentInvitations.put({ ...stored('1'), status: 'withdrawn' });
    fetchSentInvitationsPage.mockResolvedValueOnce(page([['1', 'Dillon', 'Mulroy']], 1));

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect((await testDb.sentInvitations.get('1')).status).toBe('withdrawn');
  });
});

describe('WITHDRAW_INVITATION', () => {
  it('posts the withdraw and marks the row', async () => {
    await testDb.sentInvitations.put(stored('7'));

    const res = await handleMessage({ type: 'WITHDRAW_INVITATION', invitationId: '7' } as any);

    expect(res.success).toBe(true);
    expect(withdrawSentInvitation).toHaveBeenCalledTimes(1);
    expect(withdrawSentInvitation.mock.calls[0][0].id).toBe('7');
    expect((await testDb.sentInvitations.get('7')).status).toBe('withdrawn');
  });

  it('leaves the row pending when the withdraw fails', async () => {
    await testDb.sentInvitations.put(stored('7'));
    withdrawSentInvitation.mockRejectedValueOnce(new Error('Withdraw failed: 500'));

    await expect(
      handleMessage({ type: 'WITHDRAW_INVITATION', invitationId: '7' } as any)
    ).rejects.toThrow('500');

    // Marked withdrawn only after the server accepted it.
    expect((await testDb.sentInvitations.get('7')).status).toBe('pending');
  });

  it('refuses an id it does not hold', async () => {
    const res = await handleMessage({ type: 'WITHDRAW_INVITATION', invitationId: 'nope' } as any);

    expect(res.success).toBe(false);
    expect(withdrawSentInvitation).not.toHaveBeenCalled();
  });
});
