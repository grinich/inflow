import { getBackfillCutoff, getBackfillWindow } from '@/lib/sync-settings';
import { setLocalStore } from '../mocks/chrome';

describe('sync-settings', () => {
  describe('getBackfillWindow()', () => {
    it('returns the default "180d" when nothing is stored', async () => {
      const result = await getBackfillWindow();
      expect(result).toBe('180d');
    });

    it('returns the stored backfill window value', async () => {
      setLocalStore('backfillWindow', '30d');
      const result = await getBackfillWindow();
      expect(result).toBe('30d');
    });

    it('returns "7d" when stored', async () => {
      setLocalStore('backfillWindow', '7d');
      const result = await getBackfillWindow();
      expect(result).toBe('7d');
    });

    it('returns "all" when stored', async () => {
      setLocalStore('backfillWindow', 'all');
      const result = await getBackfillWindow();
      expect(result).toBe('all');
    });

    it('returns "365d" when stored', async () => {
      setLocalStore('backfillWindow', '365d');
      const result = await getBackfillWindow();
      expect(result).toBe('365d');
    });
  });

  describe('getBackfillCutoff()', () => {
    it('returns a cutoff approximately 180 days ago by default', async () => {
      const before = Date.now();
      const cutoff = await getBackfillCutoff();
      const after = Date.now();

      const expectedMs = 180 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeGreaterThanOrEqual(before - expectedMs);
      expect(cutoff).toBeLessThanOrEqual(after - expectedMs);
    });

    it('returns a cutoff approximately 7 days ago for "7d"', async () => {
      setLocalStore('backfillWindow', '7d');
      const before = Date.now();
      const cutoff = await getBackfillCutoff();
      const after = Date.now();

      const expectedMs = 7 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeGreaterThanOrEqual(before - expectedMs);
      expect(cutoff).toBeLessThanOrEqual(after - expectedMs);
    });

    it('returns a cutoff approximately 30 days ago for "30d"', async () => {
      setLocalStore('backfillWindow', '30d');
      const before = Date.now();
      const cutoff = await getBackfillCutoff();
      const after = Date.now();

      const expectedMs = 30 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeGreaterThanOrEqual(before - expectedMs);
      expect(cutoff).toBeLessThanOrEqual(after - expectedMs);
    });

    it('returns a cutoff approximately 90 days ago for "90d"', async () => {
      setLocalStore('backfillWindow', '90d');
      const before = Date.now();
      const cutoff = await getBackfillCutoff();
      const after = Date.now();

      const expectedMs = 90 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeGreaterThanOrEqual(before - expectedMs);
      expect(cutoff).toBeLessThanOrEqual(after - expectedMs);
    });

    it('returns a cutoff approximately 365 days ago for "365d"', async () => {
      setLocalStore('backfillWindow', '365d');
      const before = Date.now();
      const cutoff = await getBackfillCutoff();
      const after = Date.now();

      const expectedMs = 365 * 24 * 60 * 60 * 1000;
      expect(cutoff).toBeGreaterThanOrEqual(before - expectedMs);
      expect(cutoff).toBeLessThanOrEqual(after - expectedMs);
    });

    it('returns 0 for "all" (no cutoff)', async () => {
      setLocalStore('backfillWindow', 'all');
      const cutoff = await getBackfillCutoff();
      expect(cutoff).toBe(0);
    });
  });
});
