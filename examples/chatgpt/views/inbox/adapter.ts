import type { ConversationData, MessageData } from '../../src/contracts.js';
import type { Conversation } from './upstream/types/conversation.js';
import type { Message } from './upstream/types/message.js';
export function toConversation(c: ConversationData): Conversation {
  return {
    id: c.id,
    participantUrns: [],
    participantNames: c.participants,
    participantPictures: [],
    lastMessage: c.lastMessage,
    lastActivityAt: Date.parse(c.lastActivityAt),
    read: c.unread ? 0 : 1,
    archived: c.archived ? 1 : 0,
    starred: c.starred ? 1 : 0,
    category: c.category,
    hasAttachments: c.hasAttachments ? 1 : 0,
  };
}
export function toMessage(m: MessageData, conversationId: string): Message {
  return {
    id: m.id,
    conversationId,
    senderUrn: '',
    senderName: m.from,
    senderPicture: '',
    body: m.body,
    createdAt: Date.parse(m.at),
    isFromMe: m.isFromMe,
    editedAt: m.edited ? Date.parse(m.at) : undefined,
    attachments: m.attachments?.map((a) => ({
      type: 'unknown',
      fileName: a.fileName,
      fallbackText: `${a.fileName || a.type} · View in Inflow`,
    })),
    repliedMessage: m.repliedTo
      ? { senderName: m.repliedTo.from, body: m.repliedTo.body }
      : undefined,
    reactions: m.reactions?.map((r) => ({ ...r, firstReactedAt: 0, viewerReacted: false })),
  };
}
