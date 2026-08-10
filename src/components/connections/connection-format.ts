import { formatDistanceToNowStrict } from 'date-fns';
import type { Connection, ConnectionRole } from '@/types/connection';

/**
 * A connection is "displayable" only if it has a real name. Some connection
 * entries come back without a resolvable profile (private/restricted members,
 * or a response that omitted the profile), which would otherwise render as an
 * "Unknown" row with no name, headline, or photo. We hide those from the list
 * (they stay in the DB, so a later sync that resolves the name brings them back).
 */
export function isNamedConnection(c: Pick<Connection, 'fullName'>): boolean {
  return !!c.fullName && c.fullName.trim().length > 0;
}

/**
 * Tailwind classes for a role badge — a distinct color per role so the list is
 * scannable at a glance. "Other" (and unknown) stays a muted neutral chip.
 */
export function roleBadgeClass(role: ConnectionRole | undefined): string {
  switch (role) {
    case 'Investor':
      return 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30';
    case 'Founder':
      return 'bg-violet-500/15 text-violet-300 ring-violet-500/30';
    case 'Executive':
      return 'bg-amber-500/15 text-amber-300 ring-amber-500/30';
    case 'Engineering':
      return 'bg-blue-500/15 text-blue-300 ring-blue-500/30';
    case 'Product':
      return 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/30';
    case 'Design':
      return 'bg-pink-500/15 text-pink-300 ring-pink-500/30';
    case 'Sales & BD':
      return 'bg-orange-500/15 text-orange-300 ring-orange-500/30';
    case 'Marketing':
      return 'bg-rose-500/15 text-rose-300 ring-rose-500/30';
    case 'Recruiting':
      return 'bg-teal-500/15 text-teal-300 ring-teal-500/30';
    case 'Operations':
      return 'bg-indigo-500/15 text-indigo-300 ring-indigo-500/30';
    default:
      return 'bg-surface-input text-fg-muted ring-edge';
  }
}

// Palette for user-defined interest tags — assigned deterministically by name so
// each tag keeps the same color everywhere it appears.
const TAG_PALETTE = [
  'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  'bg-pink-500/15 text-pink-300 ring-pink-500/30',
  'bg-cyan-500/15 text-cyan-300 ring-cyan-500/30',
  'bg-orange-500/15 text-orange-300 ring-orange-500/30',
  'bg-teal-500/15 text-teal-300 ring-teal-500/30',
];

/** Stable per-tag color classes (same tag → same color across the app). */
export function interestTagClass(tag: string): string {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

/** Human "connected 3 days ago" label from an epoch-ms timestamp. */
export function connectedLabel(ts: number): string {
  if (!ts) return '';
  try {
    return `connected ${formatDistanceToNowStrict(new Date(ts), { addSuffix: true })}`;
  } catch {
    return '';
  }
}

/** LinkedIn profile URL for a connection (falls back to a name search). */
export function connectionProfileUrl(publicId: string, name: string): string {
  return publicId
    ? `https://www.linkedin.com/in/${publicId}`
    : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(name)}`;
}
