import { describe, it, expect } from 'vitest';
import type { Message } from '@/types/message';
import {
  messageDedupeKey,
  buildCanonicalKeySet,
  isCanonicalMessageId,
  isSseMessageId,
  dedupeMessagesForDisplay,
  planSseDedup,
} from '@/lib/message-dedup';

function msg(over: Partial<Message>): Message {
  return {
    id: 'urn:li:msg_message:1',
    conversationId: 'conv-1',
    senderUrn: 'urn:li:fsd_profile:A',
    senderName: 'A',
    senderPicture: '',
    body: 'hi',
    createdAt: 1000,
    isFromMe: false,
    ...over,
  };
}

describe('message-dedup', () => {
  it('classifies canonical vs SSE ids', () => {
    expect(isCanonicalMessageId('urn:li:msg_message:1')).toBe(true);
    expect(isCanonicalMessageId('urn:li:fsd_message:1')).toBe(false);
    expect(isSseMessageId('urn:li:fsd_message:1')).toBe(true);
    expect(isSseMessageId('urn:li:fs_event:1')).toBe(true);
    expect(isSseMessageId('urn:li:msg_message:1')).toBe(false);
    expect(isSseMessageId('temp-1')).toBe(false);
  });

  it('keys on body|senderUrn|createdAt', () => {
    expect(messageDedupeKey(msg({ body: 'x', senderUrn: 'u', createdAt: 5 }))).toBe('x|u|5');
  });

  it('builds canonical key set only from msg_message entries', () => {
    const keys = buildCanonicalKeySet([
      msg({ id: 'urn:li:msg_message:1', body: 'a', createdAt: 1 }),
      msg({ id: 'urn:li:fsd_message:2', body: 'b', createdAt: 2 }),
    ]);
    expect([...keys]).toEqual(['a|urn:li:fsd_profile:A|1']);
  });

  describe('dedupeMessagesForDisplay', () => {
    it('drops SSE duplicate when a canonical twin exists, keeps it otherwise', () => {
      const canonical = msg({ id: 'urn:li:msg_message:1', body: 'dup', createdAt: 10 });
      const sseDup = msg({ id: 'urn:li:fsd_message:1', body: 'dup', createdAt: 10 });
      const sseUnique = msg({ id: 'urn:li:fs_event:9', body: 'only-sse', createdAt: 20 });
      const out = dedupeMessagesForDisplay([sseDup, canonical, sseUnique]);
      expect(out.map((m) => m.id)).toEqual(['urn:li:msg_message:1', 'urn:li:fs_event:9']);
    });

    it('keeps temp- messages even if a canonical twin exists', () => {
      const canonical = msg({ id: 'urn:li:msg_message:1', body: 'dup', createdAt: 10 });
      const temp = msg({ id: 'temp-1', body: 'dup', createdAt: 10 });
      const out = dedupeMessagesForDisplay([canonical, temp]);
      expect(out.map((m) => m.id).sort()).toEqual(['temp-1', 'urn:li:msg_message:1']);
    });

    it('returns all sorted by time when no canonical entries exist', () => {
      const a = msg({ id: 'urn:li:fsd_message:1', createdAt: 30 });
      const b = msg({ id: 'urn:li:fs_event:2', createdAt: 10 });
      const out = dedupeMessagesForDisplay([a, b]);
      expect(out.map((m) => m.createdAt)).toEqual([10, 30]);
    });

    it('does not mutate the input array', () => {
      const input = [msg({ createdAt: 30 }), msg({ createdAt: 10 })];
      const snapshot = input.map((m) => m.createdAt);
      dedupeMessagesForDisplay(input);
      expect(input.map((m) => m.createdAt)).toEqual(snapshot);
    });
  });

  describe('planSseDedup', () => {
    it('deletes SSE orphans that have a canonical twin', () => {
      const plan = planSseDedup([
        msg({ id: 'urn:li:msg_message:1', body: 'dup', createdAt: 10 }),
        msg({ id: 'urn:li:fsd_message:1', body: 'dup', createdAt: 10 }),
        msg({ id: 'urn:li:fs_event:2', body: 'only-sse', createdAt: 20 }),
      ]);
      expect(plan.deleteIds).toEqual(['urn:li:fsd_message:1']);
      expect(plan.updates).toEqual([]);
    });

    it('preserves editedAt and reactions onto the canonical twin', () => {
      const reactions = [{ emoji: '👍', count: 1, firstReactedAt: 5, viewerReacted: false }];
      const plan = planSseDedup([
        msg({ id: 'urn:li:msg_message:1', body: 'dup', createdAt: 10 }),
        msg({ id: 'urn:li:fsd_message:1', body: 'dup', createdAt: 10, editedAt: 99, reactions }),
      ]);
      expect(plan.deleteIds).toEqual(['urn:li:fsd_message:1']);
      expect(plan.updates).toEqual([
        { id: 'urn:li:msg_message:1', updates: { editedAt: 99, reactions } },
      ]);
    });

    it('does not overwrite fields already present on the canonical twin', () => {
      const plan = planSseDedup([
        msg({ id: 'urn:li:msg_message:1', body: 'dup', createdAt: 10, editedAt: 1 }),
        msg({ id: 'urn:li:fsd_message:1', body: 'dup', createdAt: 10, editedAt: 99 }),
      ]);
      expect(plan.updates).toEqual([]);
    });

    it('ignores sent temps unless includeSentTemps is set', () => {
      const msgs = [
        msg({ id: 'urn:li:msg_message:1', body: 'dup', createdAt: 10 }),
        msg({ id: 'temp-1', body: 'dup', createdAt: 10, status: 'sent' }),
      ];
      expect(planSseDedup(msgs).deleteIds).toEqual([]);
      expect(planSseDedup(msgs, { includeSentTemps: true }).deleteIds).toEqual(['temp-1']);
    });

    it('does not delete temps that are not yet sent', () => {
      const plan = planSseDedup(
        [
          msg({ id: 'urn:li:msg_message:1', body: 'dup', createdAt: 10 }),
          msg({ id: 'temp-1', body: 'dup', createdAt: 10, status: 'sending' }),
        ],
        { includeSentTemps: true }
      );
      expect(plan.deleteIds).toEqual([]);
    });
  });
});
