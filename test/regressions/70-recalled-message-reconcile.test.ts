/**
 * Regression: messages recalled/deleted on LinkedIn never disappeared locally.
 *
 * Message sync was upsert-only: a fetch bulkPut the returned page but never
 * removed stored canonical rows the server no longer returned, so a message
 * the other party unsent stayed visible in inflow forever.
 *
 * Fix: after fetching a page, stored canonical (msg_message) rows that fall
 * INSIDE the fetched page's time range but are absent from it are deleted.
 * Rows outside the range (older pages), SSE-format rows, and optimistic temps
 * are never touched — a concurrent newer message can't be swept because it is
 * newer than the fetched range.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { planRecalledDeletions } from '@/lib/message-dedup';
import type { Message } from '@/types/message';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { reconcileRecalledMessages } from '../../entrypoints/background/sync/reconcile-messages';

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

describe('planRecalledDeletions (pure)', () => {
  const fetched = [
    msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
    msg({ id: 'urn:li:msg_message:m3', createdAt: 3000 }),
  ];

  it('deletes a stored canonical row inside the fetched range that the server no longer returns', () => {
    const stored = [
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
      msg({ id: 'urn:li:msg_message:m2', createdAt: 2000 }), // recalled server-side
      msg({ id: 'urn:li:msg_message:m3', createdAt: 3000 }),
    ];
    expect(planRecalledDeletions(fetched, stored)).toEqual(['urn:li:msg_message:m2']);
  });

  it('never touches rows outside the fetched time range', () => {
    const stored = [
      msg({ id: 'urn:li:msg_message:m0', createdAt: 500 }),   // older than the page
      msg({ id: 'urn:li:msg_message:m9', createdAt: 9000 }),  // newer (e.g. concurrent send)
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
      msg({ id: 'urn:li:msg_message:m3', createdAt: 3000 }),
    ];
    expect(planRecalledDeletions(fetched, stored)).toEqual([]);
  });

  it('never touches optimistic temp rows', () => {
    const stored = [msg({ id: 'temp-abc', createdAt: 2200 })];
    expect(planRecalledDeletions(fetched, stored)).toEqual([]);
  });

  it('removes an orphaned SSE row whose message was recalled before its canonical copy was fetched', () => {
    // Message arrived via SSE only, then the sender unsent it: the fetch's time
    // range covers it but returns no matching message — the SSE row must go
    // too, or the recalled message stays visible forever.
    const stored = [
      msg({ id: 'urn:li:fsd_message:sse-recalled', createdAt: 2000, body: 'now unsent' }),
    ];
    expect(planRecalledDeletions(fetched, stored)).toEqual(['urn:li:fsd_message:sse-recalled']);
  });

  it('keeps an SSE row whose logical message IS in the fetch (exact key match)', () => {
    const stored = [
      // Same sender + same createdAt as fetched m3 — same logical message,
      // just not deduped yet. planSseDedup owns that cleanup, not the recall plan.
      msg({ id: 'urn:li:fsd_message:sse-live', createdAt: 3000 }),
    ];
    expect(planRecalledDeletions(fetched, stored)).toEqual([]);
  });

  it('keeps an SSE row with a fabricated timestamp that near-time matches a fetched message', () => {
    const stored = [
      // Fabricated local timestamp ~1.5s off the canonical m1, same sender+body.
      msg({ id: 'urn:li:fsd_message:sse-fab', createdAt: 2500, body: 'hi' }),
    ];
    const fetchedWithBody = [
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000, body: 'hi' }),
      msg({ id: 'urn:li:msg_message:m3', createdAt: 3000, body: 'bye' }),
    ];
    expect(planRecalledDeletions(fetchedWithBody, stored)).toEqual([]);
  });

  it('plans nothing when the fetch returned no messages', () => {
    const stored = [msg({ id: 'urn:li:msg_message:m2', createdAt: 2000 })];
    expect(planRecalledDeletions([], stored)).toEqual([]);
  });
});

describe('reconcileRecalledMessages (db wrapper)', () => {
  beforeEach(async () => {
    testDb = new Dexie(`TestDB_70_${Date.now()}_${Math.random()}`);
    applySchema(testDb);
    await testDb.open();
  });

  afterEach(async () => {
    if (testDb) {
      testDb.close();
      await Dexie.delete(testDb.name);
    }
  });

  it('removes recalled canonical rows for the conversation only', async () => {
    await testDb.messages.bulkPut([
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
      msg({ id: 'urn:li:msg_message:m2', createdAt: 2000 }), // recalled
      msg({ id: 'urn:li:msg_message:m3', createdAt: 3000 }),
      msg({ id: 'urn:li:msg_message:other', conversationId: '2-other', createdAt: 2000 }),
    ]);

    await reconcileRecalledMessages('2-conv', [
      msg({ id: 'urn:li:msg_message:m1', createdAt: 1000 }),
      msg({ id: 'urn:li:msg_message:m3', createdAt: 3000 }),
    ]);

    expect(await testDb.messages.get('urn:li:msg_message:m2')).toBeUndefined();
    expect(await testDb.messages.get('urn:li:msg_message:m1')).toBeDefined();
    expect(await testDb.messages.get('urn:li:msg_message:m3')).toBeDefined();
    // Other conversations untouched even with in-range timestamps.
    expect(await testDb.messages.get('urn:li:msg_message:other')).toBeDefined();
  });
});
