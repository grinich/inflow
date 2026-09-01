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

import { trackTimers } from '../helpers/shell-timers';

// The shell script leaves timers running; a tick after this file's jsdom env
// is torn down crashes the worker (see test/helpers/shell-timers.ts).
let __untrackTimers: (() => void) | null = null;
beforeEach(() => { __untrackTimers = trackTimers(); });
afterEach(() => { __untrackTimers?.(); __untrackTimers = null; });


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

/** A stand-in for the generated release list: one .rel per version, with the
 *  build's "Latest" chip on the newest entry, as build-changelog.mjs emits. */
function renderReleases(versions: string[]) {
  document.body.innerHTML = versions
    .map(
      (v, i) => `<article class="rel"><div class="rel-meta">
        <h2 class="rel-ver">${v}</h2>
        <time class="rel-date">1 January 2026</time>
        ${i === 0 ? '<span class="rel-latest">Latest</span>' : ''}
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
    chip: rel.querySelector('.rel-latest')?.textContent ?? null,
  }));

const LIVE = {
  ok: true,
  chrome: {
    version: '0.5.2',
    publishedAt: '2026-08-26T06:44:23.000Z',
    updatedText: 'August 25, 2026',
  },
  // The newest STABLE GitHub release — proof a version was submitted.
  github: { latestStable: '0.6.0' },
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('changelog store badges', () => {
  it('marks the live version, and newer SUBMITTED ones as in review', async () => {
    renderReleases(['0.6.0', '0.5.2', '0.5.1']);
    await run(() => json(LIVE));

    const [next, live, old] = badges();
    expect(next.cls).toContain('is-pending');
    expect(next.text).toBe('Submitted — in review');
    expect(next.chip).toBe('Development'); // newest, not what the store serves
    expect(live.cls).toContain('is-live');
    expect(live.text).toMatch(/^In the Chrome Web Store since /);
    expect(live.chip).toBe('Live');
    // Older releases were live once, but Google keeps no record of when.
    expect(old.text).toBeNull();
  });

  it('a version newer than the latest stable release is development, not in review', async () => {
    // 0.8.0 exists only as a beta tag: no stable GitHub release, so nothing
    // was submitted — it must not read as awaiting review.
    renderReleases(['0.8.0', '0.7.0', '0.6.0']);
    await run(() =>
      json({ ...LIVE, chrome: { ...LIVE.chrome, version: '0.6.0' }, github: { latestStable: '0.7.0' } })
    );

    const [beta, submitted, live] = badges();
    expect(beta.text).toBeNull();
    expect(beta.chip).toBe('Development');
    expect(submitted.text).toBe('Submitted — in review');
    expect(live.chip).toBe('Live');
  });

  it('without stable-release data, nothing is called in review', async () => {
    renderReleases(['0.6.0', '0.5.2']);
    await run(() => json({ ...LIVE, github: undefined }));

    expect(badges()[0].text).toBeNull();
    expect(badges()[0].chip).toBe('Development');
    expect(badges()[1].cls).toContain('is-live');
  });

  describe('the beta entry', () => {
    /** The generated markup for a beta release, per build-changelog.mjs. */
    function renderWithBeta() {
      document.body.innerHTML = `
        <article class="rel is-beta"><div class="rel-meta">
          <h2 class="rel-ver">0.8.0</h2>
          <span class="rel-latest is-beta">Beta</span>
          <span class="rel-beta-link"></span>
        </div><div class="rel-body"></div></article>
        <article class="rel"><div class="rel-meta">
          <h2 class="rel-ver">0.5.2</h2><time class="rel-date">1 January 2026</time>
        </div><div class="rel-body"></div></article>`;
    }
    const link = () => document.querySelector<HTMLAnchorElement>('.rel-beta-link a');

    it('links the current prerelease, so the markdown never names a stale tag', async () => {
      renderWithBeta();
      await run(() =>
        json({
          ...LIVE,
          github: {
            latestStable: '0.5.2',
            latestPrerelease: {
              version: '0.8.0-beta.4',
              tag: 'v0.8.0-beta.4',
              url: 'https://github.com/grinich/inflow/releases/tag/v0.8.0-beta.4',
            },
          },
        })
      );
      expect(link()?.href).toBe('https://github.com/grinich/inflow/releases/tag/v0.8.0-beta.4');
      expect(link()?.textContent).toBe('Try 0.8.0-beta.4 →');
    });

    it('keeps the Beta chip rather than relabelling it Development', async () => {
      renderWithBeta();
      await run(() => json({ ...LIVE, github: { latestStable: '0.5.2' } }));
      expect(document.querySelector('.rel.is-beta .rel-latest')?.textContent).toBe('Beta');
    });

    it('adds no link when there is no prerelease to point at', async () => {
      renderWithBeta();
      await run(() => json({ ...LIVE, github: { latestStable: '0.5.2' } }));
      expect(link()).toBeNull();
    });
  });

  it('re-labels the Latest chip to Live when the newest version is the live one', async () => {
    renderReleases(['0.5.2', '0.5.1']);
    await run(() => json(LIVE));

    expect(badges()[0].chip).toBe('Live');
    expect(badges()[0].cls).toContain('is-live');
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
