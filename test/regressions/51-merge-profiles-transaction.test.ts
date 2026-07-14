// Regression: mergeProfiles did bulkGet → in-memory merge → bulkPut with no
// surrounding transaction. It's called concurrently from independent
// background paths (SSE event-handler, sync-discovery, sync-engine,
// repair-participants); a caller whose bulkGet snapshot predates another
// path's richer write would bulkPut its sparse copy over the fuller row,
// defeating the "never overwrite a known value with an empty one"
// protection. The read-merge-write must run inside one rw transaction.
import Dexie from 'dexie';
import * as dbModule from '@/db/database';
import { makeProfile } from '../fixtures/factories';

const ACCOUNT = `mergetx-${Date.now()}`;

beforeAll(async () => {
  // Point the module's real internal `db` at a throwaway fake-indexeddb DB so
  // we can exercise the REAL mergeProfiles (it uses the module-scoped db).
  await dbModule.switchDatabase(ACCOUNT);
});

afterAll(async () => {
  dbModule.db.close();
  await Dexie.delete(`InflowDB_${ACCOUNT}`);
});

beforeEach(async () => {
  await dbModule.db.profiles.clear();
});

it('runs the read-merge-write inside a rw transaction on profiles', async () => {
  await dbModule.db.profiles.put(
    makeProfile({ urn: 'urn:li:fsd_profile:tx1', occupation: 'VP Engineering', location: 'Dublin' })
  );

  const txSpy = vi.spyOn(dbModule.db, 'transaction');
  await dbModule.mergeProfiles([
    makeProfile({ urn: 'urn:li:fsd_profile:tx1', occupation: '', location: '' }),
  ]);

  expect(txSpy).toHaveBeenCalledWith('rw', dbModule.db.profiles, expect.any(Function));
  txSpy.mockRestore();

  // Behavioral sanity: known fields survived the sparse merge
  const stored = await dbModule.db.profiles.get('urn:li:fsd_profile:tx1');
  expect(stored?.occupation).toBe('VP Engineering');
  expect(stored?.location).toBe('Dublin');
});
