/**
 * Conversation summary: transcript serialization, empty-thread handling, tier
 * routing, and the staleness check against the thread's last activity.
 */
import {
  buildConversationSummaryPrompt,
  summarizeConversation,
  isConversationSummaryStale,
  CONV_SUMMARY_MESSAGE_LIMIT,
} from '@/lib/connection-conversation-summary';
import type { Message } from '@/types/message';

function msg(over: Partial<Message>): Message {
  return {
    id: Math.random().toString(),
    conversationId: 'c1',
    senderUrn: '',
    senderName: '',
    senderPicture: '',
    body: '',
    createdAt: 0,
    isFromMe: false,
    ...over,
  };
}

describe('buildConversationSummaryPrompt', () => {
  it('labels my messages "Me" and theirs by name, oldest first', () => {
    const prompt = buildConversationSummaryPrompt('Ada Lovelace', [
      msg({ body: 'Hi Ada!', isFromMe: true, createdAt: 1 }),
      msg({ body: 'Hello — good to connect.', isFromMe: false, createdAt: 2 }),
    ]);
    expect(prompt).toContain('Me: Hi Ada!');
    expect(prompt).toContain('Ada Lovelace: Hello — good to connect.');
    expect(prompt.indexOf('Me: Hi Ada!')).toBeLessThan(prompt.indexOf('Ada Lovelace: Hello'));
  });

  it('represents attachment-only messages with a placeholder', () => {
    const prompt = buildConversationSummaryPrompt('Ada', [
      msg({ isFromMe: true, attachments: [{ type: 'image' }] as any }),
    ]);
    expect(prompt).toContain('[image attachment]');
  });

  it('keeps only the most recent window for very long threads', () => {
    const many = Array.from({ length: CONV_SUMMARY_MESSAGE_LIMIT + 10 }, (_, i) =>
      msg({ body: `line ${i}`, createdAt: i }),
    );
    const prompt = buildConversationSummaryPrompt('Ada', many);
    expect(prompt).not.toContain('line 0');
    expect(prompt).toContain(`line ${CONV_SUMMARY_MESSAGE_LIMIT + 9}`);
  });
});

describe('summarizeConversation', () => {
  it('routes to the quality tier and returns a cleaned summary', async () => {
    const predict = vi.fn().mockResolvedValue('  "They discussed a seed round."  ');
    const out = await summarizeConversation('Ada', [msg({ body: 'hi', isFromMe: true })], predict);
    expect(out).toBe('They discussed a seed round.');
    expect(predict).toHaveBeenCalledTimes(1);
    expect(predict.mock.calls[0][1]).toMatchObject({ tier: 'quality', fullResponse: true });
  });

  it('returns null without calling the model when there is no text content', async () => {
    const predict = vi.fn();
    const out = await summarizeConversation('Ada', [msg({ body: '' })], predict);
    expect(out).toBeNull();
    expect(predict).not.toHaveBeenCalled();
  });

  it('returns null when the model returns nothing', async () => {
    const predict = vi.fn().mockResolvedValue(null);
    expect(await summarizeConversation('Ada', [msg({ body: 'hi' })], predict)).toBeNull();
  });
});

describe('isConversationSummaryStale', () => {
  it('is false when there is no summary', () => {
    expect(isConversationSummaryStale({ conversationSummary: '' }, 100)).toBe(false);
  });

  it('is false when the last message is not newer than the summary', () => {
    expect(
      isConversationSummaryStale(
        { conversationSummary: 'x', conversationSummaryLastMsgAt: 100 },
        100,
      ),
    ).toBe(false);
  });

  it('is true when new messages arrived after the summary', () => {
    expect(
      isConversationSummaryStale(
        { conversationSummary: 'x', conversationSummaryLastMsgAt: 100 },
        200,
      ),
    ).toBe(true);
  });
});
