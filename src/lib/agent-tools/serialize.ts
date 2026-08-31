import { truncate } from '@/lib/prompt-utils';
import type { Conversation } from '@/types/conversation';
import type { Message } from '@/types/message';

/**
 * Shapes DB rows into agent-facing JSON. Agents shouldn't need inflow's
 * IndexedDB conventions: 0/1 flags become booleans, epoch millis become ISO
 * strings, and absent fields are omitted rather than emitted as null.
 */

export interface ConversationSummary {
  id: string;
  participants: string[];
  lastMessage: string;
  lastActivityAt: string;
  unread: boolean;
  starred: boolean;
  archived: boolean;
  category: string;
  hasAttachments: boolean;
}

export function toConversationSummary(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    participants: c.participantNames,
    lastMessage: truncate(c.lastMessage, 200),
    lastActivityAt: new Date(c.lastActivityAt).toISOString(),
    unread: c.read === 0,
    starred: c.starred === 1,
    archived: c.archived === 1,
    category: c.category,
    hasAttachments: c.hasAttachments === 1,
  };
}

export interface MessageView {
  id: string;
  from: string;
  isFromMe: boolean;
  at: string;
  body: string;
  edited?: true;
  attachments?: { type: string; fileName?: string }[];
  repliedTo?: { from: string; body: string };
  reactions?: { emoji: string; count: number }[];
}

export function toMessageView(m: Message): MessageView {
  const view: MessageView = {
    id: m.id,
    from: m.senderName,
    isFromMe: m.isFromMe,
    at: new Date(m.createdAt).toISOString(),
    body: m.body,
  };
  if (m.editedAt) view.edited = true;
  if (m.attachments?.length) {
    view.attachments = m.attachments.map((a) => ({
      type: a.type,
      ...(a.fileName ? { fileName: a.fileName } : {}),
    }));
  }
  if (m.repliedMessage) {
    view.repliedTo = {
      from: m.repliedMessage.senderName,
      body: truncate(m.repliedMessage.body, 120),
    };
  }
  if (m.reactions?.length) {
    view.reactions = m.reactions.map((r) => ({ emoji: r.emoji, count: r.count }));
  }
  return view;
}
