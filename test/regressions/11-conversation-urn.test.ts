// Inconsistency (Medium): the conversation-ID regex was duplicated 4 ways; the
// realtime copy lacked '+', so ids containing '+' were extracted wrong/dropped.
// This locks in one canonical extractor.
import { extractConversationId } from '@/lib/conversation-urn';

describe('extractConversationId (canonical)', () => {
  it('extracts a simple thread id', () => {
    expect(extractConversationId('urn:li:msg_conversation:(urn:li:fsd_profile:ABC,2-abc123)')).toBe('2-abc123');
  });

  it('handles base64 ids containing + / =', () => {
    expect(extractConversationId('urn:li:msg_conversation:(urn:li:fsd_profile:ABC,2-aB+c/d==)')).toBe('2-aB+c/d==');
  });

  it('handles a missing trailing paren', () => {
    expect(extractConversationId('urn:li:msg_conversation:(urn:li:fsd_profile:ABC,2-no-paren')).toBe('2-no-paren');
  });

  it('returns empty string for non-conversation input', () => {
    expect(extractConversationId('garbage')).toBe('');
  });
});
