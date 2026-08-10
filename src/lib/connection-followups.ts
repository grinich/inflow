import type { Connection } from '@/types/connection';

/**
 * Follow-up suggestions: connections worth reconnecting with, computed locally
 * by cross-referencing the connection list against conversation recency. No AI —
 * just "who have I not talked to (or never talked to) that I probably should."
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FollowUp {
  connection: Connection;
  /** Epoch ms of the last message exchanged, or null if never messaged. */
  lastContactAt: number | null;
  /** Days since last contact, or (if never) days since connecting. */
  days: number;
  reason: 'never' | 'stale';
}

export interface FollowUpOptions {
  now: number;
  /** A messaged connection is "stale" after this many days (default 60). */
  staleDays?: number;
  /** Ignore never-messaged connections newer than this (default 7 days). */
  minAgeDays?: number;
  /** Max suggestions to return (default 20). */
  limit?: number;
}

/** Higher = surfaced first: interest-tagged, then investors, then everyone. */
function priority(c: Connection): number {
  if (c.interestTags && c.interestTags.length > 0) return 2;
  if (c.roleCategory === 'Investor') return 1;
  return 0;
}

export function computeFollowUps(
  connections: Connection[],
  lastContactByUrn: Map<string, number>,
  opts: FollowUpOptions,
): FollowUp[] {
  const staleDays = opts.staleDays ?? 60;
  const minAgeDays = opts.minAgeDays ?? 7;
  const limit = opts.limit ?? 20;
  const now = opts.now;

  const candidates: FollowUp[] = [];
  for (const c of connections) {
    const last = lastContactByUrn.get(c.profileUrn) ?? 0;
    if (last > 0) {
      const days = Math.floor((now - last) / DAY_MS);
      if (days >= staleDays) {
        candidates.push({ connection: c, lastContactAt: last, days, reason: 'stale' });
      }
    } else {
      // Never messaged — only nag once the connection isn't brand new.
      const ageDays = c.connectedAt ? Math.floor((now - c.connectedAt) / DAY_MS) : Infinity;
      if (ageDays >= minAgeDays && Number.isFinite(ageDays)) {
        candidates.push({ connection: c, lastContactAt: null, days: ageDays, reason: 'never' });
      }
    }
  }

  candidates.sort((a, b) => {
    const p = priority(b.connection) - priority(a.connection);
    if (p !== 0) return p;
    return b.days - a.days;
  });

  return candidates.slice(0, limit);
}
