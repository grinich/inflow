import { z } from 'zod';
export const Conversation = z.object({
  id: z.string(),
  participants: z.array(z.string()),
  lastMessage: z.string(),
  lastActivityAt: z.string(),
  unread: z.boolean(),
  starred: z.boolean(),
  archived: z.boolean(),
  category: z.string(),
  hasAttachments: z.boolean(),
});
export const Message = z.object({
  id: z.string(),
  from: z.string(),
  isFromMe: z.boolean(),
  at: z.string(),
  body: z.string(),
  edited: z.boolean().optional(),
  attachments: z.array(z.object({ type: z.string(), fileName: z.string().optional() })).optional(),
  repliedTo: z.object({ from: z.string(), body: z.string() }).optional(),
  reactions: z.array(z.object({ emoji: z.string(), count: z.number() })).optional(),
});
export const ListInput = z.object({
  tab: z.enum(['focused', 'other', 'archived', 'spam']).default('focused'),
  query: z.string().max(200).default(''),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(100).default(30),
});
export const ListOutput = z.object({
  conversations: z.array(Conversation),
  total: z.number(),
  nextOffset: z.number().nullable(),
});
export const ThreadOutput = z.object({
  conversation: Conversation,
  messages: z.array(Message),
  refreshed: z.boolean(),
});
export const InboxState = z.enum(['inbox', 'thread', 'connection', 'visualize']);
export const OpenInboxInput = ListInput.extend({
  state: InboxState.default('inbox').describe(
    'View in the existing panel. visualize is an alias for the visual inbox; thread opens conversationId; connection shows setup.',
  ),
  conversationId: z
    .string()
    .optional()
    .describe('Conversation to select in the same inbox widget.'),
  widgetSessionId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Reuse the widgetSessionId returned by the previous open_inbox call in this chat. Omit only to open a new panel.',
    ),
}).refine((input) => input.state !== 'thread' || Boolean(input.conversationId), {
  message: 'conversationId is required for state=thread',
  path: ['conversationId'],
});
export const InboxOutput = ListOutput.extend({
  connected: z.boolean(),
  message: z.string(),
  pairingUrl: z.string().nullable(),
  thread: ThreadOutput.nullable().optional(),
  state: InboxState,
  widgetSessionId: z.string().uuid(),
  tab: ListInput.shape.tab,
  query: ListInput.shape.query,
});
export type ConversationData = z.infer<typeof Conversation>;
export type MessageData = z.infer<typeof Message>;
export type InboxData = z.infer<typeof InboxOutput>;
export type ThreadData = z.infer<typeof ThreadOutput>;
