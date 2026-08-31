// Demo mode seeds invitations + connections lazily on first FETCH_*. The
// connection headline used to read `p.title`/`p.company` off DEMO_PEOPLE,
// which has neither — every demo connection rendered "undefined at undefined".
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import {
  DEMO_CONNECTION_COUNT,
  DEMO_CONNECTION_DAY_GAPS,
  DEMO_CONNECTION_HEADLINES,
  DEMO_INVITATIONS,
  DEMO_PEOPLE,
} from '@/lib/demo-data';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { handleDemoBridgeMessage } from '@/lib/demo-mode';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_demo_net_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});
afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

describe('demo network fixtures', () => {
  it('keeps the connection lists aligned with DEMO_CONNECTION_COUNT', () => {
    expect(DEMO_CONNECTION_DAY_GAPS).toHaveLength(DEMO_CONNECTION_COUNT);
    expect(DEMO_CONNECTION_HEADLINES).toHaveLength(DEMO_CONNECTION_COUNT);
    expect(DEMO_PEOPLE.length).toBeGreaterThanOrEqual(DEMO_CONNECTION_COUNT);
  });

  it('FETCH_CONNECTIONS seeds connections with real headlines', async () => {
    const res: any = await handleDemoBridgeMessage({ type: 'FETCH_CONNECTIONS' } as any);
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ fetched: DEMO_CONNECTION_COUNT, hasMore: false });

    const rows = await testDb.connections.toArray();
    expect(rows).toHaveLength(DEMO_CONNECTION_COUNT);
    for (const row of rows) {
      expect(row.name).toBeTruthy();
      expect(row.headline).toBeTruthy();
      expect(row.headline).not.toMatch(/undefined/);
    }
  });

  it('FETCH_INVITATIONS seeds pending invitations once', async () => {
    await handleDemoBridgeMessage({ type: 'FETCH_INVITATIONS' } as any);
    await handleDemoBridgeMessage({ type: 'FETCH_INVITATIONS' } as any);
    const rows = await testDb.invitations.toArray();
    expect(rows).toHaveLength(DEMO_INVITATIONS.length);
    expect(rows.every((r: any) => r.status === 'pending')).toBe(true);
  });
});
