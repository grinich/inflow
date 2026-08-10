import { ROLE_CATEGORIES, type ConnectionRole } from '@/types/connection';
import type { Connection } from '@/types/connection';

/**
 * Pure aggregation of the connection list into the numbers the Insights
 * overview shows: network composition by role, interest-tag counts, and the
 * firms people cluster around (parsed from headlines). No AI, no I/O.
 */

export interface RoleSlice {
  role: ConnectionRole;
  count: number;
  /** Share of all connections, 0–1. */
  pct: number;
}

export interface CountItem {
  name: string;
  count: number;
}

export interface NetworkInsights {
  total: number;
  categorized: number;
  uncategorized: number;
  roles: RoleSlice[];
  interests: CountItem[];
  companies: CountItem[];
}

/**
 * Extract a company/firm name from a LinkedIn headline. Handles the common
 * "<role> at <Company>" / "<role> @ <Company>" shapes and trims trailing noise
 * like "| something" or a location suffix. Returns null when nothing usable.
 */
export function parseCompany(headline: string): string | null {
  if (!headline) return null;
  // Prefer the segment after the last " at " / " @ " (case-insensitive).
  const m = headline.match(/(?:\bat\b|@)\s+(.+)$/i);
  if (!m) return null;
  let company = m[1].trim();
  // Cut at common separators that introduce a second clause.
  company = company.split(/[|•·]|(?:\s[-–—]\s)/)[0].trim();
  // Drop a trailing location-ish clause after a comma ("Acme, San Francisco").
  company = company.split(',')[0].trim();
  // Strip trailing punctuation.
  company = company.replace(/[.;:]+$/, '').trim();
  return company.length >= 2 ? company : null;
}

export function computeInsights(connections: Connection[]): NetworkInsights {
  const total = connections.length;
  const roleCounts = new Map<ConnectionRole, number>();
  const interestCounts = new Map<string, number>();
  const companyCounts = new Map<string, { name: string; count: number }>();
  let categorized = 0;

  for (const c of connections) {
    if (c.categorizedAt) categorized++;
    if (c.roleCategory) roleCounts.set(c.roleCategory, (roleCounts.get(c.roleCategory) ?? 0) + 1);
    for (const t of c.interestTags ?? []) interestCounts.set(t, (interestCounts.get(t) ?? 0) + 1);

    const company = parseCompany(c.headline);
    if (company) {
      const key = company.toLowerCase();
      const existing = companyCounts.get(key);
      if (existing) existing.count++;
      else companyCounts.set(key, { name: company, count: 1 });
    }
  }

  const roles: RoleSlice[] = ROLE_CATEGORIES
    .map((role) => ({ role, count: roleCounts.get(role) ?? 0 }))
    .filter((r) => r.count > 0)
    .map((r) => ({ ...r, pct: total ? r.count / total : 0 }))
    .sort((a, b) => b.count - a.count);

  const interests: CountItem[] = [...interestCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const companies: CountItem[] = [...companyCounts.values()]
    .filter((c) => c.count >= 2) // a "cluster" is 2+ people at the same firm
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { total, categorized, uncategorized: total - categorized, roles, interests, companies };
}
