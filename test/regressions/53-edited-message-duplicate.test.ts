// Regression: an inbound message that was edited showed as TWO copies.
//
// LinkedIn delivers each message through two channels with different URN
// prefixes (SSE urn:li:fsd_message: / urn:li:fs_event: vs canonical REST
// urn:li:msg_message:). They were collapsed by a content key that INCLUDED the
// body. When the sender edited a message, the SSE copy got the new body while
// the canonical copy kept the old one, so their keys diverged and dedup no
// longer recognised them as the same message — both rendered.
//
// Fix: key on senderUrn|createdAt (stable across edits) and fold the edited
// body onto the surviving copy.
import type { Message } from '@/types/message';
import { dedupeMessagesForDisplay, planSseDedup, messageDedupeKey } from '@/lib/message-dedup';

const SENDER = 'urn:li:fsd_profile:gabriele';
const TS = 1_700_000_000_000;

function msg(over: Partial<Message>): Message {
  return {
    id: 'urn:li:msg_message:1',
    conversationId: '2-conv',
    senderUrn: SENDER,
    senderName: 'Gabriele Sorrento',
    senderPicture: '',
    body: 'original text',
    createdAt: TS,
    isFromMe: false,
    ...over,
  };
}

describe('edited inbound message no longer duplicates', () => {
  it('keeps the SSE and canonical copies under the same key after an edit', () => {
    // deliveredAt (createdAt) does not change on edit, only the body does.
    const canonical = msg({ id: 'urn:li:msg_message:1', body: 'original text' });
    const ssEdited = msg({ id: 'urn:li:fsd_message:1', body: 'edited text', editedAt: TS + 5000 });
    expect(messageDedupeKey(canonical)).toBe(messageDedupeKey(ssEdited));
  });

  it('display: shows exactly one bubble with the edited text', () => {
    const canonical = msg({ id: 'urn:li:msg_message:1', body: 'original text' });
    const ssEdited = msg({ id: 'urn:li:fsd_message:1', body: 'edited text', editedAt: TS + 5000 });

    const shown = dedupeMessagesForDisplay([canonical, ssEdited]);
    expect(shown).toHaveLength(1);
    expect(shown[0].body).toBe('edited text');
    expect(shown[0].editedAt).toBe(TS + 5000);
    // The stable canonical id is the survivor (so reactions/replies keyed on it still resolve)
    expect(shown[0].id).toBe('urn:li:msg_message:1');
  });

  it('display: collapses an SSE-only edit pair (original fs_event + edited fsd_message)', () => {
    const original = msg({ id: 'urn:li:fs_event:1', body: 'original text' });
    const edited = msg({ id: 'urn:li:fsd_message:1', body: 'edited text', editedAt: TS + 5000 });

    const shown = dedupeMessagesForDisplay([original, edited]);
    expect(shown).toHaveLength(1);
    expect(shown[0].body).toBe('edited text');
  });

  it('db cleanup: deletes the SSE orphan and folds the edited body onto canonical', () => {
    const canonical = msg({ id: 'urn:li:msg_message:1', body: 'original text' });
    const ssEdited = msg({ id: 'urn:li:fsd_message:1', body: 'edited text', editedAt: TS + 5000 });

    const plan = planSseDedup([canonical, ssEdited]);
    expect(plan.deleteIds).toEqual(['urn:li:fsd_message:1']);
    expect(plan.updates).toEqual([
      { id: 'urn:li:msg_message:1', updates: { editedAt: TS + 5000, body: 'edited text' } },
    ]);
  });

  it('does not merge two genuinely distinct messages from the same sender', () => {
    // Different deliveredAt → different key → both kept.
    const a = msg({ id: 'urn:li:msg_message:1', body: 'first', createdAt: TS });
    const b = msg({ id: 'urn:li:msg_message:2', body: 'second', createdAt: TS + 1 });
    const shown = dedupeMessagesForDisplay([a, b]);
    expect(shown).toHaveLength(2);
  });
});
