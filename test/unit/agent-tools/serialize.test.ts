import { toConversationSummary, toMessageView } from '@/lib/agent-tools/serialize';
import { makeConversation, makeMessage, resetFactories } from '../../fixtures/factories';

beforeEach(() => resetFactories());

describe('toConversationSummary', () => {
  it('maps 0/1 flags to booleans and epoch millis to ISO', () => {
    const c = makeConversation({
      read: 0, starred: 1, archived: 1, hasAttachments: 1,
      lastActivityAt: Date.parse('2026-03-01T10:00:00.000Z'),
    });
    const s = toConversationSummary(c);
    expect(s.unread).toBe(true);
    expect(s.starred).toBe(true);
    expect(s.archived).toBe(true);
    expect(s.hasAttachments).toBe(true);
    expect(s.lastActivityAt).toBe('2026-03-01T10:00:00.000Z');
  });

  it('treats absent starred/hasAttachments as false and truncates lastMessage', () => {
    const c = makeConversation({ lastMessage: 'x'.repeat(300) });
    delete c.starred;
    delete c.hasAttachments;
    const s = toConversationSummary(c);
    expect(s.starred).toBe(false);
    expect(s.hasAttachments).toBe(false);
    expect(s.lastMessage.length).toBe(203); // 200 + '...'
  });
});

describe('toMessageView', () => {
  it('produces the base shape with no optional fields for a plain message', () => {
    const m = makeMessage({ createdAt: Date.parse('2026-03-01T10:00:00.000Z') });
    const v = toMessageView(m);
    expect(v).toEqual({
      id: m.id,
      from: m.senderName,
      isFromMe: false,
      at: '2026-03-01T10:00:00.000Z',
      body: m.body,
    });
    expect('edited' in v).toBe(false);
    expect('attachments' in v).toBe(false);
  });

  it('shapes edited/attachments/repliedTo/reactions when present', () => {
    const m = makeMessage({
      editedAt: 123,
      attachments: [
        { type: 'file', fileName: 'cv.pdf' },
        { type: 'image' },
      ],
      repliedMessage: { senderName: 'Jane', body: 'y'.repeat(200) },
      reactions: [{ emoji: '👍', count: 2, firstReactedAt: 1, viewerReacted: false }],
    });
    const v = toMessageView(m);
    expect(v.edited).toBe(true);
    expect(v.attachments).toEqual([{ type: 'file', fileName: 'cv.pdf' }, { type: 'image' }]);
    expect(v.repliedTo?.from).toBe('Jane');
    expect(v.repliedTo?.body.length).toBe(123); // 120 + '...'
    expect(v.reactions).toEqual([{ emoji: '👍', count: 2 }]);
  });
});
