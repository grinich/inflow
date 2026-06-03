// Batch 8 low bugs:
//  - demo GET_DEBUG_LOGS returned string[] instead of LogEntry[]
//  - mergeConversation stored a brand-new row with starred=undefined
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { handleDemoBridgeMessage } from '@/lib/demo-mode';
import { mergeConversation } from '../../entrypoints/background/sync/merge-conversation';
import { makeConversation } from '../fixtures/factories';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_b8_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});
afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('demo GET_DEBUG_LOGS returns LogEntry[] (objects), not string[]', async () => {
  const res: any = await handleDemoBridgeMessage({ type: 'GET_DEBUG_LOGS' } as any);
  expect(Array.isArray(res.data)).toBe(true);
  expect(res.data.every((e: any) => typeof e === 'object')).toBe(true);
});

it('mergeConversation defaults starred to 0 on a brand-new row', async () => {
  await mergeConversation(makeConversation({ id: 'c-new', starred: undefined }));
  const row = await testDb.conversations.get('c-new');
  expect(row.starred).toBe(0);
});
