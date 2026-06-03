// Bug (High): unauthenticated startup crashes — setupPoller -> setupSyncCoordinator
// calls db.open() while db is null (switchDatabase never ran), throwing synchronously
// and preventing realtime + action-queue drain from starting.
let dbVal: any = null;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return dbVal;
  },
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { setupSyncCoordinator } from '../../entrypoints/background/sync/sync-coordinator';

describe('sync-coordinator null-db guard (unauthenticated startup)', () => {
  it('setupSyncCoordinator does not throw when db is null', () => {
    dbVal = null;
    expect(() => setupSyncCoordinator()).not.toThrow();
  });
});
