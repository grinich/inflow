// FETCH_SENT_INVITATIONS against LinkedIn's invitation-manager page.
//
// The page hands over a handful of rows out of hundreds, so the pruning rule
// that suits the received list — delete anything the server did not return —
// would wipe almost everything here on every sync.
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
const withdrawSentInvitation = vi.fn();
vi.mock('../../entrypoints/background/api/sent-invitations', () => ({
  fetchSentInvitationsPage: (...a: any[]) => fetchSentInvitationsPage(...a),
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

describe('FETCH_SENT_INVITATIONS', () => {
  it('stores the rows the page embedded', async () => {
    fetchSentInvitationsPage.mockResolvedValueOnce(page([['1', 'Dillon', 'Mulroy'], ['2', 'Steve', 'Hamrick']], 309));

    const res = await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(res.success).toBe(true);
    expect(await testDb.sentInvitations.count()).toBe(2);
  });

  it('reports the real total, not the number of rows', async () => {
    fetchSentInvitationsPage.mockResolvedValueOnce(page([['1', 'Dillon', 'Mulroy']], 309));

    const res = await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect((res.data as any).total).toBe(309);
    expect((res.data as any).count).toBe(1);
  });

  it('does not prune the hundreds of rows the page never covered', async () => {
    // The whole hazard of this endpoint: 2 rows returned, 300 held locally.
    await testDb.sentInvitations.bulkPut(
      Array.from({ length: 300 }, (_, i) => stored('old-' + i))
    );
    fetchSentInvitationsPage.mockResolvedValueOnce(page([['1', 'Dillon', 'Mulroy']], 309));

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(await testDb.sentInvitations.count()).toBe(301);
  });

  it('prunes once the page plainly covers everything', async () => {
    await testDb.sentInvitations.put(stored('gone'));
    fetchSentInvitationsPage.mockResolvedValueOnce(page([['1', 'Dillon', 'Mulroy']], 1));

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(await testDb.sentInvitations.get('gone')).toBeUndefined();
    expect(await testDb.sentInvitations.get('1')).toBeTruthy();
  });

  it('lets a failed page fetch reject rather than reporting an empty list', async () => {
    // handleMessage rethrows; the onMessage listener turns that into
    // {success:false, error}, which is what NetworkView renders. Reporting
    // zero sent invitations here would be the dangerous outcome.
    fetchSentInvitationsPage.mockRejectedValueOnce(new Error('Sent invitations page failed: 999'));

    await expect(handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any)).rejects.toThrow('999');
    expect(await testDb.sentInvitations.count()).toBe(0);
  });

  it('keeps a locally withdrawn row withdrawn when the page still lists it', async () => {
    await testDb.sentInvitations.put({ ...stored('1'), status: 'withdrawn' });
    fetchSentInvitationsPage.mockResolvedValueOnce(page([['1', 'Dillon', 'Mulroy']], 309));

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
