// Bug (High): switchDatabase reassigns the module `db` mid-operation, so a
// long-running loop that captured account A's db resumes writing into account B.
// Fix: a generation counter bumped on each switch, which the loops check to bail.
import { switchDatabase, getDbGeneration } from '@/db/database';

describe('db generation guard', () => {
  it('switchDatabase bumps the generation so in-flight loops can detect an account switch', async () => {
    const g0 = getDbGeneration();
    await switchDatabase(`gen-${Date.now()}-a`);
    const g1 = getDbGeneration();
    await switchDatabase(`gen-${Date.now()}-b`);
    const g2 = getDbGeneration();
    expect(g1).toBeGreaterThan(g0);
    expect(g2).toBeGreaterThan(g1);
  });
});
