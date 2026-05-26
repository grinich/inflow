export interface ParticipantFixture {
  profileId: string;
  firstName: string;
  lastName: string;
  headline?: string;
}

export interface ConversationFixture {
  id: string;
  participants: ParticipantFixture[];
  lastMessage?: string;
  lastActivityAt: number;
  unread?: boolean;
  categories?: string[];
}

export interface MessageFixture {
  id?: string;
  index?: number;
  senderProfileId: string;
  senderName?: string;
  body: string;
  createdAt?: number;
  renderContent?: any[];
}

export function buildConversationsPageResponse(
  conversations: ConversationFixture[],
  nextCursor: string | null = null,
) {
  const included: any[] = [];

  for (const conv of conversations) {
    included.push({
      $type: 'com.linkedin.messenger.Conversation',
      entityUrn: `urn:li:msg_conversation:(urn:li:fsd_profile:SELF,${conv.id})`,
      lastActivityAt: conv.lastActivityAt,
      unreadCount: conv.unread ? 1 : 0,
      categories: conv.categories || ['PRIMARY_INBOX'],
      '*conversationParticipants': conv.participants.map(
        (_, i) => `urn:li:msg_messagingParticipant:${conv.id}_${i}`,
      ),
    });

    for (let i = 0; i < conv.participants.length; i++) {
      const p = conv.participants[i];
      included.push({
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: `urn:li:msg_messagingParticipant:${conv.id}_${i}`,
        hostIdentityUrn: `urn:li:fsd_profile:${p.profileId}`,
        participantType: {
          member: {
            firstName: { text: p.firstName },
            lastName: { text: p.lastName },
            headline: { text: p.headline || '' },
            profilePicture: null,
          },
        },
      });
    }

    if (conv.lastMessage) {
      included.push({
        $type: 'com.linkedin.messenger.Message',
        entityUrn: `urn:li:msg_message:${conv.id}_msg0`,
        '*conversation': `urn:li:msg_conversation:(urn:li:fsd_profile:SELF,${conv.id})`,
        body: { text: conv.lastMessage },
        deliveredAt: conv.lastActivityAt,
        '*sender': `urn:li:msg_messagingParticipant:${conv.id}_0`,
      });
    }
  }

  return {
    data: {
      data: {
        messengerConversationsByCategoryQuery: {
          metadata: { nextCursor },
        },
      },
    },
    included,
  };
}

export function buildMessagesPageResponse(
  convId: string,
  messages: MessageFixture[],
) {
  const included: any[] = [];
  const participants = new Map<string, string>();

  for (const msg of messages) {
    if (!participants.has(msg.senderProfileId)) {
      const participantUrn = `urn:li:msg_messagingParticipant:${convId}_${msg.senderProfileId}`;
      participants.set(msg.senderProfileId, participantUrn);
      included.push({
        $type: 'com.linkedin.messenger.MessagingParticipant',
        entityUrn: participantUrn,
        hostIdentityUrn: `urn:li:fsd_profile:${msg.senderProfileId}`,
        participantType: {
          member: {
            firstName: { text: msg.senderName?.split(' ')[0] || 'User' },
            lastName: { text: msg.senderName?.split(' ')[1] || '' },
            profilePicture: null,
          },
        },
      });
    }
    included.push({
      $type: 'com.linkedin.messenger.Message',
      entityUrn: msg.id || `urn:li:msg_message:${convId}_${msg.index || 0}`,
      '*conversation': `urn:li:msg_conversation:(urn:li:fsd_profile:SELF,${convId})`,
      '*sender': participants.get(msg.senderProfileId),
      body: { text: msg.body },
      deliveredAt: msg.createdAt || Date.now(),
      renderContent: msg.renderContent || [],
    });
  }

  return { data: {}, included };
}

export function buildEmptyResponse() {
  return { data: {}, included: [] };
}
