// @vitest-environment jsdom
/**
 * Regression: a batch queued for one time appeared in no order at all.
 *
 * The comparators sorted on scheduledAt (or updatedAt) alone, so messages
 * sharing a timestamp all compared equal and their order fell back to whatever
 * db.scheduledMessages.toArray() returned — primary-key order over random
 * UUIDs. Scheduling a morning's outreach for 08:00 therefore scattered it, and
 * any change reshuffled the cards.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { renderHook, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { settleOptimistic } from '../helpers/settle';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return { ...original, get db() { return testDb; } };
});

import { useOutbox } from '@/hooks/useOutbox';

const AT = Date.now() + 86_400_000;

function row(id: string, createdAt: number, over: any = {}) {
  return {
    id,
    recipientUrns: ['urn:li:fsd_profile:X'],
    recipientName: 'Someone',
    body: 'Hello',
    status: 'scheduled' as const,
    scheduledAt: AT,
    createdAt,
    updatedAt: createdAt,
    ...over,
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_104_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  await settleOptimistic(testDb);
  testDb.close();
});

it('orders messages sharing a send time by when they were queued', async () => {
  // Inserted in an order unrelated to createdAt, as random ids would be.
  await testDb.scheduledMessages.bulkAdd([
    row('zz', 300),
    row('aa', 100),
    row('mm', 200),
  ] as any);

  const { result } = renderHook(() => useOutbox());

  await waitFor(() => expect(result.current.scheduled).toHaveLength(3));
  expect(result.current.scheduled.map((m) => m.id)).toEqual(['aa', 'mm', 'zz']);
});

it('falls back to the id when even the queue time matches', async () => {
  // Two drafts created in the same millisecond must still have ONE order,
  // or the grid reshuffles on every unrelated render.
  await testDb.scheduledMessages.bulkAdd([row('b', 100), row('a', 100)] as any);

  const { result } = renderHook(() => useOutbox());

  await waitFor(() => expect(result.current.scheduled).toHaveLength(2));
  expect(result.current.scheduled.map((m) => m.id)).toEqual(['a', 'b']);
});

it('still puts the soonest send time first', async () => {
  await testDb.scheduledMessages.bulkAdd([
    row('later', 100, { scheduledAt: AT + 60_000 }),
    row('sooner', 999, { scheduledAt: AT }),
  ] as any);

  const { result } = renderHook(() => useOutbox());

  await waitFor(() => expect(result.current.scheduled).toHaveLength(2));
  // createdAt only breaks ties; it never outranks the send time.
  expect(result.current.scheduled.map((m) => m.id)).toEqual(['sooner', 'later']);
});

it('orders drafts newest first, and still deterministically on a tie', async () => {
  await testDb.scheduledMessages.bulkAdd([
    row('d2', 100, { status: 'draft', scheduledAt: undefined, updatedAt: 500 }),
    row('d1', 100, { status: 'draft', scheduledAt: undefined, updatedAt: 500 }),
    row('d3', 100, { status: 'draft', scheduledAt: undefined, updatedAt: 900 }),
  ] as any);

  const { result } = renderHook(() => useOutbox());

  await waitFor(() => expect(result.current.drafts).toHaveLength(3));
  expect(result.current.drafts.map((m) => m.id)).toEqual(['d3', 'd1', 'd2']);
});
