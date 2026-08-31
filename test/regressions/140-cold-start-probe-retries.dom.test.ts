// @vitest-environment jsdom
/**
 * Regression 140 — restarting Chrome left the installed app window sitting on
 * the "Add to Chrome" install page, for good.
 *
 * The shell probes for the extension on load; a cold MV3 service worker
 * doesn't answer in the 1.5s probe window, so site/app.html showed the
 * install CTA and scheduled ONE retry 3s later. Past that its only remaining
 * retries were `focus` and `visibilitychange` — and the window this happens
 * to is the installed app restored at browser startup, which is already
 * focused and already visible, so neither event ever fires. A worker that
 * took longer than ~4.5s to wake (routine when a whole session is restoring
 * at once) stranded the window on an install pitch aimed at someone who
 * plainly has the extension, until they clicked away and back or reloaded.
 *
 * Two changes, both exercised below against the real site/app.html script:
 *   - retries continue on a backoff instead of stopping after one, and
 *   - the CTA holds back while chrome.runtime is present, which only happens
 *     when an installed extension lists this origin.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { trackTimers } from '../helpers/shell-timers';

// The shell script leaves timers running; a tick after this file's jsdom env
// is torn down crashes the worker (see test/helpers/shell-timers.ts).
let __untrackTimers: (() => void) | null = null;
beforeEach(() => { __untrackTimers = trackTimers(); });
afterEach(() => { __untrackTimers?.(); __untrackTimers = null; });


const APP_HTML = readFileSync(join(__dirname, '..', '..', 'site', 'app.html'), 'utf8');
const BODY = /<body>([\s\S]*?)<script>/.exec(APP_HTML)![1];
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(APP_HTML)![1];

const EXT_ID = 'ndehgbgifkapdigmefglpgacpagoclge';

interface Harness {
  /** Probes issued so far (one PING per candidate extension id). */
  probes: () => number;
  /** Distinct probe ROUNDS — what the retry schedule actually controls. */
  rounds: () => number;
  ctaVisible: () => boolean;
  embedded: () => boolean;
  /** Let the extension's service worker finish waking up. */
  wake: () => void;
  advance: (ms: number) => Promise<void>;
}

/**
 * Boot the shell with an extension that stays ASLEEP (probes time out) until
 * `wake()` is called — the cold-start case. `chromeRuntime: false` is the
 * genuinely-not-installed case, where chrome.runtime is absent entirely.
 */
function boot(opts: { chromeRuntime?: boolean } = {}): Harness {
  let awake = false;
  let probes = 0;
  let rounds = 0;
  let lastRoundAt = -1;

  document.body.innerHTML = BODY;

  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
  vi.stubGlobal('localStorage', {
    getItem: () => null, setItem() {}, removeItem() {},
  });
  vi.stubGlobal('MutationObserver', class {
    observe() {} disconnect() {} takeRecords() { return []; }
  });
  (navigator as any).setAppBadge = () => Promise.resolve();
  (navigator as any).clearAppBadge = () => Promise.resolve();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: () => Promise.reject(new Error('n/a')) },
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: () => Promise.reject(new Error('n/a')) },
  });

  const runtime = {
    lastError: undefined,
    // A sleeping worker never invokes the callback — the shell's own 1.5s
    // timeout is what resolves the probe.
    sendMessage: (id: string, _msg: unknown, cb: (r: unknown) => void) => {
      probes += 1;
      const now = Date.now();
      if (now !== lastRoundAt) {
        rounds += 1;
        lastRoundAt = now;
      }
      if (awake && id === EXT_ID) setTimeout(() => cb({ ok: true, id: EXT_ID }), 0);
    },
    connect: () => ({
      postMessage() {}, disconnect() {},
      onMessage: { addListener() {} },
      onDisconnect: { addListener() {} },
    }),
  };

  vi.stubGlobal('chrome', opts.chromeRuntime === false ? {} : { runtime });

  // eslint-disable-next-line no-new-func — running the shipped shell verbatim.
  new Function(SCRIPT)();

  const cta = document.getElementById('cta')!;
  return {
    probes: () => probes,
    rounds: () => rounds,
    ctaVisible: () => !(cta as HTMLElement).hidden,
    embedded: () => !!document.querySelector('iframe#app'),
    wake: () => { awake = true; },
    advance: (ms) => vi.advanceTimersByTimeAsync(ms),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('regression 140 — the cold-start probe keeps retrying', () => {
  it('embeds the app once a slow worker wakes, long after the old single retry', async () => {
    const shell = boot();

    // The first probe times out and the old 3s retry comes and goes.
    await shell.advance(5000);
    expect(shell.embedded(), 'nothing can embed while the worker sleeps').toBe(false);
    const roundsByFive = shell.rounds();
    expect(roundsByFive).toBeGreaterThan(1);

    // The worker finally wakes at ~12s — past every retry the old code had.
    shell.wake();
    await shell.advance(15000);

    expect(shell.rounds()).toBeGreaterThan(roundsByFive);
    expect(shell.embedded(), 'a late wake must still upgrade the page').toBe(true);
    expect(shell.ctaVisible()).toBe(false);
  });

  it('holds the install pitch back while chrome.runtime says it IS installed', async () => {
    const shell = boot();

    // The window an installed user is looking at must not be told to install.
    await shell.advance(4000);
    expect(shell.ctaVisible()).toBe(false);

    shell.wake();
    await shell.advance(4000);
    expect(shell.embedded()).toBe(true);
    expect(shell.ctaVisible(), 'the CTA must never have flashed').toBe(false);
  });

  it('does show the CTA once the grace is spent and nothing answered', async () => {
    const shell = boot();

    await shell.advance(30000);

    expect(shell.embedded()).toBe(false);
    expect(shell.ctaVisible(), 'a genuinely dead extension still needs the pitch').toBe(true);
  });

  it('shows the CTA immediately when no extension claims this origin', async () => {
    // No chrome.runtime at all: nothing is installed, so there is nothing to
    // wait for and the install page is the right and only answer.
    const shell = boot({ chromeRuntime: false });

    await shell.advance(0);

    expect(shell.ctaVisible()).toBe(true);
    expect(shell.probes(), 'no runtime means nothing to probe').toBe(0);
  });

  it('stops probing once the app is embedded', async () => {
    const shell = boot();
    // The first probe is already in flight by the time the worker wakes, so
    // it's the first RETRY that lands (probe timeout 1.5s + 1s backoff).
    shell.wake();
    await shell.advance(5000);
    expect(shell.embedded()).toBe(true);

    const settled = shell.probes();
    await shell.advance(60000);
    expect(shell.probes(), 'an embedded shell must not keep polling').toBe(settled);
  });

  it('gives up eventually rather than probing forever', async () => {
    const shell = boot();

    await shell.advance(120000);
    const exhausted = shell.probes();
    await shell.advance(120000);

    expect(shell.probes(), 'the backoff is bounded').toBe(exhausted);
  });

  it('a returning user gets a fresh run of tries, not the tail of the old one', async () => {
    const shell = boot();
    await shell.advance(120000); // burn the whole schedule
    const exhausted = shell.probes();

    // They went to the Web Store and came back.
    shell.wake();
    window.dispatchEvent(new Event('focus'));
    await shell.advance(2000);

    expect(shell.probes()).toBeGreaterThan(exhausted);
    expect(shell.embedded()).toBe(true);
  });
});
