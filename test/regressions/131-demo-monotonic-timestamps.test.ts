/**
 * Regression: demo-mode seeded non-monotonic message timestamps.
 *
 * `createdAt = convStart + m * randInt(60_000, 1_800_000)` re-rolls the
 * interval every iteration and multiplies it by the index — message 2 could
 * draw a small interval and land BEFORE message 1's large one. Threads read
 * through the [conversationId+createdAt] index rendered out of order, the
 * designed inbound/outbound alternation was scrambled, and lastActivityAt /
 * lastMessage (taken from the last-INDEX message) often disagreed with the
 * newest message shown at the bottom of the thread.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

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

import { seedDemoData } from '@/lib/demo-mode';

// Deterministic Math.random so the test can't flake: an LCG cycling through
// values that WOULD produce an inversion under the old per-index-multiply code.
function stubRandom() {
  let state = 12345;
  return vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  });
}

beforeEach(async () => {
  testDb = new Dexie(`Demo_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('seeds strictly increasing timestamps per conversation, matching lastActivityAt', async () => {
  const spy = stubRandom();
  await seedDemoData();
  spy.mockRestore();

  const conversations = await testDb.conversations.toArray();
  expect(conversations.length).toBeGreaterThan(0);

  const now = Date.now();
  for (const conv of conversations) {
    const msgs = await testDb.messages
      .where('conversationId')
      .equals(conv.id)
      .sortBy('createdAt');
    if (msgs.length === 0) continue;

    // Index order (demo-msg-<i>-<m>) must agree with time order.
    const byIndex = [...msgs].sort((a: any, b: any) => {
      const ma = parseInt(a.id.split('-').pop(), 10);
      const mb = parseInt(b.id.split('-').pop(), 10);
      return ma - mb;
    });
    expect(msgs.map((m: any) => m.id)).toEqual(byIndex.map((m: any) => m.id));

    // The conversation preview must describe the NEWEST message.
    const newest = msgs[msgs.length - 1];
    expect(conv.lastActivityAt).toBe(newest.createdAt);
    expect(conv.lastMessage).toBe(newest.body);

    // No messages from the future.
    expect(newest.createdAt).toBeLessThanOrEqual(now);
  }
});
