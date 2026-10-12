// The inbox tab labels: Focused/Other are user-renamable (default Primary/Other);
// "Other" defaults to LinkedIn's own folder name. It used to default to
// "InMail", which was wrong — that tab filters the SECONDARY_INBOX folder,
// while an InMail is a message type that lands in either folder. The separate
// (fixed-label) InMail tab is what actually selects them.
// Archive/Spam/Drafts/Scheduled are fixed.
import { tabLabel, normalizeInboxLabels, DEFAULT_INBOX_LABELS } from '@/lib/inbox-labels';

describe('inbox labels', () => {
  it('defaults to Primary / Other, naming the folder it actually filters', () => {
    expect(DEFAULT_INBOX_LABELS).toEqual({ focused: 'Primary', other: 'Other' });
  });

  it('resolves renamable tabs from the given labels', () => {
    const labels = { focused: 'Clients', other: 'Recruiters' };
    expect(tabLabel('focused', labels)).toBe('Clients');
    expect(tabLabel('other', labels)).toBe('Recruiters');
  });

  it('keeps the fixed tabs fixed regardless of overrides', () => {
    const labels = { focused: 'A', other: 'B' };
    expect(tabLabel('archived', labels)).toBe('Archive');
    expect(tabLabel('spam', labels)).toBe('Spam');
    expect(tabLabel('drafts', labels)).toBe('Drafts');
    expect(tabLabel('scheduled', labels)).toBe('Scheduled');
  });

  it('falls back to the default when a custom label is blank', () => {
    expect(tabLabel('focused', { focused: '   ', other: 'X' })).toBe('Primary');
    expect(tabLabel('other', { focused: 'X', other: '' })).toBe('Other');
  });

  it('normalizes partial / empty stored data to a complete set', () => {
    expect(normalizeInboxLabels(null)).toEqual(DEFAULT_INBOX_LABELS);
    expect(normalizeInboxLabels({ focused: 'Leads' })).toEqual({ focused: 'Leads', other: 'Other' });
    expect(normalizeInboxLabels({ focused: '  ', other: '  ' })).toEqual(DEFAULT_INBOX_LABELS);
  });
});
