// @vitest-environment jsdom
/**
 * inflow ships to both the Chrome Web Store and Edge Add-ons, but the pages
 * are written for Chrome. site/store-cta.js rewrites them on Edge.
 *
 * The failure that matters: an Edge visitor sent to the Chrome Web Store,
 * which offers them nothing they can install. The near-miss that matters
 * almost as much: a Chrome visitor rewritten to Edge because the UA sniff was
 * too loose.
 *
 * Runs the real shipped script against the real shipped pages.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..', '..', 'site');
const SCRIPT = readFileSync(join(SITE, 'store-cta.js'), 'utf8');

const EDGE_URL =
  'https://microsoftedge.microsoft.com/addons/detail/inflow-%E2%80%94-a-better-inbox-f/ojhcjmmdiekppielgogbdheogapbipnk';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const EDGE_UA = CHROME_UA + ' Edg/151.0.0.0';

/** Load a real page, fake the browser, run the real script. */
function boot(
  page: string,
  opts: { ua?: string; brands?: { brand: string }[] | null; search?: string } = {}
) {
  const html = readFileSync(join(SITE, page), 'utf8');
  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<body[^>]*>/i, '')
    .replace(/<\/body>[\s\S]*$/i, '');

  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: opts.ua ?? CHROME_UA,
  });
  Object.defineProperty(navigator, 'userAgentData', {
    configurable: true,
    value: opts.brands === undefined ? undefined : opts.brands ? { brands: opts.brands } : undefined,
  });
  window.history.replaceState(null, '', `/${page}${opts.search ?? ''}`);
  sessionStorage.clear();

  // eslint-disable-next-line no-new-func — running the shipped script verbatim.
  new Function(SCRIPT)();
}

const storeLinks = () =>
  [...document.querySelectorAll('a[href*="chromewebstore.google.com"]')];
const edgeLinks = () => [...document.querySelectorAll(`a[href="${EDGE_URL}"]`)];
const bodyText = () => document.body.textContent ?? '';

afterEach(() => {
  document.documentElement.innerHTML = '';
  sessionStorage.clear();
});

describe('on Chrome', () => {
  it('leaves every page exactly as written', () => {
    for (const page of ['index.html', 'changelog.html', 'privacy.html', 'app.html']) {
      boot(page, { brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] });
      expect(storeLinks().length, `${page} keeps its Chrome links`).toBeGreaterThan(0);
      expect(edgeLinks(), `${page} adds no Edge link`).toHaveLength(0);
    }
  });

  it('is not fooled into Edge by a Chrome UA that merely contains "Edg"', () => {
    // A brand list is authoritative when present; the UA sniff is the fallback
    // and must not match a substring like "Edge" inside a product token.
    boot('index.html', {
      brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }],
      ua: CHROME_UA + ' NotEdg/1.0',
    });
    expect(edgeLinks()).toHaveLength(0);
  });
});

describe('on Edge', () => {
  it('sends every store link to Edge Add-ons instead', () => {
    for (const page of ['index.html', 'changelog.html', 'privacy.html', 'app.html']) {
      boot(page, { brands: [{ brand: 'Chromium' }, { brand: 'Microsoft Edge' }] });
      expect(storeLinks(), `${page} has no Chrome Web Store links left`).toHaveLength(0);
      expect(edgeLinks().length, `${page} points at Edge Add-ons`).toBeGreaterThan(0);
    }
  });

  it('detects Edge from the UA when no brand list is available', () => {
    boot('index.html', { brands: undefined, ua: EDGE_UA });
    expect(edgeLinks().length).toBeGreaterThan(0);
  });

  it('rewrites the copy, longest phrase first', () => {
    boot('index.html', { brands: [{ brand: 'Microsoft Edge' }] });
    const text = bodyText();
    expect(text).toContain('Add to Edge');
    expect(text).not.toContain('Add to Chrome');
    expect(text).not.toContain('Chrome Web Store');
    // "View in Chrome Store" must become the whole Edge phrase, not a hybrid.
    expect(text).not.toMatch(/View in (Chrome|Edge) Store/);
  });

  it('drops the Chrome logo rather than showing it on an Edge button', () => {
    boot('index.html', { brands: [{ brand: 'Microsoft Edge' }] });
    for (const link of edgeLinks()) {
      expect(link.querySelector('use[href="#chrome-mark"]')).toBeNull();
    }
  });
});

describe('the ?browser test override', () => {
  it('forces the Edge treatment on a Chrome browser', () => {
    boot('index.html', {
      brands: [{ brand: 'Google Chrome' }],
      search: '?browser=edge',
    });
    expect(edgeLinks().length).toBeGreaterThan(0);
    expect(bodyText()).toContain('Add to Edge');
  });

  it('forces it back off on a real Edge browser', () => {
    boot('index.html', {
      brands: [{ brand: 'Microsoft Edge' }],
      search: '?browser=chrome',
    });
    expect(storeLinks().length).toBeGreaterThan(0);
    expect(edgeLinks()).toHaveLength(0);
  });

  it('sticks for the session, so clicking through the site keeps the override', () => {
    boot('index.html', { brands: [{ brand: 'Google Chrome' }], search: '?browser=edge' });
    expect(edgeLinks().length).toBeGreaterThan(0);

    // Same tab, next page, no parameter — the point of remembering it.
    const html = readFileSync(join(SITE, 'changelog.html'), 'utf8');
    document.documentElement.innerHTML = html
      .replace(/^[\s\S]*?<body[^>]*>/i, '')
      .replace(/<\/body>[\s\S]*$/i, '');
    window.history.replaceState(null, '', '/changelog');
    new Function(SCRIPT)();

    expect(edgeLinks().length).toBeGreaterThan(0);
  });

  it('ignores a value that is neither browser', () => {
    boot('index.html', { brands: [{ brand: 'Google Chrome' }], search: '?browser=safari' });
    expect(edgeLinks()).toHaveLength(0);
  });
});
