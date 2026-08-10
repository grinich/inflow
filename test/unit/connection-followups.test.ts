/**
 * Follow-up suggestions from connections × conversation recency.
 */
import { computeFollowUps } from '@/lib/connection-followups';
import type { Connection } from '@/types/connection';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

function c(over: Partial<Connection>): Connection {
  return {
    profileUrn: 'p',
    connectionUrn: '',
    connectedAt: NOW - 100 * DAY,
    publicId: '',
    firstName: '',
    lastName: '',
    fullName: 'Someone',
    headline: '',
    pictureUrl: '',
    syncedAt: 0,
    ...over,
  };
}

describe('computeFollowUps', () => {
  it('flags a stale messaged connection past the threshold', () => {
    const conn = c({ profileUrn: 'a' });
    const last = new Map([['a', NOW - 90 * DAY]]);
    const res = computeFollowUps([conn], last, { now: NOW });
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ reason: 'stale', days: 90 });
  });

  it('does not flag a recently-messaged connection', () => {
    const res = computeFollowUps([c({ profileUrn: 'a' })], new Map([['a', NOW - 5 * DAY]]), { now: NOW });
    expect(res).toHaveLength(0);
  });

  it('flags never-messaged connections older than minAge', () => {
    const res = computeFollowUps([c({ profileUrn: 'a', connectedAt: NOW - 30 * DAY })], new Map(), { now: NOW });
    expect(res[0]).toMatchObject({ reason: 'never', days: 30, lastContactAt: null });
  });

  it('ignores brand-new never-messaged connections', () => {
    const res = computeFollowUps([c({ profileUrn: 'a', connectedAt: NOW - 2 * DAY })], new Map(), { now: NOW });
    expect(res).toHaveLength(0);
  });

  it('prioritizes interest-tagged, then investors, then by staleness', () => {
    const plain = c({ profileUrn: 'plain', connectedAt: NOW - 300 * DAY });
    const investor = c({ profileUrn: 'inv', roleCategory: 'Investor', connectedAt: NOW - 20 * DAY });
    const tagged = c({ profileUrn: 'tag', interestTags: ['Investors'], connectedAt: NOW - 10 * DAY });
    const res = computeFollowUps([plain, investor, tagged], new Map(), { now: NOW });
    expect(res.map((f) => f.connection.profileUrn)).toEqual(['tag', 'inv', 'plain']);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => c({ profileUrn: `p${i}`, connectedAt: NOW - 50 * DAY }));
    expect(computeFollowUps(many, new Map(), { now: NOW, limit: 5 })).toHaveLength(5);
  });
});
