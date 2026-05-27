import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Message } from '@/types/message';
import type { Conversation } from '@/types/conversation';

// ── Test DB setup ────────────────────────────────────────────────────────────
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

vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
}));

vi.mock('@/lib/feature-flags', () => ({
  ENABLE_PROFILE_ENRICHMENT: false,
}));

vi.mock('../../entrypoints/background/realtime/mark-read-suppression', () => ({
  shouldSuppressConversationUpdate: vi.fn().mockReturnValue(false),
}));

// Mock normalizeMessages so we can control its output in conversation update tests
vi.mock('@/lib/voyager-normalizer', () => ({
  normalizeMessages: vi.fn().mockReturnValue([]),
}));

beforeEach(async () => {
  testDb = new Dexie(`TestDB_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const MEMBER_URN = 'urn:li:fsd_profile:SELF';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-001',
    participantUrns: ['urn:li:fsd_profile:OTHER'],
    participantNames: ['Other User'],
    participantPictures: ['https://example.com/pic.jpg'],
    lastMessage: 'Hello',
    lastActivityAt: 1000,
    read: 1,
    archived: 0,
    category: 'PRIMARY_INBOX',
    hasAttachments: 0,
    starred: 0,
    ...overrides,
  };
}

/**
 * Build a DecoratedEvent wrapping com.linkedin.messenger.Message entities.
 * This is the new Messenger API shape used by SSE.
 */
function buildMessengerMessageEvent(messages: Array<{
  entityUrn: string;
  conversationUrn: string;
  senderProfileId: string;
  senderFirstName?: string;
  senderLastName?: string;
  body: string;
  deliveredAt: number;
}>): { eventType: string; data: any } {
  const included: any[] = [];

  for (const msg of messages) {
    const participantUrn = `urn:li:msg_messagingParticipant:urn:li:fsd_profile:${msg.senderProfileId}`;

    included.push({
      $type: 'com.linkedin.messenger.MessagingParticipant',
      entityUrn: participantUrn,
      hostIdentityUrn: `urn:li:fsd_profile:${msg.senderProfileId}`,
      participantType: {
        member: {
          firstName: { text: msg.senderFirstName || 'User' },
          lastName: { text: msg.senderLastName || msg.senderProfileId },
        },
      },
    });

    included.push({
      $type: 'com.linkedin.messenger.Message',
      entityUrn: msg.entityUrn,
      body: { text: msg.body },
      deliveredAt: msg.deliveredAt,
      '*sender': participantUrn,
      '*conversation': msg.conversationUrn,
    });
  }

  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: {
          data: { included },
        },
      },
    },
  };
}

/**
 * Build a DecoratedEvent wrapping a SeenReceipt.
 */
function buildSeenReceiptEvent(receipt: {
  messageUrn: string;
  seenAt: number;
}): { eventType: string; data: any } {
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: {
          data: {
            included: [
              {
                $type: 'com.linkedin.messenger.SeenReceipt',
                '*message': receipt.messageUrn,
                seenAt: receipt.seenAt,
              },
            ],
          },
        },
      },
    },
  };
}

/**
 * Build a DecoratedEvent wrapping a RealtimeConversation entity.
 */
function buildConversationUpdateEvent(opts: {
  conversationUrn: string;
  unreadCount: number;
}): { eventType: string; data: any } {
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: {
          data: {
            included: [
              {
                $type: 'com.linkedin.voyager.messaging.realtime.RealtimeConversation',
                '*conversation': opts.conversationUrn,
                unreadConversationsCount: opts.unreadCount,
              },
            ],
          },
        },
      },
    },
  };
}

/**
 * Build a DecoratedEvent wrapping a TypingIndicator.
 */
function buildTypingIndicatorEvent(): { eventType: string; data: any } {
  return {
    eventType: 'event',
    data: {
      'com.linkedin.realtimefrontend.DecoratedEvent': {
        topic: '/messaging',
        payload: {
          data: {
            included: [
              {
                $type: 'com.linkedin.messenger.TypingIndicator',
                conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,2-conv001)',
              },
            ],
          },
        },
      },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('event-handler', () => {
  describe('heartbeat events', () => {
    it('ignores heartbeat events silently', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      await handleRealtimeEvent('event', {
        'com.linkedin.realtimefrontend.Heartbeat': {},
      });

      // Should not throw, should not store anything to DB
      const messages = await testDb.messages.toArray();
      expect(messages).toHaveLength(0);
    });
  });

  describe('Messenger API messages (DecoratedEvent with com.linkedin.messenger.Message)', () => {
    it('extracts message, stores to DB, and updates conversation preview', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      // Pre-insert conversation so update logic applies
      await testDb.conversations.put(makeConversation({
        id: 'conv-001',
        lastActivityAt: 1000,
        lastMessage: 'Old message',
        read: 1,
      }));

      const { eventType, data } = buildMessengerMessageEvent([
        {
          entityUrn: 'urn:li:msg_message:MSG001',
          conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,conv-001)',
          senderProfileId: 'OTHER',
          body: 'Hello from SSE',
          deliveredAt: 5000,
        },
      ]);

      await handleRealtimeEvent(eventType, data);

      // Message stored
      const msg = await testDb.messages.get('urn:li:msg_message:MSG001');
      expect(msg).toBeDefined();
      expect(msg.body).toBe('Hello from SSE');
      expect(msg.conversationId).toBe('conv-001');

      // Conversation preview updated
      const conv = await testDb.conversations.get('conv-001');
      expect(conv.lastMessage).toBe('Hello from SSE');
      expect(conv.lastActivityAt).toBe(5000);
    });

    it('sets isFromMe=true when sender matches memberUrn', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      await testDb.conversations.put(makeConversation({ id: 'conv-me' }));

      const { eventType, data } = buildMessengerMessageEvent([
        {
          entityUrn: 'urn:li:msg_message:MY_MSG',
          conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,conv-me)',
          senderProfileId: 'SELF',
          body: 'My own message',
          deliveredAt: 6000,
        },
      ]);

      await handleRealtimeEvent(eventType, data);

      const msg = await testDb.messages.get('urn:li:msg_message:MY_MSG');
      expect(msg.isFromMe).toBe(true);
    });

    it('marks conversation as unread (read=0) for inbound messages', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      await testDb.conversations.put(makeConversation({
        id: 'conv-unread',
        read: 1,
        lastActivityAt: 1000,
      }));

      const { eventType, data } = buildMessengerMessageEvent([
        {
          entityUrn: 'urn:li:msg_message:INBOUND',
          conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,conv-unread)',
          senderProfileId: 'ALICE',
          body: 'Hey there',
          deliveredAt: 7000,
        },
      ]);

      await handleRealtimeEvent(eventType, data);

      const conv = await testDb.conversations.get('conv-unread');
      expect(conv.read).toBe(0);
    });

    it('does NOT mark as unread for own messages (isFromMe)', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      await testDb.conversations.put(makeConversation({
        id: 'conv-own',
        read: 1,
        lastActivityAt: 1000,
      }));

      const { eventType, data } = buildMessengerMessageEvent([
        {
          entityUrn: 'urn:li:msg_message:OWN',
          conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,conv-own)',
          senderProfileId: 'SELF',
          body: 'My message should not mark unread',
          deliveredAt: 8000,
        },
      ]);

      await handleRealtimeEvent(eventType, data);

      const conv = await testDb.conversations.get('conv-own');
      // read should remain 1 since only own messages arrived
      expect(conv.read).toBe(1);
    });

    it('sends INCOMING_MESSAGE notification for inbound messages only', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      await testDb.conversations.put(makeConversation({ id: 'conv-notify' }));

      // Inbound message
      const { eventType, data } = buildMessengerMessageEvent([
        {
          entityUrn: 'urn:li:msg_message:NOTIFY',
          conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,conv-notify)',
          senderProfileId: 'BOB',
          senderFirstName: 'Bob',
          senderLastName: 'Smith',
          body: 'New message for you',
          deliveredAt: 9000,
        },
      ]);

      await handleRealtimeEvent(eventType, data);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'INCOMING_MESSAGE',
          body: 'New message for you',
          conversationId: 'conv-notify',
        })
      );
    });

    it('does NOT send INCOMING_MESSAGE for own messages', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      await testDb.conversations.put(makeConversation({ id: 'conv-no-notify' }));

      const { eventType, data } = buildMessengerMessageEvent([
        {
          entityUrn: 'urn:li:msg_message:SELF_ONLY',
          conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,conv-no-notify)',
          senderProfileId: 'SELF',
          body: 'My own message',
          deliveredAt: 10000,
        },
      ]);

      // Reset sendMessage mock tracking
      vi.mocked(chrome.runtime.sendMessage).mockClear();

      await handleRealtimeEvent(eventType, data);

      // Should NOT have sent INCOMING_MESSAGE
      const calls = vi.mocked(chrome.runtime.sendMessage).mock.calls;
      const incomingCalls = calls.filter(
        (c: any) => c[0]?.type === 'INCOMING_MESSAGE'
      );
      expect(incomingCalls).toHaveLength(0);
    });

    it('creates minimal conversation when conv does not exist in DB', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      // Do NOT pre-insert a conversation
      const { eventType, data } = buildMessengerMessageEvent([
        {
          entityUrn: 'urn:li:msg_message:NEW_CONV_MSG',
          conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:SELF,conv-new)',
          senderProfileId: 'CHARLIE',
          senderFirstName: 'Charlie',
          senderLastName: 'Brown',
          body: 'First message in new conv',
          deliveredAt: 11000,
        },
      ]);

      await handleRealtimeEvent(eventType, data);

      const conv = await testDb.conversations.get('conv-new');
      expect(conv).toBeDefined();
      expect(conv.lastMessage).toBe('First message in new conv');
      expect(conv.read).toBe(0);
      expect(conv.archived).toBe(0);
      expect(conv.category).toBe('PRIMARY_INBOX');
      expect(conv.participantUrns).toContain('urn:li:fsd_profile:CHARLIE');
    });
  });

  describe('read receipts (SeenReceipt)', () => {
    it('updates message seenAt when receipt is newer', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      // Pre-insert a message without seenAt
      const msg: Message = {
        id: 'urn:li:msg_message:SEEN_MSG',
        conversationId: 'conv-seen',
        senderUrn: MEMBER_URN,
        senderName: 'Me',
        senderPicture: '',
        body: 'Read this',
        createdAt: 5000,
        isFromMe: true,
      };
      await testDb.messages.put(msg);

      const { eventType, data } = buildSeenReceiptEvent({
        messageUrn: 'urn:li:msg_message:SEEN_MSG',
        seenAt: 12000,
      });

      await handleRealtimeEvent(eventType, data);

      const updated = await testDb.messages.get('urn:li:msg_message:SEEN_MSG');
      expect(updated.seenAt).toBe(12000);
    });

    it('does not overwrite seenAt with an older timestamp', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      const msg: Message = {
        id: 'urn:li:msg_message:ALREADY_SEEN',
        conversationId: 'conv-seen2',
        senderUrn: MEMBER_URN,
        senderName: 'Me',
        senderPicture: '',
        body: 'Already read',
        createdAt: 5000,
        isFromMe: true,
        seenAt: 15000,
      };
      await testDb.messages.put(msg);

      const { eventType, data } = buildSeenReceiptEvent({
        messageUrn: 'urn:li:msg_message:ALREADY_SEEN',
        seenAt: 10000, // older than existing seenAt
      });

      await handleRealtimeEvent(eventType, data);

      const updated = await testDb.messages.get('urn:li:msg_message:ALREADY_SEEN');
      expect(updated.seenAt).toBe(15000); // unchanged
    });
  });

  describe('conversation update (RealtimeConversation)', () => {
    it('marks conversation as read when unreadCount=0 (read on another client)', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );
      const { fetchMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      vi.mocked(fetchMessages).mockClear();

      await testDb.conversations.put(makeConversation({ id: 'conv-noread', read: 0 }));

      const { eventType, data } = buildConversationUpdateEvent({
        conversationUrn: 'urn:li:fs_conversation:conv-noread',
        unreadCount: 0,
      });

      await handleRealtimeEvent(eventType, data);

      // Should not fetch messages (no new content)
      expect(fetchMessages).not.toHaveBeenCalled();
      // Should mark conversation as read
      const conv = await testDb.conversations.get('conv-noread');
      expect(conv.read).toBe(1);
    });

    it('does not mark as read when unreadCount=0 and suppressed (our own echo)', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );
      const { shouldSuppressConversationUpdate } = await import(
        '../../entrypoints/background/realtime/mark-read-suppression'
      );

      vi.mocked(shouldSuppressConversationUpdate).mockReturnValue(true);

      await testDb.conversations.put(makeConversation({ id: 'conv-suppressed-0', read: 0 }));

      const { eventType, data } = buildConversationUpdateEvent({
        conversationUrn: 'urn:li:fs_conversation:conv-suppressed-0',
        unreadCount: 0,
      });

      await handleRealtimeEvent(eventType, data);

      // Should NOT change read state when suppressed
      const conv = await testDb.conversations.get('conv-suppressed-0');
      expect(conv.read).toBe(0);

      vi.mocked(shouldSuppressConversationUpdate).mockReturnValue(false);
    });

    it('suppresses events when shouldSuppressConversationUpdate returns true', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );
      const { shouldSuppressConversationUpdate } = await import(
        '../../entrypoints/background/realtime/mark-read-suppression'
      );
      const { fetchMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { normalizeMessages } = await import('@/lib/voyager-normalizer');

      vi.mocked(shouldSuppressConversationUpdate).mockReturnValue(true);
      vi.mocked(fetchMessages).mockClear();
      vi.mocked(fetchMessages).mockResolvedValue({ data: {}, included: [] });
      vi.mocked(normalizeMessages).mockReturnValue([]);

      await testDb.conversations.put(makeConversation({
        id: 'conv-suppress',
        lastActivityAt: 1000,
        read: 1,
      }));

      const { eventType, data } = buildConversationUpdateEvent({
        conversationUrn: 'urn:li:fs_conversation:conv-suppress',
        unreadCount: 3,
      });

      await handleRealtimeEvent(eventType, data);

      // fetchMessages WILL still be called (the handler fetches but passes suppressed=true).
      // The key behavior is that the conversation read status is NOT changed.
      // We need to wait for the async fetchLatestForConversation to complete.
      await vi.waitFor(async () => {
        expect(fetchMessages).toHaveBeenCalled();
      });

      // Reset for other tests
      vi.mocked(shouldSuppressConversationUpdate).mockReturnValue(false);
    });

    it('skips archived conversations', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );
      const { fetchMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      vi.mocked(fetchMessages).mockClear();

      await testDb.conversations.put(makeConversation({
        id: 'conv-archived',
        archived: 1,
      }));

      const { eventType, data } = buildConversationUpdateEvent({
        conversationUrn: 'urn:li:fs_conversation:conv-archived',
        unreadCount: 1,
      });

      await handleRealtimeEvent(eventType, data);

      // Should not fetch messages for archived conversations
      // Give the async handler a moment
      await new Promise((r) => setTimeout(r, 50));
      expect(fetchMessages).not.toHaveBeenCalled();
    });

    it('fetches latest messages for non-archived conversations', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );
      const { fetchMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { normalizeMessages } = await import('@/lib/voyager-normalizer');

      vi.mocked(fetchMessages).mockClear();
      vi.mocked(fetchMessages).mockResolvedValue({ data: {}, included: [] });
      vi.mocked(normalizeMessages).mockReturnValue([]);

      await testDb.conversations.put(makeConversation({
        id: 'conv-fetch',
        archived: 0,
      }));

      const { eventType, data } = buildConversationUpdateEvent({
        conversationUrn: 'urn:li:fs_conversation:conv-fetch',
        unreadCount: 2,
      });

      await handleRealtimeEvent(eventType, data);

      // Wait for async fetch
      await vi.waitFor(async () => {
        expect(fetchMessages).toHaveBeenCalledWith(
          'conv-fetch',
          20,
          0,
          { skipJitter: true }
        );
      });
    });
  });

  describe('deduplication of fetchLatestForConversation (_inflightConvFetches)', () => {
    it('deduplicates concurrent fetchLatestForConversation calls', async () => {
      // Use resetModules to get fresh module state with a clean _inflightConvFetches Map
      vi.resetModules();

      const { fetchMessages } = await import(
        '../../entrypoints/background/api/messages'
      );
      const { normalizeMessages } = await import('@/lib/voyager-normalizer');
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      let fetchCallCount = 0;
      vi.mocked(fetchMessages).mockImplementation(async () => {
        fetchCallCount++;
        // Add a delay so both calls can be in-flight simultaneously
        await new Promise((r) => setTimeout(r, 100));
        return { data: {}, included: [] };
      });
      vi.mocked(normalizeMessages).mockReturnValue([]);

      await testDb.conversations.put(makeConversation({
        id: 'conv-dedup',
        archived: 0,
      }));

      // Fire two conversation update events for the same conversation concurrently
      const event1 = buildConversationUpdateEvent({
        conversationUrn: 'urn:li:fs_conversation:conv-dedup',
        unreadCount: 1,
      });
      const event2 = buildConversationUpdateEvent({
        conversationUrn: 'urn:li:fs_conversation:conv-dedup',
        unreadCount: 2,
      });

      const p1 = handleRealtimeEvent(event1.eventType, event1.data);
      const p2 = handleRealtimeEvent(event2.eventType, event2.data);

      await Promise.all([p1, p2]);

      // Wait for async operations
      await new Promise((r) => setTimeout(r, 200));

      // Should only have fetched once due to deduplication
      expect(fetchCallCount).toBe(1);
    });
  });

  describe('optimistic message cleanup', () => {
    it('deletes temp-* messages when real message arrives with matching body', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      const convId = 'conv-optimistic';
      await testDb.conversations.put(makeConversation({ id: convId }));

      // Pre-insert a temp optimistic message
      await testDb.messages.put({
        id: 'temp-abc123',
        conversationId: convId,
        senderUrn: MEMBER_URN,
        senderName: 'Me',
        senderPicture: '',
        body: 'Optimistic message',
        createdAt: 5000,
        isFromMe: true,
      });

      // SSE delivers the real message with matching body, from the same user (isFromMe)
      const { eventType, data } = buildMessengerMessageEvent([
        {
          entityUrn: 'urn:li:msg_message:REAL_MSG',
          conversationUrn: `urn:li:msg_conversation:(${MEMBER_URN},${convId})`,
          senderProfileId: 'SELF',
          body: 'Optimistic message',
          deliveredAt: 6000,
        },
      ]);

      await handleRealtimeEvent(eventType, data);

      // Temp message should be deleted
      const temp = await testDb.messages.get('temp-abc123');
      expect(temp).toBeUndefined();

      // Real message should exist
      const real = await testDb.messages.get('urn:li:msg_message:REAL_MSG');
      expect(real).toBeDefined();
      expect(real.body).toBe('Optimistic message');
    });

    it('only cleans up messages from current user (isFromMe)', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      const convId = 'conv-no-cleanup';
      await testDb.conversations.put(makeConversation({ id: convId }));

      // Insert a temp message from current user with a different body
      await testDb.messages.put({
        id: 'temp-xyz',
        conversationId: convId,
        senderUrn: MEMBER_URN,
        senderName: 'Me',
        senderPicture: '',
        body: 'Different body',
        createdAt: 5000,
        isFromMe: true,
      });

      // SSE delivers a message from someone else (not isFromMe)
      const { eventType, data } = buildMessengerMessageEvent([
        {
          entityUrn: 'urn:li:msg_message:OTHER_MSG',
          conversationUrn: `urn:li:msg_conversation:(${MEMBER_URN},${convId})`,
          senderProfileId: 'OTHER',
          body: 'Different body',
          deliveredAt: 7000,
        },
      ]);

      await handleRealtimeEvent(eventType, data);

      // Temp message should remain because the real message is NOT from me
      // (cleanup only runs for isFromMe messages)
      const temp = await testDb.messages.get('temp-xyz');
      expect(temp).toBeDefined();
    });
  });

  describe('typing indicators', () => {
    it('ignores typing indicators (does not store them)', async () => {
      const { handleRealtimeEvent } = await import(
        '../../entrypoints/background/realtime/event-handler'
      );

      const { eventType, data } = buildTypingIndicatorEvent();

      await handleRealtimeEvent(eventType, data);

      // No messages should be stored
      const messages = await testDb.messages.toArray();
      expect(messages).toHaveLength(0);

      // No conversations should be created
      const conversations = await testDb.conversations.toArray();
      expect(conversations).toHaveLength(0);
    });
  });
});
