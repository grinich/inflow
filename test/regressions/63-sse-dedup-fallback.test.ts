/**
 * Regression: SSE duplicates with a fabricated timestamp were never cleaned up.
 *
 * The dedup key is senderUrn|createdAt, and SSE handlers fall back to
 * Date.now() when an event lacks deliveredAt — so such an entry could never
 * key-match its canonical twin and the message stayed visibly duplicated
 * forever.
 *
 * Fix: planSseDedup gains a near-time fallback — an SSE entry with no exact
 * key twin is matched to a canonical entry with the same sender + body within
 * a 5s window (each canonical absorbs at most one SSE orphan).
 */
import { planSseDedup } from '@/lib/message-dedup';
import type { Message } from '@/types/message';

function msg(overrides: Partial<Message>): Message {
  return {
    id: 'urn:li:msg_message:x',
    conversationId: '2-conv',
    senderUrn: 'urn:li:fsd_profile:S',
    senderName: 'S',
    senderPicture: '',
    body: 'hi',
    createdAt: 1000,
    isFromMe: false,
    ...overrides,
  };
}

describe('planSseDedup near-time fallback', () => {
  it('drops an SSE entry whose timestamp was fabricated (~2s off the canonical twin)', () => {
    const plan = planSseDedup([
      msg({ id: 'urn:li:msg_message:c1', createdAt: 1000, body: 'hi' }),
      msg({ id: 'urn:li:fsd_message:s1', createdAt: 3200, body: 'hi' }),
    ]);
    expect(plan.deleteIds).toEqual(['urn:li:fsd_message:s1']);
  });

  it('preserves editedAt/reactions from a fallback-matched SSE entry onto the canonical', () => {
    const plan = planSseDedup([
      msg({ id: 'urn:li:msg_message:c1', createdAt: 1000, body: 'hi' }),
      msg({
        id: 'urn:li:fsd_message:s1',
        createdAt: 2500,
        body: 'hi',
        reactions: [{ emoji: '👍', count: 1, firstReactedAt: 5, viewerReacted: false }],
      }),
    ]);
    expect(plan.deleteIds).toEqual(['urn:li:fsd_message:s1']);
    expect(plan.updates).toEqual([
      {
        id: 'urn:li:msg_message:c1',
        updates: {
          reactions: [{ emoji: '👍', count: 1, firstReactedAt: 5, viewerReacted: false }],
        },
      },
    ]);
  });

  it('keeps an SSE entry that is a distinct message (same body, >5s apart)', () => {
    const plan = planSseDedup([
      msg({ id: 'urn:li:msg_message:c1', createdAt: 1000, body: 'ok' }),
      msg({ id: 'urn:li:fsd_message:s2', createdAt: 9000, body: 'ok' }),
    ]);
    expect(plan.deleteIds).toEqual([]);
  });

  it('does not let one canonical absorb a second SSE copy after an exact key match', () => {
    // "ok" sent twice in quick succession: the first pair key-matches exactly;
    // the second SSE entry (no canonical twin yet) must NOT be deleted by the
    // fallback even though it's within 5s of the first canonical.
    const plan = planSseDedup([
      msg({ id: 'urn:li:msg_message:c1', createdAt: 1000, body: 'ok' }),
      msg({ id: 'urn:li:fs_event:exact', createdAt: 1000, body: 'ok' }),
      msg({ id: 'urn:li:fsd_message:second', createdAt: 3000, body: 'ok' }),
    ]);
    expect(plan.deleteIds).toEqual(['urn:li:fs_event:exact']);
  });

  it('does not fallback-match across different senders', () => {
    const plan = planSseDedup([
      msg({ id: 'urn:li:msg_message:c1', createdAt: 1000, body: 'hi', senderUrn: 'urn:li:fsd_profile:A' }),
      msg({ id: 'urn:li:fsd_message:s1', createdAt: 2000, body: 'hi', senderUrn: 'urn:li:fsd_profile:B' }),
    ]);
    expect(plan.deleteIds).toEqual([]);
  });
});
