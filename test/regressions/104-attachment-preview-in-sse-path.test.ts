/**
 * Regression: the SSE message path set the conversation preview for
 * attachment-only messages to the generic "New message", while the
 * conversations-sync path describes them ("Sent an image", "Sent a file: …").
 * A photo or file arriving live showed "New message" in the list until the
 * next full sync rewrote it.
 *
 * Fix: the SSE conversation-update paths derive the preview from the
 * normalized message's attachments via messagePreviewText, mirroring the
 * sync path's lastMessageFallback strings.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Conversation } from '@/types/conversation';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return { ...original, get db() { return testDb; } };
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

import {
  handleRealtimeEvent,
  __resetInboundReadState,
} from '../../entrypoints/background/realtime/event-handler';

const MEMBER_URN = 'urn:li:fsd_profile:SELF';
const CONV_ID = '2-attach';
const CONV_URN = `urn:li:msg_conversation:(${MEMBER_URN},${CONV_ID})`;

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONV_ID,
    participantUrns: ['urn:li:fsd_profile:OTHER'],
    participantNames: ['Other User'],
    participantPictures: [''],
    lastMessage: 'hello',
    lastActivityAt: 1000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

function buildAttachmentMessageEvent(convUrn: string, renderContent: any[]) {
  const participantUrn = 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:OTHER';
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
                hostIdentityUrn: 'urn:li:fsd_profile:OTHER',
                participantType: { member: { firstName: { text: 'Other' }, lastName: { text: 'User' } } },
              },
              {
                $type: 'com.linkedin.messenger.Message',
                entityUrn: `urn:li:msg_message:(${CONV_ID},att-${Math.random().toString(36).slice(2)})`,
                body: { text: '' },
                deliveredAt: 2000,
                renderContent,
                '*sender': participantUrn,
                '*conversation': convUrn,
              },
            ],
          },
        },
      },
    },
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_104_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  __resetInboundReadState();
});

afterEach(async () => {
  __resetInboundReadState();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('attachment-only message preview via SSE', () => {
  it('an image-only message previews as "Sent an image" on an existing conversation', async () => {
    await testDb.conversations.put(makeConversation());

    const ev = buildAttachmentMessageEvent(CONV_URN, [
      { vectorImage: { rootUrl: 'https://cdn.example/img.jpg' } },
    ]);
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).lastMessage).toBe('Sent an image');
  });

  it('a file-only message previews with the file name when seeding a new conversation', async () => {
    const ev = buildAttachmentMessageEvent(CONV_URN, [
      { file: { name: 'resume.pdf', url: 'https://cdn.example/resume.pdf' } },
    ]);
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).lastMessage).toBe('Sent a file: resume.pdf');
  });

  it('a message with body text still previews the text', async () => {
    await testDb.conversations.put(makeConversation());

    const ev = buildAttachmentMessageEvent(CONV_URN, [
      { vectorImage: { rootUrl: 'https://cdn.example/img.jpg' } },
    ]);
    ev.data['com.linkedin.realtimefrontend.DecoratedEvent'].payload.data.included[1].body = {
      text: 'check this out',
    };
    await handleRealtimeEvent(ev.eventType, ev.data);

    expect((await testDb.conversations.get(CONV_ID)).lastMessage).toBe('check this out');
  });
});
