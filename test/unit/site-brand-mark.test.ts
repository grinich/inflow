/**
 * The brand is written "inƒlow" everywhere the site shows it to a reader.
 *
 * This guards the rule in both directions, because both failures are easy to
 * make by hand: visible copy that says plain "inflow", and — worse — a URL,
 * a localStorage key, or an SVG id that got the ƒ and silently stopped
 * working.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..', '..', 'site');
const PAGES = ['index.html', 'changelog.html', 'privacy.html', 'app.html'];

/** Contents a reader never sees as prose, and which must stay ASCII. */
const SKIP_BLOCK = /<(script|style|code|kbd|pre)\b[^>]*>[\s\S]*?<\/\1>/gi;
/** Tags, so attribute values (href, src, class, id) are excluded from prose. */
const TAG = /<[^>]*>/g;

/** Plain "inflow" as a standalone word — not a domain, path, or identifier. */
const UNBRANDED = /(?<![/\w.-])inflow(?![\w-]|\.im)/;

function visibleText(html: string): string {
  return html.replace(SKIP_BLOCK, ' ').replace(TAG, ' ');
}

describe.each(PAGES)('%s', (page) => {
  const html = readFileSync(join(SITE, page), 'utf8');

  it('shows the brand mark, never a plain "inflow", in visible copy', () => {
    const offenders = visibleText(html)
      .split(/\n+/)
      .filter((line) => UNBRANDED.test(line))
      .map((line) => line.trim().slice(0, 100));

    expect(offenders, `${page} has unbranded copy`).toEqual([]);
  });

  it('keeps the mark out of anything a machine reads', () => {
    // A ƒ in any of these is a broken link, a dead lookup, or a missing icon.
    expect(html).not.toContain('inƒlow.im');
    expect(html).not.toContain('grinich/inƒlow');
    expect(html).not.toMatch(/inƒlow-(notif|install|notify|site|mark|envelope)/);
    expect(html).not.toMatch(/(href|src)="[^"]*inƒlow/);
    expect(html).not.toMatch(/\bid="[^"]*inƒlow/);
  });
});

describe('the mark itself', () => {
  it('is the hooked f (U+0192), not a lookalike', () => {
    const html = readFileSync(join(SITE, 'index.html'), 'utf8');
    expect(html).toContain('inƒlow');
    // ﬂ (U+FB02 LATIN SMALL LIGATURE FL) renders similarly and would break
    // text search for the brand.
    expect(html).not.toContain('inﬂow');
  });
});
