/**
 * AI network suggestions: tag parsing, tag proposal, and re-categorization diff.
 */
import {
  parseTagSuggestions,
  suggestInterestTags,
  diffRoles,
  pickRecatSample,
} from '@/lib/connection-suggestions';
import type { Connection } from '@/types/connection';
import type { ClassifyResult } from '@/lib/connection-classifier';

function c(over: Partial<Connection>): Connection {
  return {
    profileUrn: 'p',
    connectionUrn: '',
    connectedAt: 0,
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

describe('parseTagSuggestions', () => {
  it('parses strings and excludes existing (case-insensitive)', () => {
    const out = parseTagSuggestions('["Design leaders","investors","Fintech founders"]', ['Investors']);
    expect(out).toEqual(['Design leaders', 'Fintech founders']);
  });
  it('dedupes and caps at 6', () => {
    const out = parseTagSuggestions('["a","a","b","c","d","e","f","g"]', []);
    expect(out).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
  it('returns [] on non-JSON', () => {
    expect(parseTagSuggestions('nope', [])).toEqual([]);
  });
});

describe('suggestInterestTags', () => {
  it('sends headlines and returns parsed tags', async () => {
    const predict = vi.fn().mockResolvedValue('["Design leaders"]');
    const out = await suggestInterestTags([c({ headline: 'Head of Design at Acme' })], [], predict);
    expect(out).toEqual(['Design leaders']);
    expect(predict.mock.calls[0][0]).toContain('Head of Design at Acme');
  });
  it('skips the model when there are no headlines', async () => {
    const predict = vi.fn();
    expect(await suggestInterestTags([c({ headline: '' })], [], predict)).toEqual([]);
    expect(predict).not.toHaveBeenCalled();
  });
});

describe('diffRoles', () => {
  it('surfaces concrete role changes but never demotions to Other', () => {
    const conns = [
      c({ profileUrn: 'a', roleCategory: 'Other', headline: 'GP at Foo' }),
      c({ profileUrn: 'b', roleCategory: 'Investor' }), // unchanged
      c({ profileUrn: 'd', roleCategory: 'Investor' }), // model says Other → ignored
    ];
    const results = new Map<string, ClassifyResult>([
      ['a', { roleCategory: 'Investor', interestTags: [] }],
      ['b', { roleCategory: 'Investor', interestTags: [] }],
      ['d', { roleCategory: 'Other', interestTags: [] }],
    ]);
    const out = diffRoles(conns, results);
    expect(out).toEqual([
      { profileUrn: 'a', fullName: 'Someone', headline: 'GP at Foo', from: 'Other', to: 'Investor' },
    ]);
  });
});

describe('pickRecatSample', () => {
  it('prioritizes Other/uncategorized, then most recent, and caps', () => {
    const conns = [
      c({ profileUrn: 'named-old', roleCategory: 'Investor', connectedAt: 1 }),
      c({ profileUrn: 'other-old', roleCategory: 'Other', connectedAt: 2 }),
      c({ profileUrn: 'uncat-new', connectedAt: 9 }),
    ];
    const out = pickRecatSample(conns, 2).map((x) => x.profileUrn);
    // uncategorized/Other first (newest among them first), named last (dropped by cap).
    expect(out).toEqual(['uncat-new', 'other-old']);
  });
});
