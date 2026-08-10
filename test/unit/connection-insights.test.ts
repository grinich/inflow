/**
 * Network insights aggregation: role composition, interest counts, and firm
 * clustering parsed from headlines.
 */
import { parseCompany, computeInsights } from '@/lib/connection-insights';
import type { Connection } from '@/types/connection';

function c(over: Partial<Connection>): Connection {
  return {
    profileUrn: Math.random().toString(),
    connectionUrn: '',
    connectedAt: 0,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: 'X',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

describe('parseCompany', () => {
  it('pulls the firm after "at"', () => {
    expect(parseCompany('Growth Equity Investor at Silversmith Capital Partners')).toBe(
      'Silversmith Capital Partners',
    );
  });
  it('handles the "@" form', () => {
    expect(parseCompany('Engineer @ Stripe')).toBe('Stripe');
  });
  it('trims trailing clauses and locations', () => {
    expect(parseCompany('Partner at Acme Ventures | Investor')).toBe('Acme Ventures');
    expect(parseCompany('GP at Foo Capital, San Francisco')).toBe('Foo Capital');
    expect(parseCompany('VC at Bar Capital - seed stage')).toBe('Bar Capital');
  });
  it('returns null when there is no company', () => {
    expect(parseCompany('Mathematician')).toBeNull();
    expect(parseCompany('')).toBeNull();
  });
});

describe('computeInsights', () => {
  it('computes role composition with percentages, sorted by count', () => {
    const conns = [
      c({ roleCategory: 'Investor', categorizedAt: 1 }),
      c({ roleCategory: 'Investor', categorizedAt: 1 }),
      c({ roleCategory: 'Founder', categorizedAt: 1 }),
      c({ roleCategory: 'Engineering', categorizedAt: 1 }),
    ];
    const { roles, total } = computeInsights(conns);
    expect(total).toBe(4);
    expect(roles[0]).toMatchObject({ role: 'Investor', count: 2, pct: 0.5 });
    expect(roles.map((r) => r.role)).toEqual(['Investor', 'Founder', 'Engineering']);
  });

  it('tracks categorized vs uncategorized', () => {
    const res = computeInsights([
      c({ roleCategory: 'Investor', categorizedAt: 1 }),
      c({}), // never categorized
    ]);
    expect(res.categorized).toBe(1);
    expect(res.uncategorized).toBe(1);
  });

  it('clusters firms with 2+ people and ignores singletons', () => {
    const res = computeInsights([
      c({ headline: 'Partner at Acme Ventures' }),
      c({ headline: 'Principal at Acme Ventures' }),
      c({ headline: 'Founder at Solo Co' }), // singleton → excluded
    ]);
    expect(res.companies).toEqual([{ name: 'Acme Ventures', count: 2 }]);
  });

  it('counts interest tags across connections', () => {
    const res = computeInsights([
      c({ interestTags: ['Investors'] }),
      c({ interestTags: ['Investors', 'Advisors'] }),
    ]);
    expect(res.interests).toEqual([
      { name: 'Investors', count: 2 },
      { name: 'Advisors', count: 1 },
    ]);
  });
});
