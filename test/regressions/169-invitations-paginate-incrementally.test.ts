// Both invitation walks used to buffer every page and write once at the end.
// A few hundred sent requests meant ~32 sequential fetches — the first of them
// a 600KB HTML page — with nothing on screen until the last one landed.
//
// Pages are stored as they arrive now, so the live query paints the list while
// the walk is still running. These pin that the writes happen DURING the walk,
// not merely that they happen: the earlier code passed every end-state
// assertion while showing the user nothing for half a minute.
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

/** A full page of 10, so the walk keeps going. */
function fullPage(from: number, total = 40) {
  return page(
    Array.from({ length: 10 }, (_, i) => [String(from + i), 'P' + (from + i), 'Last'] as [string, string, string]),
    total
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_incremental_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});
afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

describe('regression #169: invitation pages appear as they arrive', () => {
  it('has page one stored before page two is even requested', async () => {
    // The heart of it. If this passes, the list has rows on screen while the
    // remaining requests are still in flight.
    let countWhenPage2Asked = -1;
    fetchSentInvitationsPage.mockResolvedValueOnce(fullPage(0));
    fetchSentInvitationsAt.mockImplementation(async (start: number) => {
      if (start === 10) countWhenPage2Asked = await testDb.sentInvitations.count();
      return page([[String(start), 'Last', 'Page']], 40);
    });

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(countWhenPage2Asked).toBe(10);
  });

  it('keeps adding to what is already there', async () => {
    const seen: number[] = [];
    fetchSentInvitationsPage.mockResolvedValueOnce(fullPage(0));
    fetchSentInvitationsAt.mockImplementation(async (start: number) => {
      seen.push(await testDb.sentInvitations.count());
      return start >= 30 ? page([['99', 'The', 'End']], 40) : fullPage(start);
    });

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    // 10 on screen before page two, 20 before page three, 30 before page four.
    expect(seen).toEqual([10, 20, 30]);
    expect(await testDb.sentInvitations.count()).toBe(31);
  });

  it('keeps the pages it read when a later one fails', async () => {
    // Storing as we go makes a partial walk useful instead of wasted.
    fetchSentInvitationsPage.mockResolvedValueOnce(fullPage(0));
    fetchSentInvitationsAt.mockRejectedValueOnce(new Error('rate limited'));

    const res = await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect(res.success).toBe(true);
    expect(await testDb.sentInvitations.count()).toBe(10);
  });

  it('still refuses to resurrect one the user withdrew mid-walk', async () => {
    // The per-page write must keep the guard the single end-of-walk write had.
    fetchSentInvitationsPage.mockResolvedValueOnce(fullPage(0));
    fetchSentInvitationsAt.mockImplementation(async (start: number) => {
      if (start === 10) {
        await testDb.sentInvitations.update('0', { status: 'withdrawn' });
      }
      return start >= 20 ? page([['99', 'The', 'End']], 40) : fullPage(start);
    });

    await handleMessage({ type: 'FETCH_SENT_INVITATIONS' } as any);

    expect((await testDb.sentInvitations.get('0')).status).toBe('withdrawn');
  });

  it('does the same for received invitations', async () => {
    const { fetchInvitationsRaw } = await import('../../entrypoints/background/api/relationships');
    let countWhenPage2Asked = -1;
    (fetchInvitationsRaw as any).mockImplementation(async (start: number) => {
      if (start === 40) countWhenPage2Asked = await testDb.invitations.count();
      return voyagerInvitations(start, start === 0 ? 40 : 1);
    });

    await handleMessage({ type: 'FETCH_INVITATIONS' } as any);

    expect(countWhenPage2Asked).toBe(40);
  });
});

/**
 * A page of pending invitations, shaped like the real response.
 *
 * `paging` sits on `data`, which is where invitationPaging looks — an earlier
 * version of this fixture nested it deeper, so `total` silently parsed as null
 * and the walk's completeness logic was never exercised by it.
 */
function voyagerInvitations(start: number, count: number) {
  const ids = Array.from({ length: count }, (_, i) => `urn:li:fs_relInvitation:${start + i}`);
  return {
    data: {
      elements: ids.map((urn) => ({
        $type: 'com.linkedin.voyager.relationships.invitation.InvitationView',
        invitation: urn,
      })),
      paging: { start, count, total: 41 },
    },
    included: [
      ...ids.map((urn, i) => ({
        $type: 'com.linkedin.voyager.relationships.invitation.Invitation',
        entityUrn: urn,
        invitationType: 'CONNECTION',
        sharedSecret: 'secret',
        invitationState: 'PENDING',
        sentTime: 1_750_000_000_000,
        '*fromMember': `urn:li:fs_miniProfile:M${start + i}`,
      })),
      ...ids.map((_, i) => ({
        $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
        entityUrn: `urn:li:fs_miniProfile:M${start + i}`,
        firstName: 'Person',
        lastName: String(start + i),
        occupation: '',
        publicIdentifier: `p${start + i}`,
      })),
    ],
  };
}
