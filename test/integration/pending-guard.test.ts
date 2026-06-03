import { describe, it, expect, beforeEach, vi } from 'vitest';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

import { hasPendingAction } from '../../entrypoints/background/sync/pending-guard';

function action(over: any) {
  return {
    id: `a-${Math.random()}`,
    type: 'archive',
    conversationId: 'c1',
    status: 'pending',
    timestamp: 1,
    ...over,
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_pending_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});

describe('hasPendingAction', () => {
  it('is true for a pending or queued action on the conversation', async () => {
    await testDb.pendingActions.put(action({ status: 'pending' }));
    expect(await hasPendingAction('c1')).toBe(true);

    await testDb.pendingActions.clear();
    await testDb.pendingActions.put(action({ status: 'queued' }));
    expect(await hasPendingAction('c1')).toBe(true);
  });

  it('is false for failed or confirmed actions (already reconciled)', async () => {
    await testDb.pendingActions.bulkPut([action({ status: 'failed' }), action({ status: 'confirmed' })]);
    expect(await hasPendingAction('c1')).toBe(false);
  });

  it('only matches the given conversation', async () => {
    await testDb.pendingActions.put(action({ conversationId: 'other', status: 'pending' }));
    expect(await hasPendingAction('c1')).toBe(false);
  });

  it('is false when there are no actions', async () => {
    expect(await hasPendingAction('c1')).toBe(false);
  });
});
