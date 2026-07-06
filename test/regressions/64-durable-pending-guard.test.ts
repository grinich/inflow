/**
 * Regression: optimistic-state protection did not survive service worker
 * restarts.
 *
 * After an action's API call confirmed, protection against stale echoes relied
 * solely on the in-memory suppression maps (10s/15s TTL) — an MV3 service
 * worker restart wiped them, so an echo arriving just after a restart clobbered
 * freshly-confirmed optimistic state.
 *
 * Fix: hasPendingAction (backed by the durable pendingActions table) also
 * guards recently-confirmed actions for the same 15s window.
 */
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import { makePendingAction } from '../fixtures/factories';

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

import { hasPendingAction } from '../../entrypoints/background/sync/pending-guard';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_64_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('hasPendingAction durability window', () => {
  it('guards a recently-confirmed action (echo window survives SW restart)', async () => {
    await testDb.pendingActions.put(
      makePendingAction({ conversationId: 'c1', status: 'confirmed', timestamp: Date.now() - 2000 })
    );
    expect(await hasPendingAction('c1')).toBe(true);
  });

  it('does not guard a confirmed action older than the echo window', async () => {
    await testDb.pendingActions.put(
      makePendingAction({ conversationId: 'c2', status: 'confirmed', timestamp: Date.now() - 60_000 })
    );
    expect(await hasPendingAction('c2')).toBe(false);
  });

  it('still guards pending and queued actions regardless of age', async () => {
    await testDb.pendingActions.put(
      makePendingAction({ conversationId: 'c3', status: 'pending', timestamp: Date.now() - 120_000 })
    );
    await testDb.pendingActions.put(
      makePendingAction({ conversationId: 'c4', status: 'queued', timestamp: Date.now() - 120_000 })
    );
    expect(await hasPendingAction('c3')).toBe(true);
    expect(await hasPendingAction('c4')).toBe(true);
  });

  it('never guards failed (rolled back) actions', async () => {
    await testDb.pendingActions.put(
      makePendingAction({ conversationId: 'c5', status: 'failed', timestamp: Date.now() })
    );
    expect(await hasPendingAction('c5')).toBe(false);
  });
});
