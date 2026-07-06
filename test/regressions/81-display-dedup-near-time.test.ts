/**
 * Regression: a just-sent message showed as two bubbles until the next fetch.
 *
 * Since the send response began storing the canonical message immediately
 * (regression 76), two copies of a sent message can coexist briefly: the
 * response-stored canonical row and the SSE echo's copy. The DB cleanup
 * (planSseDedup) collapses them even when their server timestamps differ
 * slightly (±5s near-time fallback), but dedupeMessagesForDisplay only
 * collapsed EXACT senderUrn|createdAt matches — so a timestamp off by even
 * 1ms rendered a duplicate bubble until a thread refetch reconciled the DB.
 *
 * Fix: the display dedup gains the same near-time fallback (same sender +
 * same body within 5s, each canonical absorbing at most one SSE copy).
 */
import { dedupeMessagesForDisplay } from '@/lib/message-dedup';
import type { Message } from '@/types/message';

const ME = 'urn:li:fsd_profile:SELF';

function msg(overrides: Partial<Message>): Message {
  return {
    id: 'urn:li:msg_message:x',
    conversationId: '2-conv',
    senderUrn: ME,
    senderName: 'You',
    senderPicture: '',
    body: 'hello there',
    createdAt: 10_000,
    isFromMe: true,
    ...overrides,
  };
}

describe('dedupeMessagesForDisplay near-time fallback', () => {
  it('collapses a response-stored canonical and an SSE echo whose timestamps differ slightly', () => {
    const out = dedupeMessagesForDisplay([
      msg({ id: 'urn:li:msg_message:from-response', createdAt: 10_000 }),
      msg({ id: 'urn:li:fsd_message:sse-echo', createdAt: 11_500 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('urn:li:msg_message:from-response');
  });

  it('still collapses exact-timestamp twins (existing behavior)', () => {
    const out = dedupeMessagesForDisplay([
      msg({ id: 'urn:li:msg_message:c', createdAt: 10_000 }),
      msg({ id: 'urn:li:fsd_message:s', createdAt: 10_000 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('keeps two GENUINE same-body messages sent in quick succession', () => {
    // "ok" sent twice 3s apart: each canonical has its exact SSE twin. The
    // fallback must not let canonical #1 absorb SSE copy #2.
    const out = dedupeMessagesForDisplay([
      msg({ id: 'urn:li:msg_message:c1', body: 'ok', createdAt: 10_000 }),
      msg({ id: 'urn:li:fs_event:s1', body: 'ok', createdAt: 10_000 }),
      msg({ id: 'urn:li:msg_message:c2', body: 'ok', createdAt: 13_000 }),
      msg({ id: 'urn:li:fsd_message:s2', body: 'ok', createdAt: 13_000 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((m) => m.id)).toEqual(['urn:li:msg_message:c1', 'urn:li:msg_message:c2']);
  });

  it('keeps an SSE-only message with a same-body canonical from long ago', () => {
    const out = dedupeMessagesForDisplay([
      msg({ id: 'urn:li:msg_message:old', body: 'ok', createdAt: 10_000 }),
      msg({ id: 'urn:li:fsd_message:new', body: 'ok', createdAt: 60_000 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('does not collapse across different senders', () => {
    const out = dedupeMessagesForDisplay([
      msg({ id: 'urn:li:msg_message:mine', createdAt: 10_000 }),
      msg({
        id: 'urn:li:fsd_message:theirs',
        senderUrn: 'urn:li:fsd_profile:OTHER',
        isFromMe: false,
        createdAt: 11_000,
      }),
    ]);
    expect(out).toHaveLength(2);
  });
});
