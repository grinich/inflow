/**
 * Changelog parsing + "which releases to show after an update" selection.
 */
import {
  parseChangelog,
  releasesSince,
  releaseForVersion,
} from '@/lib/changelog';

const SAMPLE = `# Changelog

Intro prose that should be ignored.

## [0.5.0] - 2026-08-09

### Added
- **Insights** — a new section with network composition
  and firm clustering.
- Backup and restore.

### Fixed
- A silent categorization failure.

## [0.4.0] - 2026-07-13

### Added
- Sender avatars in notifications.
`;

describe('parseChangelog', () => {
  it('parses versions, dates, groups, and bullets', () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries.map((e) => e.version)).toEqual(['0.5.0', '0.4.0']);
    expect(entries[0].date).toBe('2026-08-09');

    const added = entries[0].groups.find((g) => g.label === 'Added')!;
    expect(added.items[0]).toContain('Insights');
    // Continuation line is joined; bold markers stripped.
    expect(added.items[0]).toContain('firm clustering');
    expect(added.items[0]).not.toContain('**');
    expect(entries[0].groups.find((g) => g.label === 'Fixed')!.items).toHaveLength(1);
  });

  it('ignores intro prose before the first release', () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries).toHaveLength(2);
  });
});

describe('releasesSince', () => {
  const entries = parseChangelog(SAMPLE);

  it('returns releases newer than seen, up to current, newest first', () => {
    const res = releasesSince(entries, '0.4.0', '0.5.0');
    expect(res.map((e) => e.version)).toEqual(['0.5.0']);
  });

  it('returns nothing when already on the seen version', () => {
    expect(releasesSince(entries, '0.5.0', '0.5.0')).toEqual([]);
  });

  it('returns nothing on a fresh install (no seen version)', () => {
    expect(releasesSince(entries, null, '0.5.0')).toEqual([]);
  });

  it('does not include releases newer than the running version', () => {
    expect(releasesSince(entries, '0.3.0', '0.4.0').map((e) => e.version)).toEqual(['0.4.0']);
  });
});

describe('releaseForVersion', () => {
  it('finds a specific version or returns null', () => {
    const entries = parseChangelog(SAMPLE);
    expect(releaseForVersion(entries, '0.4.0')?.version).toBe('0.4.0');
    expect(releaseForVersion(entries, '9.9.9')).toBeNull();
  });
});
