/**
 * Link previews (Open Graph / X) for the site.
 *
 * The failure mode worth guarding is silent: a card that renders blank in
 * every feed and chat, with nothing wrong on the site itself. Scrapers do not
 * run JS, do not resolve relative URLs, and cache aggressively — so the image
 * has to be an absolute URL, it has to actually be committed, and the declared
 * dimensions have to match the file (0.6.0 nearly shipped with PWA icons that
 * existed only in the working tree).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SITE = join(ROOT, 'site');
const PAGES = ['index.html', 'changelog.html', 'privacy.html', 'app.html'];

const OG_PNG = join(SITE, 'og.png');
const DECLARED_WIDTH = 1200;
const DECLARED_HEIGHT = 630;

function meta(html: string, attr: 'property' | 'name', key: string) {
  const re = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`);
  return re.exec(html)?.[1] ?? null;
}

describe.each(PAGES)('%s link preview', (page) => {
  const html = readFileSync(join(SITE, page), 'utf8');

  it('points at an absolute image URL', () => {
    // A relative path here is the classic blank-card bug: scrapers have no
    // base to resolve it against.
    for (const url of [meta(html, 'property', 'og:image'), meta(html, 'name', 'twitter:image')]) {
      expect(url).toMatch(/^https:\/\/inflow\.im\//);
    }
  });

  it('declares the large-image card with a title, description and alt', () => {
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
    for (const [attr, key] of [
      ['property', 'og:title'], ['property', 'og:description'], ['property', 'og:url'],
      ['property', 'og:image:alt'], ['name', 'twitter:title'], ['name', 'twitter:description'],
    ] as const) {
      expect(meta(html, attr, key), `${page} is missing ${key}`).toBeTruthy();
    }
  });

  it('declares the size the file actually is', () => {
    expect(meta(html, 'property', 'og:image:width')).toBe(String(DECLARED_WIDTH));
    expect(meta(html, 'property', 'og:image:height')).toBe(String(DECLARED_HEIGHT));
  });
});

describe('og.png', () => {
  it('is a PNG of exactly the declared size', () => {
    const head = readFileSync(OG_PNG).subarray(0, 24);
    expect(head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe(true);
    expect(head.readUInt32BE(16)).toBe(DECLARED_WIDTH);
    expect(head.readUInt32BE(20)).toBe(DECLARED_HEIGHT);
  });

  it('is committed, not just present in the working tree', () => {
    // Vercel deploys from git: a file only on this disk 404s in production.
    const tracked = execFileSync('git', ['ls-files', 'site/og.png'], { cwd: ROOT })
      .toString().trim();
    expect(tracked, 'site/og.png is not tracked by git').toBe('site/og.png');
  });

  it('stays small enough for the scrapers that impose a limit', () => {
    // X drops images over 5MB; well under it also keeps the card quick.
    expect(statSync(OG_PNG).size).toBeLessThan(2 * 1024 * 1024);
  });
});
