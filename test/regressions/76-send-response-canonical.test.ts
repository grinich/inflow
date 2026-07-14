/**
 * Regression: the send response was discarded, leaving the optimistic bubble
 * on a local-clock timestamp until an SSE echo happened to arrive.
 *
 * LinkedIn's createMessage action returns the created message entity (REST
 * action shape `{ value: {...} }`) with its canonical URN and server
 * deliveredAt. Discarding it meant: no SSE → temp message lingered with a
 * wall-clock createdAt (wrong ordering vs. a fast reply), and the
 * conversation's lastActivityAt kept the optimistic Date.now() stamp — on a
 * fast local clock that stamp masked genuinely new inbound messages from the
 * freshness checks.
 *
 * Fix: extractSentMessage parses the response DEFENSIVELY (unknown shapes →
 * null, behavior unchanged); when it finds the entity the handler stores the
 * canonical row, removes the matching optimistic temp, and corrects the
 * conversation's optimistic lastActivityAt down to the server's deliveredAt.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { extractSentMessage } from '@/lib/voyager-normalizer';

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
import { sendMessage } from '../../entrypoints/background/api/messages';
import { makeConversation } from '../fixtures/factories';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';
const CONV_ID = '2-conv-send';
const MSG_URN = `urn:li:msg_message:(${MEMBER_URN},msg-abc)`;

function sentEntity(deliveredAt: number, body = 'hello world') {
  return {
    entityUrn: MSG_URN,
    body: { text: body },
    deliveredAt,
    '*conversation': `urn:li:msg_conversation:(${MEMBER_URN},${CONV_ID})`,
  };
}

describe('extractSentMessage (pure, defensive)', () => {
  const T = 1_700_000_000_000;

  it('parses the REST action shape { value: {...} }', () => {
    const m = extractSentMessage({ value: sentEntity(T) }, CONV_ID, MEMBER_URN);
    expect(m).not.toBeNull();
    expect(m!.id).toBe(MSG_URN);
    expect(m!.createdAt).toBe(T);
    expect(m!.body).toBe('hello world');
    expect(m!.isFromMe).toBe(true);
    expect(m!.senderUrn).toBe(MEMBER_URN);
  });

  it('parses the wrapped shape { data: { value: {...} } }', () => {
    const m = extractSentMessage({ data: { value: sentEntity(T) } }, CONV_ID, MEMBER_URN);
    expect(m?.id).toBe(MSG_URN);
  });

  it('parses a normalized response with the Message in included[]', () => {
    const m = extractSentMessage(
      { data: {}, included: [{ $type: 'com.linkedin.messenger.Message', ...sentEntity(T) }] },
      CONV_ID,
      MEMBER_URN
    );
    expect(m?.id).toBe(MSG_URN);
  });

  it('returns null for unknown shapes, non-canonical URNs, and missing timestamps', () => {
    expect(extractSentMessage(null, CONV_ID, MEMBER_URN)).toBeNull();
    expect(extractSentMessage({ ok: true }, CONV_ID, MEMBER_URN)).toBeNull();
    expect(
      extractSentMessage(
        { value: { ...sentEntity(T), entityUrn: 'urn:li:something_else:x' } },
        CONV_ID,
        MEMBER_URN
      )
    ).toBeNull();
    expect(
      extractSentMessage(
        { value: { ...sentEntity(T), deliveredAt: undefined } },
        CONV_ID,
        MEMBER_URN
      )
    ).toBeNull();
  });
});

describe('SEND_MESSAGE stores the canonical message from the response', () => {
  const SERVER_T = Date.now() - 60_000; // server clock a minute behind local

  beforeEach(async () => {
    testDb = new Dexie(`TestDB_76_${Date.now()}_${Math.random()}`);
    applySchema(testDb);
    await testDb.open();
    vi.mocked(sendMessage).mockReset();
  });

  afterEach(async () => {
    if (testDb) {
      testDb.close();
      await Dexie.delete(testDb.name);
    }
  });

  it('stores the canonical row, removes the optimistic temp, and corrects lastActivityAt to server time', async () => {
    const optimisticNow = Date.now() + 120_000; // fast local clock stamped ahead
    await testDb.conversations.put(
      makeConversation({
        id: CONV_ID,
        lastMessage: 'hello world',
        lastActivityAt: optimisticNow,
      })
    );
    await testDb.messages.put({
      id: 'temp-xyz',
      conversationId: CONV_ID,
      senderUrn: 'me',
      senderName: 'You',
      senderPicture: '',
      body: 'hello world',
      createdAt: optimisticNow,
      isFromMe: true,
      status: 'sending',
    });

    vi.mocked(sendMessage).mockResolvedValue({ value: sentEntity(SERVER_T) } as any);

    const res = await handleMessage({
      type: 'SEND_MESSAGE',
      conversationId: CONV_ID,
      body: 'hello world',
    } as any);

    expect(res.success).toBe(true);
    // Canonical row stored with the SERVER timestamp
    const canonical = await testDb.messages.get(MSG_URN);
    expect(canonical).toBeDefined();
    expect(canonical.createdAt).toBe(SERVER_T);
    expect(canonical.isFromMe).toBe(true);
    // Matching optimistic temp removed (no duplicate bubble)
    expect(await testDb.messages.get('temp-xyz')).toBeUndefined();
    // The contaminated optimistic lastActivityAt is corrected DOWN to server
    // time so it can't mask genuinely new inbound messages.
    const conv = await testDb.conversations.get(CONV_ID);
    expect(conv.lastActivityAt).toBe(SERVER_T);
  });

  it('does not remove temps for a DIFFERENT body (only the sent message)', async () => {
    await testDb.conversations.put(makeConversation({ id: CONV_ID }));
    await testDb.messages.put({
      id: 'temp-other',
      conversationId: CONV_ID,
      senderUrn: 'me',
      senderName: 'You',
      senderPicture: '',
      body: 'a different queued message',
      createdAt: Date.now(),
      isFromMe: true,
      status: 'queued',
    });
    vi.mocked(sendMessage).mockResolvedValue({ value: sentEntity(SERVER_T) } as any);

    await handleMessage({ type: 'SEND_MESSAGE', conversationId: CONV_ID, body: 'hello world' } as any);

    expect(await testDb.messages.get('temp-other')).toBeDefined();
  });

  it('is a no-op (still success) when the response shape is unrecognized', async () => {
    await testDb.conversations.put(makeConversation({ id: CONV_ID }));
    vi.mocked(sendMessage).mockResolvedValue({ something: 'else' } as any);

    const res = await handleMessage({
      type: 'SEND_MESSAGE',
      conversationId: CONV_ID,
      body: 'hello world',
    } as any);

    expect(res.success).toBe(true);
    expect(await testDb.messages.count()).toBe(0); // nothing fabricated
  });
});
