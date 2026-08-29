/**
 * site/vercel.json carries routing the product depends on: clean URLs make
 * /app serve app.html, and the /home rewrite is the escape hatch from the
 * homepage's extension-detected redirect to /app.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const config = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'site', 'vercel.json'), 'utf8')
);

describe('site vercel.json', () => {
  it('serves clean URLs so /app maps to app.html', () => {
    expect(config.cleanUrls).toBe(true);
  });

  it('rewrites /home to the homepage (escape hatch from the / → /app redirect)', () => {
    expect(config.rewrites).toContainEqual({ source: '/home', destination: '/' });
  });

  it('keeps PWA icons cacheable and the manifest typed correctly', () => {
    const sources = (config.headers ?? []).map((h: { source: string }) => h.source);
    expect(sources).toContain('/icons/(.*)');
    expect(sources).toContain('/app.webmanifest');
  });

  it('forbids framing site pages (the /app shell holds the user\'s real inbox)', () => {
    const all = (config.headers ?? []).find((h: { source: string }) => h.source === '/(.*)');
    expect(all).toBeDefined();
    const keys = Object.fromEntries(all.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(keys['X-Frame-Options']).toBe('DENY');
    expect(keys['Content-Security-Policy']).toContain("frame-ancestors 'none'");
  });
});
