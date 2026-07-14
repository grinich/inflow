/**
 * Inbound read-state sync: a read/unread toggle made on LinkedIn's side arrives
 * as an old-format `RealtimeConversation` event that carries NO per-conversation
 * read flag (verified via full-payload dump: read/unreadCount/conversationBundle
 * are all absent) — only the inbox-wide `unreadConversationsCount`. So server-side
 * toggles weren't reflected in inflow until the ~2-min reconcile poll.
 *
 * Read/unread is reconciled per-conversation in _doFetchLatest (see regression
 * 89). This file locks in the diagnostic dump and the redundant-refetch
 * coalescing (immediate + one trailing per short window).
 *
 * The db module is stubbed (not real fake-indexeddb) so the timer-driven paths
 * can be exercised with vi's fake timers without IndexedDB's own timers hanging.
 */
import { debugLog } from '@/lib/debug-log';

vi.mock('@/db/database', () => ({
  db: { conversations: { get: vi.fn().mockResolvedValue(undefined) } },
  getDbGeneration: () => 0,
  mergeProfiles: vi.fn(),
  TOMBSTONE_TTL_MS: 0,
}));

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));
const fetchMessages = vi.fn().mockResolvedValue({ data: {}, included: [] });
vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: (...args: any[]) => fetchMessages(...args),
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));
vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  shouldSuppressConversationUpdate: vi.fn().mockReturnValue(false),
  isMutationSuppressed: vi.fn().mockReturnValue(false),
  recordMutation: vi.fn(),
  recordMarkRead: vi.fn(),
}));

import {
  handleRealtimeEvent,
  __resetInboundReadState,
} from '../../entrypoints/background/realtime/event-handler';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

/** Dispatch an old-format conversationsTopic RealtimeConversation event. */
function fire(convId: string, entity: Record<string, any>): Promise<void> {
  return handleRealtimeEvent('event', {
    'com.linkedin.realtimefrontend.DecoratedEvent': {
      topic: 'urn:li-realtime:conversationsTopic:urn:li-realtime:myself',
      payload: {
        data: {
          included: [
            { $type: 'com.linkedin.voyager.messaging.MessagingMember', entityUrn: 'urn:li:msg_messagingMember:x' },
            {
              $type: 'com.linkedin.voyager.messaging.realtime.RealtimeConversation',
              entityUrn: `urn:li:msg_conversation:(${MEMBER_URN},${convId})`,
              action: 'UPDATE',
              ...entity,
            },
          ],
        },
      },
    },
  });
}

beforeEach(() => {
  vi.mocked(debugLog).mockClear();
  fetchMessages.mockClear();
  __resetInboundReadState();
});

afterEach(() => {
  vi.useRealTimers();
  __resetInboundReadState();
});

describe('RealtimeConversation read-state diagnostic dump', () => {
  it('dumps the full entity including nested conversationBundle for inspection', async () => {
    await fire('2-diag', { unreadConversationsCount: 6, conversationBundle: { read: false, unreadCount: 2 } });

    const dump = vi.mocked(debugLog).mock.calls.find(
      ([, msg]) => typeof msg === 'string' && msg.includes('RealtimeConversation dump'),
    );
    expect(dump).toBeTruthy();
    const [, msg] = dump!;
    expect(msg).toContain('action=UPDATE');
    expect(msg).toContain('unreadConversationsCount=6');
    expect(msg).toContain('conversationBundle=');
    expect(msg).toContain('"unreadCount":2');
    expect(msg).toContain('entity=');
  });
});

describe('refetch coalescing', () => {
  it('collapses a burst of echoes for one conversation into fewer fetches', async () => {
    vi.useFakeTimers();
    // Constant count → no reconcile noise; isolate the refetch behavior.
    await fire('2-c', { unreadConversationsCount: 3 }); // immediate fetch
    await fire('2-c', { unreadConversationsCount: 3 }); // trailing scheduled
    await fire('2-c', { unreadConversationsCount: 3 }); // coalesced into trailing

    expect(fetchMessages).toHaveBeenCalledTimes(1); // only the immediate one so far
    await vi.advanceTimersByTimeAsync(2500);
    expect(fetchMessages).toHaveBeenCalledTimes(2); // + one trailing (3 echoes -> 2 fetches)
  });
});
