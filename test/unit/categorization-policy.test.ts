/**
 * Re-categorization staleness policy: never-scanned or older than ~6 months.
 */
import { needsCategorization, STALE_RECATEGORIZE_MS } from '@/lib/categorization-policy';

const NOW = 1_000_000_000_000;

describe('needsCategorization', () => {
  it('is true when never categorized', () => {
    expect(needsCategorization({ categorizedAt: undefined }, NOW)).toBe(true);
    expect(needsCategorization({ categorizedAt: 0 }, NOW)).toBe(true);
  });

  it('is false when recently categorized', () => {
    expect(needsCategorization({ categorizedAt: NOW - 1000 }, NOW)).toBe(false);
  });

  it('is true again once older than the stale window', () => {
    expect(needsCategorization({ categorizedAt: NOW - STALE_RECATEGORIZE_MS - 1 }, NOW)).toBe(true);
    expect(needsCategorization({ categorizedAt: NOW - STALE_RECATEGORIZE_MS + 1 }, NOW)).toBe(false);
  });

  it('is roughly a 6-month window', () => {
    const days = STALE_RECATEGORIZE_MS / (1000 * 60 * 60 * 24);
    expect(days).toBeGreaterThan(150);
    expect(days).toBeLessThan(200);
  });
});
