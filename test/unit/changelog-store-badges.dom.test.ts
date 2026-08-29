// @vitest-environment jsdom
/**
 * The changelog marks each release with whether it is live in the Chrome Web
 * Store, from /api/store-status. The badge is pure enhancement: the page is
 * complete and correct without it, so the rule these tests enforce is that a
 * bad or missing answer adds NOTHING rather than something wrong.
 *
 * The real script is executed out of site/changelog.html, so these fail
 * against the shipped page rather than a copy of its logic.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGE = readFileSync(
  join(__dirname, '..', '..', 'site', 'changelog.html'),
  'utf8',
);

/** The badge script is the one that talks to /api/store-status. */
const SCRIPT = (() => {
  const blocks = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((b) => b.includes('/api/store-status'));
  if (!found) throw new Error('no script in changelog.html fetches /api/store-status');
  return found;
})();

/** A stand-in for the generated release list: one .rel per version. */
function renderReleases(versions: string[]) {
  document.body.innerHTML = versions
    .map(
      (v) => `<article class="rel"><div class="rel-meta">
        <h2 class="rel-ver">${v}</h2>
        <time class="rel-date">1 January 2026</time>
      </div><div class="rel-body"></div></article>`,
    )
    .join('');
}

/** Run the page's script with fetch stubbed, then let its promise chain settle. */
async function run(fetchImpl: () => Promise<unknown>) {
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  new Function(SCRIPT)();
  await new Promise((r) => setTimeout(r, 5));
}

const json = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

const badges = () =>
  [...document.querySelectorAll('.rel')].map((rel) => ({
    version: rel.querySelector('.rel-ver')!.textContent!.trim(),
    text: rel.querySelector('.rel-store')?.textContent ?? null,
    cls: rel.querySelector('.rel-store')?.className ?? null,
  }));

const LIVE = {
  ok: true,
  chrome: {
    version: '0.5.2',
    publishedAt: '2026-08-26T06:44:23.000Z',
    updatedText: 'August 25, 2026',
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('changelog store badges', () => {
  it('marks the live version, and only newer ones as in review', async () => {
    renderReleases(['0.6.0', '0.5.2', '0.5.1']);
    await run(() => json(LIVE));

    const [next, live, old] = badges();
    expect(next.cls).toContain('is-pending');
    expect(next.text).toBe('Submitted — in review');
    expect(live.cls).toContain('is-live');
    expect(live.text).toMatch(/^In the Chrome Web Store since /);
    // Older releases were live once, but Google keeps no record of when.
    expect(old.text).toBeNull();
  });

  it('compares versions numerically, not as strings', async () => {
    // "0.10.0" sorts BELOW "0.9.0" as a string; that would wrongly mark a
    // shipped 0.10.0 as still in review.
    renderReleases(['0.10.0', '0.9.0']);
    await run(() => json({ ...LIVE, chrome: { ...LIVE.chrome, version: '0.10.0' } }));

    expect(badges()[0].cls).toContain('is-live');
    expect(badges()[1].text).toBeNull();
  });

  it('says it is live without inventing a date when the timestamp is missing', async () => {
    renderReleases(['0.5.2']);
    await run(() => json({ ok: true, chrome: { version: '0.5.2', publishedAt: null } }));

    expect(badges()[0].text).toBe('In the Chrome Web Store');
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a 5xx', () => Promise.resolve({ ok: false, status: 500 })],
    ['ok:false from the API', () => json({ ok: false, reason: 'listing did not parse' })],
    ['malformed JSON', () => Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) })],
    ['a payload with no version', () => json({ ok: true, chrome: {} })],
    ['a null payload', () => json(null)],
  ])('adds no badge at all on %s', async (_label, impl) => {
    renderReleases(['0.6.0', '0.5.2']);
    await run(impl as () => Promise<unknown>);

    expect(document.querySelectorAll('.rel-store')).toHaveLength(0);
    // And the release list itself is untouched.
    expect(document.querySelectorAll('.rel')).toHaveLength(2);
  });

  it('ignores a heading that is not a version number', async () => {
    renderReleases(['Unreleased', '0.5.2']);
    await run(() => json(LIVE));

    expect(badges()[0].text).toBeNull();
    expect(badges()[1].cls).toContain('is-live');
  });

  it('carries the exact instant in the title, since the label is a local day', async () => {
    renderReleases(['0.5.2']);
    await run(() => json(LIVE));

    expect(document.querySelector('.rel-store')!.getAttribute('title'))
      .toBe('2026-08-26T06:44:23.000Z');
  });
});
