// The changelog page on inflow.im is generated from CHANGELOG.md, so the two
// can drift the moment a release is written up and the page is not rebuilt.
// This suite is the guard: `npm test` already gates every release, so a stale
// page fails there rather than shipping a site that is missing a version.
import {
  build,
  formatDate,
  brandify,
  inline,
  parseReleases,
  renderReleases,
  // @ts-expect-error — plain ESM script, no type declarations.
} from '../../scripts/build-changelog.mjs';

describe('changelog site build', () => {
  it('keeps site/changelog.html in sync with CHANGELOG.md', () => {
    const { page, next } = build() as { page: string; next: string };
    expect(
      page === next,
      'site/changelog.html is stale — run `npm run changelog:site`',
    ).toBe(true);
  });

  it('renders every shipped release and hides Unreleased', () => {
    const releases = parseReleases(`# Changelog

## [Unreleased]

### Added
- Something not shipped yet.

## [1.2.0] - 2026-07-13

### Fixed
- A real fix.
`) as Array<{ version: string }>;

    expect(releases.map((r) => r.version)).toEqual(['Unreleased', '1.2.0']);

    const html = renderReleases(releases) as string;
    expect(html).toContain('1.2.0');
    expect(html).not.toContain('Unreleased');
    expect(html).not.toContain('Something not shipped yet');
  });

  it('marks the newest dated release as Latest, and only that one', () => {
    const releases = parseReleases(`# Changelog

## [Unreleased]

### Added
- Pending.

## [2.0.0] - 2026-08-01

### Added
- New.

## [1.0.0] - 2026-01-01

### Added
- Old.
`);
    const html = renderReleases(releases) as string;
    expect(html.match(/rel-latest/g)).toHaveLength(1);
    expect(html.indexOf('rel-latest')).toBeLessThan(html.indexOf('1.0.0'));
  });

  it('formats dates without letting a timezone shift the day', () => {
    // `new Date('2026-07-13')` is UTC midnight, which is 12 July in the Americas.
    expect(formatDate('2026-07-13')).toBe('13 July 2026');
    expect(formatDate('2026-01-01')).toBe('1 January 2026');
  });

  describe('inline markdown', () => {
    it('renders bold, italic, code, and links', () => {
      expect(inline('**bold**')).toBe('<strong>bold</strong>');
      expect(inline('an *old* message')).toBe('an <em>old</em> message');
      expect(inline('`code`')).toBe('<code>code</code>');
      expect(inline('[text](https://example.com)')).toBe(
        '<a href="https://example.com">text</a>',
      );
    });

    it('links bare GitHub references the way the markdown writes them', () => {
      expect(inline('Thanks @qchuchu (#4).')).toBe(
        'Thanks <a href="https://github.com/qchuchu">@qchuchu</a> ' +
        '(<a href="https://github.com/grinich/inflow/issues/4">#4</a>).',
      );
    });

    it('escapes HTML so a changelog entry cannot inject markup', () => {
      expect(inline('a <script>alert(1)</script> entry')).toBe(
        'a &lt;script&gt;alert(1)&lt;/script&gt; entry',
      );
    });

    it('writes the brand mark, but never inside a URL or an identifier', () => {
      // CHANGELOG.md stays plain ASCII (terminal, git, GitHub release notes);
      // the mark is applied when rendering the site.
      expect(brandify('inflow becomes an app')).toBe('inƒlow becomes an app');
      expect(brandify("inflow's own notifications")).toBe("inƒlow's own notifications");

      // These must survive verbatim or they stop working.
      expect(brandify('https://inflow.im/app')).toBe('https://inflow.im/app');
      expect(brandify('github.com/grinich/inflow/issues')).toBe('github.com/grinich/inflow/issues');
      expect(brandify('inflow-notif-asked')).toBe('inflow-notif-asked');
      expect(brandify('inflow.im')).toBe('inflow.im');
    });

    it('leaves the brand mark out of code spans', () => {
      // A reader copies code verbatim; ƒ would break it.
      expect(inline('run `inflow --help`')).toBe('run <code>inflow --help</code>');
    });

    it('brands the prose around a link without touching its href', () => {
      const html = inline('inflow lives at [inflow.im/app](https://inflow.im/app)') as string;
      expect(html).toContain('inƒlow lives at');
      expect(html).toContain('href="https://inflow.im/app"');
      expect(html).toContain('>inflow.im/app</a>');
    });

    it('renders images, and does not mistake one for a link', () => {
      // `![alt](src)` also matches the link pattern; without image handling
      // first it renders as a literal "!" followed by a link to the PNG.
      // alt is assistive copy, so it carries the brand mark; the src must not.
      expect(inline('![inflow](https://inflow.im/a.png)')).toBe(
        '<img class="rel-shot" src="https://inflow.im/a.png" ' +
        'alt="inƒlow" loading="lazy">',
      );
      expect(inline('![](https://inflow.im/a.png)')).toContain('alt=""');
      expect(inline('![x](https://inflow.im/a.png)')).not.toContain('<a href');
    });

    it('sizes an image by its title: "icon" is a mark, anything else a shot', () => {
      // Without this every image rendered at the icon's 96px, which turns a
      // screenshot into an unreadable thumbnail.
      expect(inline('![m](https://inflow.im/icons/app-icon-192.png "icon")'))
        .toContain('class="rel-icon"');
      expect(inline('![s](https://inflow.im/img/shot.png)'))
        .toContain('class="rel-shot"');
      // The title is a hint, not content: it must not leak into the markup.
      expect(inline('![m](https://inflow.im/i.png "icon")')).not.toContain('icon"</');
      expect(inline('![m](https://inflow.im/i.png "icon")')).not.toContain('&quot;');
    });

    it('escapes quotes in image attributes so alt text cannot break out', () => {
      const html = inline('![a" onerror="alert(1)](https://inflow.im/a.png)') as string;
      expect(html).not.toContain('onerror="');
      expect(html).toContain('&quot;');
    });

    it('leaves code span contents alone', () => {
      // Without protection, the ** inside would become <strong>.
      expect(inline('use `a**b` here')).toBe('use <code>a**b</code> here');
      expect(inline('`inflow-<version>-chrome.zip`')).toBe(
        '<code>inflow-&lt;version&gt;-chrome.zip</code>',
      );
    });
  });

  it('keeps nested bullets nested', () => {
    const releases = parseReleases(`# Changelog

## [1.0.0] - 2026-01-01

### Fixed
- **Parent** — a group of fixes:
  - First child.
  - Second child.
`);
    const html = renderReleases(releases) as string;
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>First child.</li>');
    expect(html).toContain('<li>Second child.</li>');
    // The children sit inside the parent <li>, not as siblings after it.
    expect(html.indexOf('First child')).toBeGreaterThan(html.indexOf('<strong>Parent</strong>'));
  });

  it('passes a raw HTML block through, but still escapes prose', () => {
    // Side-by-side images have to render in two renderers: GitHub stacks
    // markdown images and strips class attributes, so width attributes on raw
    // HTML are the only thing both it and the site honour.
    const releases = parseReleases(`# Changelog

## [1.0.0] - 2026-01-01

An intro line.

<p>
<img src="https://inflow.im/img/a.png" width="49%" alt="A">
<img src="https://inflow.im/img/b.png" width="49%" alt="B">
</p>

### Added
- Thing with a <script> in the prose.
`);
    const html = renderReleases(releases) as string;

    expect(html).toContain('<img src="https://inflow.im/img/a.png" width="49%"');
    expect(html).toContain('<img src="https://inflow.im/img/b.png" width="49%"');
    // Not wrapped in the intro paragraph, and not escaped.
    expect(html).not.toContain('&lt;img');
    // Prose is still escaped — passthrough is for blocks that OPEN with a tag.
    expect(html).toContain('&lt;script&gt;');
  });

  it('carries a release intro paragraph and an IMPORTANT callout', () => {
    const releases = parseReleases(`# Changelog

## [1.0.0] - 2026-01-01

An intro line.

> [!IMPORTANT]
> **Heads up.** Something to know.

### Added
- Thing.
`);
    const html = renderReleases(releases) as string;
    expect(html).toContain('<p class="rel-intro">An intro line.</p>');
    expect(html).toContain('rel-callout');
    expect(html).toContain('<strong>Heads up.</strong> Something to know.');
    expect(html).not.toContain('[!IMPORTANT]');
  });
});
