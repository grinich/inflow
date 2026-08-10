import type { Connection } from '@/types/connection';

/**
 * When a connection's categorization is considered stale and worth re-scanning
 * automatically (people change roles). Auto mode re-categorizes anything older
 * than this; manual edits (context menu) also stamp `categorizedAt`, so they too
 * refresh on this cadence.
 */
export const STALE_RECATEGORIZE_MS = 1000 * 60 * 60 * 24 * 30 * 6; // ~6 months

/**
 * True if a connection should be (re)categorized: never scanned, or last scanned
 * longer ago than `staleMs`.
 */
export function needsCategorization(
  c: Pick<Connection, 'categorizedAt'>,
  now: number,
  staleMs: number = STALE_RECATEGORIZE_MS,
): boolean {
  if (!c.categorizedAt) return true;
  return now - c.categorizedAt > staleMs;
}
