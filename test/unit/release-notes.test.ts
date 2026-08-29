/**
 * The GitHub Release body is built from CHANGELOG.md by
 * scripts/release-notes.mjs. GitHub renders release notes with hard line
 * breaks ON, so the markdown's ~78-column wrapping would otherwise show up as
 * real line breaks — a ragged half-width column beside any paragraph written
 * as one long line (which is how v0.6.0 first shipped).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildReleaseNotes,
  extractSection,
  unwrap,
  HOW_TO_UPDATE,
  // @ts-expect-error — plain ESM script, no type declarations.
} from '../../scripts/release-notes.mjs';

const CHANGELOG = readFileSync(join(__dirname, '..', '..', 'CHANGELOG.md'), 'utf8');

const SAMPLE = `# Changelog

## [Unreleased]

### Added
- Not shipped.

## [1.2.0] - 2026-07-13

An intro sentence that the author
wrapped over two lines.

### Added
- **A bullet** — whose text runs on
  across several source lines
  like this one.
- A second bullet.
  - A nested child that also
    wraps.

### Fixed
- One more.

## [1.1.0] - 2026-06-01

### Fixed
- Older release.

[1.2.0]: https://github.com/grinich/inflow/releases/tag/v1.2.0
`;

describe('release notes', () => {
  it('takes only the requested version, stopping at the next heading', () => {
    const section = unwrap(extractSection(SAMPLE, '1.2.0'));
    expect(section).toContain('A bullet');
    expect(section).not.toContain('Not shipped');
    expect(section).not.toContain('Older release');
    expect(section).not.toContain('1.1.0');
  });

  it('joins wrapped bullets into one line each', () => {
    const lines = unwrap(extractSection(SAMPLE, '1.2.0')).split('\n');

    expect(lines).toContain(
      '- **A bullet** — whose text runs on across several source lines like this one.',
    );
    expect(lines).toContain('- A second bullet.');
    // Nested items keep their indentation, so they stay nested.
    expect(lines).toContain('  - A nested child that also wraps.');
  });

  it('joins a wrapped paragraph', () => {
    expect(unwrap(extractSection(SAMPLE, '1.2.0'))).toContain(
      'An intro sentence that the author wrapped over two lines.',
    );
  });

  it('keeps the breaks that carry meaning', () => {
    const out = unwrap(extractSection(SAMPLE, '1.2.0'));
    expect(out).toContain('\n### Added\n');
    expect(out).toContain('\n### Fixed\n');
    // Headings keep a blank line before them, and items stay separate lines.
    expect(out).not.toMatch(/### Added\n\n\n/);
  });

  it('never leaves a continuation line indented, which would read as code', () => {
    // A 4-space-indented line is an indented code block in markdown; unwrapping
    // must not produce one from a wrapped bullet.
    for (const line of unwrap(extractSection(CHANGELOG, '0.6.0')).split('\n')) {
      if (/^\s*[-*+] /.test(line)) continue; // list markers may indent
      expect(line).not.toMatch(/^ {4,}\S/);
    }
  });

  it('leaves blockquote alerts alone so GitHub still renders them', () => {
    const out = unwrap([
      '> [!IMPORTANT]',
      '> **Heads up.** Something',
      '> to know.',
    ]);
    // The marker must stay on its own line.
    expect(out.split('\n')[0]).toBe('> [!IMPORTANT]');
  });

  it('builds the real 0.6.0 body with its image and the update section', () => {
    const notes = buildReleaseNotes('0.6.0', CHANGELOG) as string;

    // The "icon" title is a size hint for the site; GitHub renders it as a
    // tooltip, which is harmless.
    expect(notes).toContain('![The inƒlow app icon](https://inflow.im/icons/app-icon-192.png "icon")');
    // The desktop-app screenshots must reach the release page too, and by
    // absolute URL — GitHub has no base to resolve a relative one against.
    for (const shot of ['dark', 'light']) {
      expect(notes).toContain(`https://inflow.im/img/0.6.0-desktop-app-${shot}.png`);
    }
    expect(notes).toContain(HOW_TO_UPDATE);
    expect(notes).not.toContain('## [0.5.2]');
    // The defect this guards: no bullet may still be split across lines.
    expect(notes).toContain(
      '- **Unread count on the dock icon** — when inflow is installed as a desktop app,',
    );
  });

  it('refuses a version that has no section rather than shipping an empty body', () => {
    expect(() => buildReleaseNotes('9.9.9', CHANGELOG)).toThrow(/9\.9\.9/);
  });
});
