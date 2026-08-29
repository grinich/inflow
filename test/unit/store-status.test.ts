/**
 * The changelog marks a release as live-in-the-store or still in review using
 * /api/store-status, which parses the public Chrome Web Store listing (the
 * browser cannot: the store sends no CORS headers).
 *
 * The page belongs to Google and can change without warning, so the contract
 * under test is as much about REFUSING to guess as about parsing: a listing
 * that no longer looks like one must yield null, so the page renders no badge
 * rather than a wrong one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — plain ESM module, no type declarations.
import { parseListing, compareVersions } from '../../site/api/_cws.mjs';

const FIXTURE = readFileSync(
  join(__dirname, '..', 'fixtures', 'cws-listing.html'),
  'utf8',
);

/** The fixture is small; the parser rejects anything under 1000 chars. */
const pad = (html: string) => html + '\n<!--' + 'x'.repeat(1200) + '-->';

describe('Chrome Web Store listing parser', () => {
  it('reads the published version and its go-live time', () => {
    const out = parseListing(pad(FIXTURE));

    expect(out).not.toBeNull();
    expect(out.version).toBe('0.5.2');
    expect(out.publishedAt).toBe('2026-08-26T06:44:23.000Z');
    expect(out.updatedText).toBe('August 25, 2026');
  });

  it('does not take another extension listed on the page', () => {
    // The fixture carries a competing extension at 0.6.1 — a higher version
    // than ours, so a sloppy "find a version number" parse would prefer it and
    // wrongly mark our unreleased version as live.
    expect(FIXTURE).toContain('0.6.1');
    expect(parseListing(pad(FIXTURE)).version).toBe('0.5.2');
  });

  it('returns null rather than guessing when the page stops looking right', () => {
    expect(parseListing('')).toBeNull();
    expect(parseListing(null as never)).toBeNull();
    expect(parseListing(pad('<html><body>Sorry, page not found</body></html>'))).toBeNull();
    // Google keeps the shell but drops the Version row.
    expect(parseListing(pad(FIXTURE.replace('>Version</div>', '>Edition</div>')))).toBeNull();
  });

  it('keeps the version but drops an unparseable timestamp', () => {
    // The version row survives, the data array does not: still useful, and
    // the page can say "live" without claiming a date.
    const html = pad(FIXTURE.replace('[1787726663,', '[null,'));
    const out = parseListing(html);
    expect(out.version).toBe('0.5.2');
    expect(out.publishedAt).toBeNull();
  });

  it('rejects a timestamp outside the plausible range', () => {
    // A parse that drifts onto some other number must not become a 1977 date.
    const html = pad(FIXTURE.replace('[1787726663,', '[228096000,'));
    expect(parseListing(html).publishedAt).toBeNull();
  });

  it('never reports a version as published in the future', () => {
    const future = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    const html = pad(FIXTURE.replace('[1787726663,', `[${future},`));
    expect(parseListing(html).publishedAt).toBeNull();
  });
});

describe('version comparison', () => {
  it('orders releases numerically, not as strings', () => {
    // "0.10.0" < "0.9.0" as strings; the badge logic depends on getting this right.
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.6.0', '0.5.2')).toBe(1);
    expect(compareVersions('0.5.2', '0.6.0')).toBe(-1);
    expect(compareVersions('0.6.0', '0.6.0')).toBe(0);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
  });
});
