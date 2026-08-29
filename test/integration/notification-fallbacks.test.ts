/**
 * Notification content and focus-state fallbacks in showNativeNotification
 * (event-handler.ts):
 *
 *  - An inbound message with an EMPTY body (attachment-only messages arrive
 *    this way) must still notify, with the 'New message' placeholder — on
 *    both the shell path and the chrome.notifications fallback.
 *  - An active app tab whose window has lost OS focus suppresses nothing:
 *    the notification still goes out via the shell when one is connected
 *    (regression 95 pinned the chrome-only variant).
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
    id: 'conv-fallback',
    participantUrns: ['urn:li:fsd_profile:ALICE'],
    participantNames: ['Alice Jones'],
    participantPictures: [''],
    lastMessage: 'earlier message',
    lastActivityAt: 5000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
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
  return { port, disconnect: () => disconnectListeners.forEach((fn) => fn()) };
}

const shellNotifications = (port: { postMessage: ReturnType<typeof vi.fn> }) =>
  port.postMessage.mock.calls.filter((c: any[]) => c[0]?.type === 'SHOW_NOTIFICATION');

beforeEach(async () => {
  testDb = new Dexie(`TestDB_notif_fallback_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.conversations.put(makeConversation());
  vi.mocked(chrome.tabs.query).mockResolvedValue([]);
  vi.mocked(chrome.notifications.create).mockClear();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('empty message body falls back to a placeholder', () => {
  it("chrome path: an attachment-only (empty-body) message notifies with 'New message'", async () => {
    const ev = buildMessageEvent({
      entityUrn: 'urn:li:msg_message:EMPTY_BODY',
      convId: 'conv-fallback',
      body: '',
      deliveredAt: 6000,
    });
    await handleRealtimeEvent(ev.eventType, ev.data);

    await vi.waitFor(() => {
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'conv-fallback',
        expect.objectContaining({ title: 'Alice Jones', message: 'New message' })
      );
    });
  });

  it("shell path: the placeholder is applied before the message crosses the port", async () => {
    const shell = connectNotifyingShell();
    try {
      const ev = buildMessageEvent({
        entityUrn: 'urn:li:msg_message:EMPTY_BODY_SHELL',
        convId: 'conv-fallback',
        body: '',
        deliveredAt: 7000,
      });
      await handleRealtimeEvent(ev.eventType, ev.data);

      await vi.waitFor(() => {
        expect(shellNotifications(shell.port)).toHaveLength(1);
      });
      // The shell renders whatever it is handed — the extension must not
      // ship it an empty string and hope the shell has its own fallback.
      expect(shellNotifications(shell.port)[0][0]).toEqual(
        expect.objectContaining({ body: 'New message' })
      );
      expect(chrome.notifications.create).not.toHaveBeenCalled();
    } finally {
      shell.disconnect();
    }
  });
});

describe('unfocused window does not suppress the shell path', () => {
  it('active app tab + window without OS focus → notification still goes out via the shell', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([{ id: 1, active: true } as any]);
    vi.mocked(chrome.windows.getLastFocused).mockResolvedValue({ focused: false } as any);

    const shell = connectNotifyingShell();
    try {
      const ev = buildMessageEvent({
        entityUrn: 'urn:li:msg_message:UNFOCUSED_SHELL',
        convId: 'conv-fallback',
        body: 'pssst',
        deliveredAt: 8000,
      });
      await handleRealtimeEvent(ev.eventType, ev.data);

      await vi.waitFor(() => {
        expect(shellNotifications(shell.port)).toHaveLength(1);
      });
      expect(shellNotifications(shell.port)[0][0]).toEqual(
        expect.objectContaining({ conversationId: 'conv-fallback', body: 'pssst' })
      );
      expect(chrome.notifications.create).not.toHaveBeenCalled();
    } finally {
      shell.disconnect();
    }
  });
});
