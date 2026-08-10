import type { ConnectionRole } from '@/types/connection';

/** Distinct palette for firm/interest charts (assigned by index). */
export const CHART_PALETTE = [
  '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899',
  '#06b6d4', '#f97316', '#14b8a6', '#6366f1', '#f43f5e',
];

/** Role → hex, matching the role badge colors so charts stay recognizable. */
export function roleColor(role: ConnectionRole | string): string {
  switch (role) {
    case 'Investor': return '#10b981';
    case 'Founder': return '#8b5cf6';
    case 'Executive': return '#f59e0b';
    case 'Engineering': return '#3b82f6';
    case 'Product': return '#06b6d4';
    case 'Design': return '#ec4899';
    case 'Sales & BD': return '#f97316';
    case 'Marketing': return '#f43f5e';
    case 'Recruiting': return '#14b8a6';
    case 'Operations': return '#6366f1';
    default: return '#71717a';
  }
}
