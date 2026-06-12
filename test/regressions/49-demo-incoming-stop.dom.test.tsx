// @vitest-environment jsdom
// Regression: createIncomingConversation unconditionally re-armed its timer
// after its awaited DB writes. If stopDemoIncoming() ran while an invocation
// was mid-flight (timer already fired → clearTimeout was a no-op), the
// in-flight call re-armed the timer afterwards and the simulator kept
// inserting fake conversations and dispatching inflow:demo-incoming events
// forever after demo teardown.
import '../dom-setup';

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

beforeEach(async () => {
  testDb = new Dexie(`DemoStop_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  // Fake only setTimeout/clearTimeout so fake-indexeddb (setImmediate) and
  // microtasks still run for real while we control the demo timers.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(async () => {
  vi.useRealTimers();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function flushAsync(rounds = 50) {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }
}

it('does not re-arm the incoming simulator when stopped mid-invocation', async () => {
  const { startDemoIncoming, stopDemoIncoming } = await import('@/lib/demo-mode');

  startDemoIncoming();
  expect(vi.getTimerCount()).toBe(1);

  // Fire the timer — createIncomingConversation starts and suspends on its
  // first awaited DB write.
  await vi.advanceTimersToNextTimerAsync();

  // Teardown happens while the invocation is in flight.
  stopDemoIncoming();

  // Let the in-flight invocation run to completion.
  await flushAsync();

  // The simulator must be fully stopped — no re-armed timer.
  expect(vi.getTimerCount()).toBe(0);

  stopDemoIncoming(); // idempotent cleanup
});
