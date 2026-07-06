/**
 * Regression: recalled messages fetched via REST were stored as empty rows,
 * leaving an orphaned time separator in the thread.
 *
 * After an unsend, LinkedIn's message pages can still return the recalled
 * message as a tombstone entity (messageBodyRenderFormat: 'RECALLED' /
 * recalledAt set, empty body). normalizeMessages stored it as a normal
 * empty-body row — the bubble rendered blank but the timestamp separator above
 * it (derived from stored rows) stayed visible. And because the entity was
 * "present" in the fetch, the recall reconciler never removed the previously
 * stored copy either.
 *
 * Fix: normalizeMessages flags recalled entities (recalledAt); write paths
 * skip storing them; planRecalledDeletions uses them to delete any stored
 * copies — including when the recalled message was the LATEST in the thread
 * (its own timestamp extends the authoritative range).
 */
import { normalizeMessages } from '@/lib/voyager-normalizer';
import { planRecalledDeletions } from '@/lib/message-dedup';
import type { Message } from '@/types/message';

const CONV_ID = '2-conv';

function msg(overrides: Partial<Message>): Message {
  return {
    id: 'urn:li:msg_message:x',
    conversationId: CONV_ID,
    senderUrn: 'urn:li:fsd_profile:S',
    senderName: 'S',
    senderPicture: '',
    body: 'hi',
    createdAt: 1000,
    isFromMe: false,
    ...overrides,
  };
}

function rawPage(entities: any[]) {
  return { data: {}, included: entities };
}

function messageEntity(opts: { id: string; body: string; deliveredAt: number; recalled?: boolean }) {
  return {
    $type: 'com.linkedin.messenger.Message',
    entityUrn: opts.id,
    body: { text: opts.body },
    deliveredAt: opts.deliveredAt,
    ...(opts.recalled ? { messageBodyRenderFormat: 'RECALLED' } : {}),
    '*sender': 'urn:li:msg_messagingParticipant:urn:li:fsd_profile:S',
  };
}

describe('normalizeMessages flags recalled tombstone entities', () => {
  it('sets recalledAt on RECALLED entities and leaves live ones unflagged', () => {
    const messages = normalizeMessages(
      rawPage([
        messageEntity({ id: 'urn:li:msg_message:live', body: 'hi', deliveredAt: 1000 }),
        messageEntity({ id: 'urn:li:msg_message:gone', body: '', deliveredAt: 2000, recalled: true }),
      ]) as any,
      CONV_ID
    );
    expect(messages).toHaveLength(2);
    expect(messages.find((m) => m.id.endsWith('live'))!.recalledAt).toBeUndefined();
    expect(messages.find((m) => m.id.endsWith('gone'))!.recalledAt).toBeGreaterThan(0);
  });
});

describe('planRecalledDeletions with recalled tombstones in the fetch', () => {
  it('deletes the stored copy of a recalled LATEST message (tombstone extends the range)', () => {
    const fetched = [
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
      // The newest message was recalled — REST returns its tombstone.
      msg({ id: 'urn:li:msg_message:m2', createdAt: 5000, body: '', recalledAt: 6000 }),
    ];
    const stored = [
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
      msg({ id: 'urn:li:msg_message:m2', createdAt: 5000, body: 'now you see me' }),
    ];
    expect(planRecalledDeletions(fetched, stored)).toEqual(['urn:li:msg_message:m2']);
  });

  it('deletes a stored SSE copy of a recalled message via its dedupe key', () => {
    const fetched = [
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
      msg({ id: 'urn:li:msg_message:m2', createdAt: 5000, body: '', recalledAt: 6000 }),
    ];
    const stored = [
      msg({ id: 'urn:li:fsd_message:sse-copy', createdAt: 5000, body: 'now you see me' }),
    ];
    expect(planRecalledDeletions(fetched, stored)).toEqual(['urn:li:fsd_message:sse-copy']);
  });

  it('never treats a live fetched message as recalled', () => {
    const fetched = [
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
      msg({ id: 'urn:li:msg_message:m2', createdAt: 5000 }),
    ];
    const stored = [
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
      msg({ id: 'urn:li:msg_message:m2', createdAt: 5000 }),
    ];
    expect(planRecalledDeletions(fetched, stored)).toEqual([]);
  });
});
