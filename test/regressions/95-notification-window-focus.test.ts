/**
 * Regression: native notifications were suppressed whenever the inflow tab was
 * the active tab in the LAST-focused Chrome window — but `lastFocusedWindow`
 * matches even when Chrome is not the frontmost app. Cmd-Tabbing to another
 * app with inflow left active meant new messages produced no OS notification,
 * only an in-app toast in a window the user wasn't looking at.
 *
 * Fix: suppression additionally requires chrome.windows.getLastFocused() to
 * report focused: true.
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

vi.mock('../../entrypoints/background/api/profiles', () => ({
  fetchProfileByUrn: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/background/api/messages', () => ({
  fetchMessages: vi.fn().mockResolvedValue({ data: {}, included: [] }),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

vi.mock('@/lib/feature-flags', () => ({ ENABLE_PROFILE_ENRICHMENT: false }));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  shouldSuppressConversationUpdate: vi.fn().mockReturnValue(false),
  isMutationSuppressed: vi.fn().mockReturnValue(false),
  recordMutation: vi.fn(),
  recordMarkRead: vi.fn(),
}));

import { handleRealtimeEvent } from '../../entrypoints/background/realtime/event-handler';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-focus',
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

function flush(ms = 25) {
  return new Promise((r) => setTimeout(r, ms));
}

/** The app tab, active in the last-focused window. */
const ACTIVE_APP_TAB = [{ id: 1, active: true }] as any;

beforeEach(async () => {
  testDb = new Dexie(`TestDB_95_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.conversations.put(makeConversation());
  vi.mocked(chrome.notifications.create).mockClear();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('native notification suppression requires real window focus', () => {
  it('suppresses when the inflow tab is active AND its window has OS focus', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue(ACTIVE_APP_TAB);
    vi.mocked(chrome.windows.getLastFocused).mockResolvedValue({ focused: true } as any);

    const ev = buildMessageEvent({ entityUrn: 'urn:li:msg_message:F1', convId: 'conv-focus', body: 'hi', deliveredAt: 6000 });
    await handleRealtimeEvent(ev.eventType, ev.data);
    await flush();

    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('notifies when the inflow tab is active but Chrome is not the frontmost app', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue(ACTIVE_APP_TAB);
    vi.mocked(chrome.windows.getLastFocused).mockResolvedValue({ focused: false } as any);

    const ev = buildMessageEvent({ entityUrn: 'urn:li:msg_message:F2', convId: 'conv-focus', body: 'hello?', deliveredAt: 7000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    await vi.waitFor(() => {
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'conv-focus',
        expect.objectContaining({ title: 'Alice Jones' })
      );
    });
  });

  it('still notifies when getLastFocused rejects (best-effort suppression)', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue(ACTIVE_APP_TAB);
    vi.mocked(chrome.windows.getLastFocused).mockRejectedValue(new Error('no window'));

    const ev = buildMessageEvent({ entityUrn: 'urn:li:msg_message:F3', convId: 'conv-focus', body: 'anyone?', deliveredAt: 8000 });
    await handleRealtimeEvent(ev.eventType, ev.data);

    await vi.waitFor(() => {
      expect(chrome.notifications.create).toHaveBeenCalled();
    });
  });
});
