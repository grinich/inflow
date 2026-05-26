import { normalizeConversations, normalizeMessages } from '@/lib/voyager-normalizer';
import type { VoyagerResponse } from '@/types/voyager';

// ---------------------------------------------------------------------------
// Helper: build a minimal MessagingParticipant entity
// ---------------------------------------------------------------------------
function makeParticipant(opts: {
  entityUrn: string;
  hostIdentityUrn?: string;
  firstName: string;
  lastName: string;
  headline?: string;
  profileUrl?: string;
}) {
  return {
    $type: 'com.linkedin.messenger.MessagingParticipant' as const,
    entityUrn: opts.entityUrn,
    hostIdentityUrn: opts.hostIdentityUrn || opts.entityUrn,
    participantType: {
      member: {
        firstName: { text: opts.firstName },
        lastName: { text: opts.lastName },
        headline: opts.headline ? { text: opts.headline } : undefined,
        profileUrl: opts.profileUrl,
        profilePicture: undefined,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: build a minimal Conversation entity
// ---------------------------------------------------------------------------
function makeConversation(opts: {
  entityUrn: string;
  participantRefs: string[];
  lastActivityAt?: number;
  unreadCount?: number;
  categories?: string[];
}) {
  return {
    $type: 'com.linkedin.messenger.Conversation' as const,
    entityUrn: opts.entityUrn,
    '*conversationParticipants': opts.participantRefs,
    lastActivityAt: opts.lastActivityAt ?? 1700000000000,
    unreadCount: opts.unreadCount ?? 0,
    categories: opts.categories ?? ['INBOX', 'PRIMARY_INBOX'],
  };
}

// ---------------------------------------------------------------------------
// Helper: build a minimal Message entity
// ---------------------------------------------------------------------------
function makeMessage(opts: {
  entityUrn: string;
  conversationUrn?: string;
  senderRef: string;
  body?: string;
  deliveredAt?: number;
  renderContent?: any[];
  editedAt?: number;
  lastEditedAt?: number;
  seenReceipts?: any[];
  '*seenReceipts'?: string[];
  repliedMessageContent?: any;
}) {
  return {
    $type: 'com.linkedin.messenger.Message' as const,
    entityUrn: opts.entityUrn,
    '*conversation': opts.conversationUrn,
    '*sender': opts.senderRef,
    body: opts.body !== undefined ? { text: opts.body } : { text: '' },
    deliveredAt: opts.deliveredAt ?? 1700000000000,
    renderContent: opts.renderContent,
    editedAt: opts.editedAt,
    lastEditedAt: opts.lastEditedAt,
    seenReceipts: opts.seenReceipts,
    '*seenReceipts': opts['*seenReceipts'],
  };
}

// ============================================================================
// normalizeConversations
// ============================================================================
describe('normalizeConversations()', () => {
  const MY_URN = 'urn:li:fsd_profile:ME123';
  const participantAlice = makeParticipant({
    entityUrn: 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:ALICE',
    hostIdentityUrn: 'urn:li:fsd_profile:ALICE',
    firstName: 'Alice',
    lastName: 'Smith',
    headline: 'Engineer',
    profileUrl: 'https://www.linkedin.com/in/alice-smith',
  });
  const participantMe = makeParticipant({
    entityUrn: 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:ME123',
    hostIdentityUrn: 'urn:li:fsd_profile:ME123',
    firstName: 'Current',
    lastName: 'User',
  });

  it('extracts conversation ID from entityUrn', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeConversation({
          entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:XXX,2-abc123)',
          participantRefs: [participantAlice.entityUrn],
        }),
      ],
    };

    const { conversations } = normalizeConversations(response);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe('2-abc123');
  });

  it('extracts conversation ID with base64 padding', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeConversation({
          entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:XXX,2-abc123==)',
          participantRefs: [participantAlice.entityUrn],
        }),
      ],
    };

    const { conversations } = normalizeConversations(response);
    expect(conversations[0].id).toBe('2-abc123==');
  });

  it('maps participant names, URNs, and pictures', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeConversation({
          entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
          participantRefs: [participantAlice.entityUrn],
        }),
      ],
    };

    const { conversations } = normalizeConversations(response);
    expect(conversations[0].participantNames).toEqual(['Alice Smith']);
    expect(conversations[0].participantUrns).toEqual(['urn:li:fsd_profile:ALICE']);
  });

  it('excludes current user when myMemberUrn is provided', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        participantMe,
        makeConversation({
          entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:ME123,2-conv)',
          participantRefs: [participantAlice.entityUrn, participantMe.entityUrn],
        }),
      ],
    };

    const { conversations } = normalizeConversations(response, MY_URN);
    expect(conversations[0].participantNames).toEqual(['Alice Smith']);
    expect(conversations[0].participantUrns).toEqual(['urn:li:fsd_profile:ALICE']);
  });

  it('includes all participants when myMemberUrn is not provided', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        participantMe,
        makeConversation({
          entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:ME123,2-conv)',
          participantRefs: [participantAlice.entityUrn, participantMe.entityUrn],
        }),
      ],
    };

    const { conversations } = normalizeConversations(response);
    expect(conversations[0].participantNames).toHaveLength(2);
    expect(conversations[0].participantNames).toContain('Alice Smith');
    expect(conversations[0].participantNames).toContain('Current User');
  });

  it('extracts last message text from Message entities', () => {
    const convUrn = 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)';
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeConversation({
          entityUrn: convUrn,
          participantRefs: [participantAlice.entityUrn],
        }),
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,100)',
          conversationUrn: convUrn,
          senderRef: participantAlice.entityUrn,
          body: 'Hello there!',
          deliveredAt: 1700000000000,
        }),
      ],
    };

    const { conversations } = normalizeConversations(response);
    expect(conversations[0].lastMessage).toBe('Hello there!');
  });

  it('picks the most recent message when multiple exist', () => {
    const convUrn = 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)';
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeConversation({
          entityUrn: convUrn,
          participantRefs: [participantAlice.entityUrn],
        }),
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,100)',
          conversationUrn: convUrn,
          senderRef: participantAlice.entityUrn,
          body: 'Old message',
          deliveredAt: 1700000000000,
        }),
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,200)',
          conversationUrn: convUrn,
          senderRef: participantAlice.entityUrn,
          body: 'Newest message',
          deliveredAt: 1700000001000,
        }),
      ],
    };

    const { conversations } = normalizeConversations(response);
    expect(conversations[0].lastMessage).toBe('Newest message');
  });

  describe('lastMessage fallbacks', () => {
    const convUrn = 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)';

    function buildResponseWithRenderContent(renderContent: any[]): VoyagerResponse {
      return {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: convUrn,
            participantRefs: [participantAlice.entityUrn],
          }),
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              conversationUrn: convUrn,
              senderRef: participantAlice.entityUrn,
              body: '',
              deliveredAt: 1700000000000,
            }),
            renderContent,
          },
        ],
      };
    }

    it('falls back to "Sent an image" for vectorImage', () => {
      const response = buildResponseWithRenderContent([{ vectorImage: { rootUrl: 'https://img.com/pic.jpg' } }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Sent an image');
    });

    it('falls back to "Sent a file: <name>" for file', () => {
      const response = buildResponseWithRenderContent([{ file: { name: 'report.pdf' } }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Sent a file: report.pdf');
    });

    it('falls back to "Sent a file: File" when file has no name', () => {
      const response = buildResponseWithRenderContent([{ file: {} }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Sent a file: File');
    });

    it('falls back to "Sent a video" for video', () => {
      const response = buildResponseWithRenderContent([{ video: { url: 'https://vid.com/v.mp4' } }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Sent a video');
    });

    it('falls back to "Sent an audio message" for audio', () => {
      const response = buildResponseWithRenderContent([{ audio: { url: 'https://audio.com/a.mp3' } }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Sent an audio message');
    });

    it('falls back to "Shared a post" for hostUrnData', () => {
      const response = buildResponseWithRenderContent([{ hostUrnData: { hostUrn: 'urn:li:activity:123' } }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Shared a post');
    });

    it('falls back to external media title for externalMedia', () => {
      const response = buildResponseWithRenderContent([{ externalMedia: { title: 'Cool Article' } }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Cool Article');
    });

    it('falls back to "Shared a link" for externalMedia without title', () => {
      const response = buildResponseWithRenderContent([{ externalMedia: {} }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Shared a link');
    });

    it('falls back to "Sent a GIF" for *externalMedia reference', () => {
      const response = buildResponseWithRenderContent([{ '*externalMedia': 'urn:li:msg_gif:123' }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Sent a GIF');
    });

    it('falls back to "Content no longer available" for unavailableContent', () => {
      const response = buildResponseWithRenderContent([{ unavailableContent: true }]);
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('Content no longer available');
    });

    it('returns empty string when no message matches the conversation', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: convUrn,
            participantRefs: [participantAlice.entityUrn],
          }),
        ],
      };
      const { conversations } = normalizeConversations(response);
      expect(conversations[0].lastMessage).toBe('');
    });
  });

  describe('read status', () => {
    it('sets read=1 when unreadCount is 0', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
            unreadCount: 0,
          }),
        ],
      };

      const { conversations } = normalizeConversations(response);
      expect(conversations[0].read).toBe(1);
    });

    it('sets read=0 when unreadCount > 0', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
            unreadCount: 3,
          }),
        ],
      };

      const { conversations } = normalizeConversations(response);
      expect(conversations[0].read).toBe(0);
    });
  });

  describe('archived status', () => {
    it('sets archived=1 when categories includes ARCHIVE', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
            categories: ['INBOX', 'ARCHIVE'],
          }),
        ],
      };

      const { conversations } = normalizeConversations(response);
      expect(conversations[0].archived).toBe(1);
    });

    it('sets archived=0 when categories does not include ARCHIVE', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
            categories: ['INBOX', 'PRIMARY_INBOX'],
          }),
        ],
      };

      const { conversations } = normalizeConversations(response);
      expect(conversations[0].archived).toBe(0);
    });
  });

  describe('category extraction', () => {
    it('extracts category from categories (excluding INBOX)', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
            categories: ['INBOX', 'OTHER'],
          }),
        ],
      };

      const { conversations } = normalizeConversations(response);
      expect(conversations[0].category).toBe('OTHER');
    });

    it('defaults to PRIMARY_INBOX when only INBOX is in categories', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
            categories: ['INBOX'],
          }),
        ],
      };

      const { conversations } = normalizeConversations(response);
      expect(conversations[0].category).toBe('PRIMARY_INBOX');
    });

    it('defaults to PRIMARY_INBOX when categories is empty', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
            categories: [],
          }),
        ],
      };

      const { conversations } = normalizeConversations(response);
      expect(conversations[0].category).toBe('PRIMARY_INBOX');
    });

    it('handles INMAIL category', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
            categories: ['INBOX', 'INMAIL'],
          }),
        ],
      };

      const { conversations } = normalizeConversations(response);
      expect(conversations[0].category).toBe('INMAIL');
    });
  });

  describe('profiles', () => {
    it('builds Profile objects from participant data', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
          }),
        ],
      };

      const { profiles } = normalizeConversations(response);
      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toMatchObject({
        urn: 'urn:li:fsd_profile:ALICE',
        firstName: 'Alice',
        lastName: 'Smith',
        fullName: 'Alice Smith',
        occupation: 'Engineer',
      });
    });

    it('extracts publicId from profileUrl', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeConversation({
            entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
            participantRefs: [participantAlice.entityUrn],
          }),
        ],
      };

      const { profiles } = normalizeConversations(response);
      expect(profiles[0].publicId).toBe('alice-smith');
    });
  });

  it('returns empty arrays when no conversations in response', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [],
    };

    const { conversations, profiles } = normalizeConversations(response);
    expect(conversations).toEqual([]);
    expect(profiles).toEqual([]);
  });

  it('sets lastActivityAt from the conversation entity', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeConversation({
          entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-conv)',
          participantRefs: [participantAlice.entityUrn],
          lastActivityAt: 1700000099000,
        }),
      ],
    };

    const { conversations } = normalizeConversations(response);
    expect(conversations[0].lastActivityAt).toBe(1700000099000);
  });
});

// ============================================================================
// normalizeMessages
// ============================================================================
describe('normalizeMessages()', () => {
  const participantAlice = makeParticipant({
    entityUrn: 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:ALICE',
    hostIdentityUrn: 'urn:li:fsd_profile:ALICE',
    firstName: 'Alice',
    lastName: 'Smith',
  });
  const participantBob = makeParticipant({
    entityUrn: 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:BOB',
    hostIdentityUrn: 'urn:li:fsd_profile:BOB',
    firstName: 'Bob',
    lastName: 'Jones',
  });

  it('extracts messages from included array', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,100)',
          senderRef: participantAlice.entityUrn,
          body: 'Hello!',
          deliveredAt: 1700000001000,
        }),
      ],
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('Hello!');
    expect(messages[0].id).toBe('urn:li:msg_message:(2-conv,100)');
    expect(messages[0].conversationId).toBe('2-conv');
  });

  it('resolves sender name from participant lookup', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,100)',
          senderRef: participantAlice.entityUrn,
          body: 'Hi',
          deliveredAt: 1700000001000,
        }),
      ],
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages[0].senderName).toBe('Alice Smith');
    expect(messages[0].senderUrn).toBe('urn:li:fsd_profile:ALICE');
  });

  it('defaults senderName to "Unknown" when participant not found', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,100)',
          senderRef: 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:GHOST',
          body: 'Boo',
          deliveredAt: 1700000001000,
        }),
      ],
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages[0].senderName).toBe('Unknown');
  });

  it('sorts messages by createdAt ascending', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,300)',
          senderRef: participantAlice.entityUrn,
          body: 'Third',
          deliveredAt: 1700000003000,
        }),
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,100)',
          senderRef: participantAlice.entityUrn,
          body: 'First',
          deliveredAt: 1700000001000,
        }),
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,200)',
          senderRef: participantAlice.entityUrn,
          body: 'Second',
          deliveredAt: 1700000002000,
        }),
      ],
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages.map((m) => m.body)).toEqual(['First', 'Second', 'Third']);
    expect(messages[0].createdAt).toBeLessThan(messages[1].createdAt);
    expect(messages[1].createdAt).toBeLessThan(messages[2].createdAt);
  });

  it('sets isFromMe to false (normalizer does not determine this)', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,100)',
          senderRef: participantAlice.entityUrn,
          body: 'Hi',
          deliveredAt: 1700000001000,
        }),
      ],
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages[0].isFromMe).toBe(false);
  });

  describe('attachment extraction', () => {
    it('extracts image attachments from vectorImage', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: '',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{ vectorImage: { rootUrl: 'https://img.linkedin.com/photo.jpg' } }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toMatchObject({
        type: 'image',
        imageUrl: 'https://img.linkedin.com/photo.jpg',
      });
    });

    it('extracts file attachments', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: '',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{
              file: {
                name: 'document.pdf',
                url: 'https://media.linkedin.com/doc.pdf',
                byteSize: 102400,
                mediaType: 'application/pdf',
              },
            }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toMatchObject({
        type: 'file',
        fileName: 'document.pdf',
        fileUrl: 'https://media.linkedin.com/doc.pdf',
        fileSize: 102400,
        mimeType: 'application/pdf',
      });
    });

    it('extracts video attachments', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: '',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{ video: { url: 'https://video.linkedin.com/v.mp4' } }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toMatchObject({
        type: 'video',
        fallbackText: 'Video',
      });
    });

    it('extracts audio attachments', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: '',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{ audio: { url: 'https://audio.linkedin.com/a.mp3' } }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toMatchObject({
        type: 'audio',
        externalUrl: 'https://audio.linkedin.com/a.mp3',
        fallbackText: 'Audio message',
      });
    });

    it('extracts shared post attachments from hostUrnData', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: 'Check this out',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{
              hostUrnData: {
                hostUrn: 'urn:li:activity:7654321',
                type: 'FEED_UPDATE',
              },
            }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toMatchObject({
        type: 'sharedPost',
        postUrn: 'urn:li:activity:7654321',
        externalUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7654321/',
        fallbackText: 'Shared a post',
      });
    });

    it('skips PREMIUM_INMAIL hostUrnData (not a real attachment)', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: 'InMail message',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{
              hostUrnData: {
                hostUrn: 'urn:li:premiumInmail:dummyId',
                type: 'PREMIUM_INMAIL',
              },
            }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toBeUndefined();
    });

    it('extracts GIF attachments from *externalMedia references', () => {
      const gifEntityUrn = 'urn:li:msg_externalMedia:(2-conv,gif-001)';
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            $type: 'com.linkedin.messenger.ExternalMedia',
            entityUrn: gifEntityUrn,
            title: 'Funny GIF',
            media: {
              url: 'https://media.tenor.com/funny.gif',
              originalWidth: 480,
              originalHeight: 270,
            },
          },
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: '',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{ '*externalMedia': gifEntityUrn }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toMatchObject({
        type: 'gif',
        imageUrl: 'https://media.tenor.com/funny.gif',
        fallbackText: 'Funny GIF',
        width: 480,
        height: 270,
      });
    });

    it('handles GIF reference when ExternalMedia entity is missing', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: '',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{ '*externalMedia': 'urn:li:missing:entity' }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toMatchObject({
        type: 'gif',
        fallbackText: 'GIF',
      });
    });

    it('extracts external media (inline link)', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: 'Check this link',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{
              externalMedia: {
                url: 'https://example.com/article',
                title: 'Great Article',
              },
            }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toMatchObject({
        type: 'externalMedia',
        externalUrl: 'https://example.com/article',
        fallbackText: 'Great Article',
      });
    });

    it('extracts unavailable content attachment', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: '',
              deliveredAt: 1700000001000,
            }),
            renderContent: [{ unavailableContent: true }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments![0]).toMatchObject({
        type: 'unknown',
        fallbackText: 'Content no longer available',
      });
    });

    it('omits attachments property when renderContent is empty', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeMessage({
            entityUrn: 'urn:li:msg_message:(2-conv,100)',
            senderRef: participantAlice.entityUrn,
            body: 'Just text',
            deliveredAt: 1700000001000,
          }),
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toBeUndefined();
    });

    it('handles multiple attachments in one message', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: '',
              deliveredAt: 1700000001000,
            }),
            renderContent: [
              { vectorImage: { rootUrl: 'https://img.com/1.jpg' } },
              { file: { name: 'data.csv', url: 'https://files.com/data.csv' } },
            ],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].attachments).toHaveLength(2);
      expect(messages[0].attachments![0].type).toBe('image');
      expect(messages[0].attachments![1].type).toBe('file');
    });
  });

  describe('replied message handling', () => {
    it('extracts repliedMessage from renderContent', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          participantBob,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,200)',
              senderRef: participantAlice.entityUrn,
              body: 'I agree!',
              deliveredAt: 1700000002000,
            }),
            renderContent: [{
              repliedMessageContent: {
                messageBody: { text: 'What do you think?' },
                '*originalSender': participantBob.entityUrn,
              },
            }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].repliedMessage).toEqual({
        senderName: 'Bob Jones',
        body: 'What do you think?',
        messageId: undefined,
        senderUrn: 'urn:li:fsd_profile:BOB',
        sentAt: undefined,
      });
    });

    it('defaults sender to "Unknown" when original sender is not found', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,200)',
              senderRef: participantAlice.entityUrn,
              body: 'Reply',
              deliveredAt: 1700000002000,
            }),
            renderContent: [{
              repliedMessageContent: {
                messageBody: { text: 'Original text' },
                '*originalSender': 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:UNKNOWN',
              },
            }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].repliedMessage!.senderName).toBe('Unknown');
    });

    it('omits repliedMessage when not present in renderContent', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeMessage({
            entityUrn: 'urn:li:msg_message:(2-conv,100)',
            senderRef: participantAlice.entityUrn,
            body: 'Normal message',
            deliveredAt: 1700000001000,
          }),
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].repliedMessage).toBeUndefined();
    });
  });

  describe('editedAt handling', () => {
    it('includes editedAt when present on entity', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeMessage({
            entityUrn: 'urn:li:msg_message:(2-conv,100)',
            senderRef: participantAlice.entityUrn,
            body: 'Edited message',
            deliveredAt: 1700000001000,
            editedAt: 1700000005000,
          }),
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].editedAt).toBe(1700000005000);
    });

    it('uses lastEditedAt as fallback for editedAt', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeMessage({
            entityUrn: 'urn:li:msg_message:(2-conv,100)',
            senderRef: participantAlice.entityUrn,
            body: 'Edited via lastEditedAt',
            deliveredAt: 1700000001000,
            lastEditedAt: 1700000006000,
          }),
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].editedAt).toBe(1700000006000);
    });

    it('omits editedAt when neither editedAt nor lastEditedAt is present', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeMessage({
            entityUrn: 'urn:li:msg_message:(2-conv,100)',
            senderRef: participantAlice.entityUrn,
            body: 'Not edited',
            deliveredAt: 1700000001000,
          }),
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].editedAt).toBeUndefined();
    });
  });

  describe('seenAt handling', () => {
    it('extracts seenAt from inline seenReceipts on message entity', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: 'urn:li:msg_message:(2-conv,100)',
              senderRef: participantAlice.entityUrn,
              body: 'Seen message',
              deliveredAt: 1700000001000,
            }),
            seenReceipts: [{ seenAt: 1700000010000 }],
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].seenAt).toBe(1700000010000);
    });

    it('resolves seenAt from SeenReceipt entities in included array', () => {
      const msgUrn = 'urn:li:msg_message:(2-conv,100)';
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          {
            ...makeMessage({
              entityUrn: msgUrn,
              senderRef: participantAlice.entityUrn,
              body: 'Seen via receipt entity',
              deliveredAt: 1700000001000,
            }),
            '*seenReceipts': ['urn:li:msg_seenReceipt:receipt-001'],
          },
          {
            $type: 'com.linkedin.messenger.SeenReceipt',
            entityUrn: 'urn:li:msg_seenReceipt:receipt-001',
            '*message': msgUrn,
            seenAt: 1700000020000,
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].seenAt).toBe(1700000020000);
    });

    it('picks the latest seenAt when multiple SeenReceipt entities exist for the same message', () => {
      const msgUrn = 'urn:li:msg_message:(2-conv,100)';
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeMessage({
            entityUrn: msgUrn,
            senderRef: participantAlice.entityUrn,
            body: 'Multi-receipt',
            deliveredAt: 1700000001000,
          }),
          {
            $type: 'com.linkedin.messenger.SeenReceipt',
            entityUrn: 'urn:li:msg_seenReceipt:r1',
            '*message': msgUrn,
            seenAt: 1700000010000,
          },
          {
            $type: 'com.linkedin.messenger.SeenReceipt',
            entityUrn: 'urn:li:msg_seenReceipt:r2',
            '*message': msgUrn,
            seenAt: 1700000030000,
          },
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].seenAt).toBe(1700000030000);
    });

    it('omits seenAt when no receipts exist', () => {
      const response: VoyagerResponse = {
        data: {},
        included: [
          participantAlice,
          makeMessage({
            entityUrn: 'urn:li:msg_message:(2-conv,100)',
            senderRef: participantAlice.entityUrn,
            body: 'Unseen',
            deliveredAt: 1700000001000,
          }),
        ],
      };

      const messages = normalizeMessages(response, '2-conv');
      expect(messages[0].seenAt).toBeUndefined();
    });
  });

  it('returns empty array when included has no Message entities', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [participantAlice],
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages).toEqual([]);
  });

  it('handles messages from multiple senders', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        participantBob,
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,100)',
          senderRef: participantAlice.entityUrn,
          body: 'Hi from Alice',
          deliveredAt: 1700000001000,
        }),
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-conv,200)',
          senderRef: participantBob.entityUrn,
          body: 'Hi from Bob',
          deliveredAt: 1700000002000,
        }),
      ],
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages).toHaveLength(2);
    expect(messages[0].senderName).toBe('Alice Smith');
    expect(messages[1].senderName).toBe('Bob Jones');
  });

  it('handles message with both body and attachments', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        {
          ...makeMessage({
            entityUrn: 'urn:li:msg_message:(2-conv,100)',
            senderRef: participantAlice.entityUrn,
            body: 'Here is the file',
            deliveredAt: 1700000001000,
          }),
          renderContent: [{
            file: {
              name: 'report.pdf',
              url: 'https://media.linkedin.com/report.pdf',
              byteSize: 50000,
              mediaType: 'application/pdf',
            },
          }],
        },
      ],
    };

    const messages = normalizeMessages(response, '2-conv');
    expect(messages).toHaveLength(1);
    // Body text should be present
    expect(messages[0].body).toBe('Here is the file');
    // Attachment should also be extracted
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].attachments![0]).toMatchObject({
      type: 'file',
      fileName: 'report.pdf',
    });
  });
});

// ============================================================================
// normalizeConversations edge cases
// ============================================================================
describe('normalizeConversations() edge cases', () => {
  const MY_URN = 'urn:li:fsd_profile:ME123';

  it('uses latest message by deliveredAt when multiple messages exist for same conversation', () => {
    const convUrn = 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-multi-msg)';
    const participantAlice = makeParticipant({
      entityUrn: 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:ALICE',
      hostIdentityUrn: 'urn:li:fsd_profile:ALICE',
      firstName: 'Alice',
      lastName: 'Smith',
    });

    const response: VoyagerResponse = {
      data: {},
      included: [
        participantAlice,
        makeConversation({
          entityUrn: convUrn,
          participantRefs: [participantAlice.entityUrn],
          lastActivityAt: 1700000005000,
        }),
        // Older message
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-multi-msg,100)',
          conversationUrn: convUrn,
          senderRef: participantAlice.entityUrn,
          body: 'First message',
          deliveredAt: 1700000001000,
        }),
        // Newer message — should be selected
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-multi-msg,200)',
          conversationUrn: convUrn,
          senderRef: participantAlice.entityUrn,
          body: 'Latest message',
          deliveredAt: 1700000005000,
        }),
        // Middle message
        makeMessage({
          entityUrn: 'urn:li:msg_message:(2-multi-msg,150)',
          conversationUrn: convUrn,
          senderRef: participantAlice.entityUrn,
          body: 'Middle message',
          deliveredAt: 1700000003000,
        }),
      ],
    };

    const { conversations } = normalizeConversations(response, MY_URN);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].lastMessage).toBe('Latest message');
  });

  it('handles conversation with no *conversationParticipants field', () => {
    const response: VoyagerResponse = {
      data: {},
      included: [
        {
          $type: 'com.linkedin.messenger.Conversation' as const,
          entityUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:X,2-no-participants)',
          lastActivityAt: 1700000000000,
          unreadCount: 0,
          categories: ['INBOX', 'PRIMARY_INBOX'],
          // '*conversationParticipants' is intentionally missing
        },
      ],
    };

    const { conversations } = normalizeConversations(response, MY_URN);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe('2-no-participants');
    // Should have empty participant arrays since no refs exist
    expect(conversations[0].participantUrns).toEqual([]);
    expect(conversations[0].participantNames).toEqual([]);
    expect(conversations[0].participantPictures).toEqual([]);
  });
});
