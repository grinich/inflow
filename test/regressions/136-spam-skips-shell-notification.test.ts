/**
 * Hardening for the shell-notification routing order in
 * showNativeNotification (event-handler.ts): the SPAM check runs BEFORE
 * notifyViaShell. Regression 91 pinned "SPAM → no chrome.notifications", but
 * with a web shell connected the notification takes a different exit
 * (SHOW_NOTIFICATION over the unread-count port) — a reordering of the checks
 * would make spam ping the installed PWA while the chrome-only test stayed
 * green. This pins: SPAM must produce NO notification on EITHER path, and a
 * connected shell must not change spam's silence.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Conversation } from '@/types/conversation';

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

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn().mockResolvedValue({ data: {}, included: [] }),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  shouldSuppressConversationUpdate: vi.fn().mockReturnValue(false),
  isMutationSuppressed: vi.fn().mockReturnValue(false),
  recordMutation: vi.fn(),
  recordMarkRead: vi.fn(),
}));

import { handleRealtimeEvent } from '../../entrypoints/background/realtime/event-handler';
import { setupExternalPortRouter } from '../../entrypoints/background/external-messages';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-spam',
    participantUrns: ['urn:li:fsd_profile:ALICE'],
    participantNames: ['Alice Jones'],
    participantPictures: [''],
    lastMessage: 'earlier message',
    lastActivityAt: 5000,
    read: 1,
    archived: 0,
    category: 'SPAM',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

function buildMessageEvent(msg: { entityUrn: string; convId: string; body: string; deliveredAt: number }) {
  const participantUrn = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:ALICE';
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: {
          data: {
            included: [
              {
                $type: 'com.linkedin.messenger.MessagingParticipant',
                entityUrn: participantUrn,
                hostIdentityUrn: 'urn:li:fsd_profile:ALICE',
                participantType: {
                  member: {
                    firstName: { text: 'Alice' },
                    lastName: { text: 'Jones' },
                  },
                },
              },
              {
                $type: 'com.linkedin.messenger.Message',
                entityUrn: msg.entityUrn,
                body: { text: msg.body },
                deliveredAt: msg.deliveredAt,
                '*sender': participantUrn,
                '*conversation': `urn:li:msg_conversation:(${MEMBER_URN},${msg.convId})`,
              },
            ],
          },
        },
      },
    },
  };
}

// showNativeNotification is fire-and-forget — flush its detached async chain
// (tabs.query → conversations.get → notifyViaShell / notifications.create).
function flush(ms = 25) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Connect a shell port that reported Notification permission. */
function connectNotifyingShell() {
  setupExternalPortRouter();
  const connectCalls = vi.mocked(chrome.runtime.onConnectExternal.addListener).mock.calls;
  const onConnect = connectCalls[connectCalls.length - 1][0] as (port: any) => void;
  const disconnectListeners: Array<() => void> = [];
  const messageListeners: Array<(m: any) => void> = [];
  const port = {
    name: 'unread-count',
    sender: { origin: 'https://inflow.im' },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onDisconnect: { addListener: (fn: () => void) => disconnectListeners.push(fn) },
    onMessage: { addListener: (fn: (m: any) => void) => messageListeners.push(fn) },
  };
  onConnect(port);
  messageListeners.forEach((fn) => fn({ type: 'HELLO', canNotify: true }));
  return {
    port,
    // The registry is module-level state — always disconnect so later tests
    // (in this file and this worker) see a clean slate.
    disconnect: () => disconnectListeners.forEach((fn) => fn()),
  };
}

const shellNotifications = (port: { postMessage: ReturnType<typeof vi.fn> }) =>
  port.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === 'SHOW_NOTIFICATION');

beforeEach(async () => {
  testDb = new Dexie(`TestDB_136_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  vi.mocked(chrome.tabs.query).mockResolvedValue([]);
  vi.mocked(chrome.notifications.create).mockClear();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('spam stays silent even with a notification-capable shell connected', () => {
  it('a SPAM message produces neither a shell SHOW_NOTIFICATION nor a chrome notification', async () => {
    const shell = connectNotifyingShell();
    try {
      await testDb.conversations.put(makeConversation());

      const ev = buildMessageEvent({
        entityUrn: 'urn:li:msg_message:SPAM_SHELL',
        convId: 'conv-spam',
        body: 'buy my thing',
        deliveredAt: 6000,
      });
      await handleRealtimeEvent(ev.eventType, ev.data);
      await flush();

      expect(shellNotifications(shell.port)).toHaveLength(0);
      expect(chrome.notifications.create).not.toHaveBeenCalled();
      // The message itself is still stored — only the ping is suppressed.
      expect(await testDb.messages.get('urn:li:msg_message:SPAM_SHELL')).toBeDefined();
    } finally {
      shell.disconnect();
    }
  });

  it('control: the same shell DOES get the notification for a non-spam conversation', async () => {
    const shell = connectNotifyingShell();
    try {
      await testDb.conversations.put(
        makeConversation({ id: 'conv-normal', category: 'PRIMARY_INBOX' })
      );

      const ev = buildMessageEvent({
        entityUrn: 'urn:li:msg_message:NORMAL_SHELL',
        convId: 'conv-normal',
        body: 'hello there',
        deliveredAt: 6000,
      });
      await handleRealtimeEvent(ev.eventType, ev.data);

      await vi.waitFor(() => {
        expect(shellNotifications(shell.port)).toHaveLength(1);
      });
      expect(shellNotifications(shell.port)[0][0]).toEqual(
        expect.objectContaining({
          type: 'SHOW_NOTIFICATION',
          conversationId: 'conv-normal',
          title: 'Alice Jones',
          body: 'hello there',
        })
      );
      // Shell handled it — the chrome.notifications fallback must stay quiet.
      expect(chrome.notifications.create).not.toHaveBeenCalled();
    } finally {
      shell.disconnect();
    }
  });
});
