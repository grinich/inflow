// @vitest-environment jsdom
/**
 * Regression: clicking a changelog screenshot after the lightbox had been
 * opened and closed once did nothing visible — and the page stopped taking
 * clicks entirely.
 *
 * close() fades the backdrop out with fill:'both', which keeps applying
 * opacity 0 after the animation finishes. open() cancelled the zoom but not
 * that fade, so the reopened lightbox was held transparent (its own fade-in
 * runs with fill:'none' and is removed on finish) while still covering the
 * whole viewport.
 *
 * The page's real script runs here, as in changelog-store-badges, against a
 * minimal fake of the Web Animations API that reproduces the two semantics
 * that matter: an animation finishes after its duration, and fill:'both'
 * keeps holding its final keyframe until it is cancelled.
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

/** The lightbox script is the one that decorates the shots. */
const SCRIPT = (() => {
  const blocks = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((b) => b.includes('shot-zoom'));
  if (!found) throw new Error('no lightbox script in changelog.html');
  return found;
})();

type Keyframe = Record<string, string | number>;

class FakeAnimation {
  playState: 'running' | 'finished' | 'idle' = 'running';
  onfinish: (() => void) | null = null;
  constructor(
    public element: Element,
    public keyframes: Keyframe[],
    public options: { duration?: number; fill?: string },
  ) {
    animations.push(this);
    setTimeout(() => {
      if (this.playState !== 'running') return;
      this.playState = 'finished';
      this.onfinish?.();
    }, options.duration ?? 0);
  }
  cancel() {
    this.playState = 'idle';
  }
}

let animations: FakeAnimation[] = [];

/**
 * A finished fill:'both' animation ending at opacity 0 keeps the element
 * invisible until it is cancelled — exactly the state that broke reopening.
 */
const holdsInvisible = (el: Element) =>
  animations.filter(
    (a) =>
      a.element === el &&
      a.playState === 'finished' &&
      a.options.fill === 'both' &&
      a.keyframes[a.keyframes.length - 1].opacity === 0,
  );

const shot = () => document.querySelector<HTMLImageElement>('.shot-zoom')!;
const box = () => document.querySelector<HTMLElement>('.lightbox')!;
const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const escape = () =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

beforeEach(() => {
  vi.useFakeTimers();
  animations = [];
  (Element.prototype as any).animate = function (
    keyframes: Keyframe[],
    options: { duration?: number; fill?: string },
  ) {
    return new FakeAnimation(this, keyframes, options);
  };
  document.body.innerHTML = `<article class="rel"><div class="rel-body">
    <p><img src="/img/a.png" alt="First shot"><img src="/img/b.png" alt="Second shot"></p>
  </div></article>`;
  new Function(SCRIPT)();
});

afterEach(() => {
  vi.useRealTimers();
  delete (Element.prototype as any).animate;
  document.body.innerHTML = '';
});

it('reopens visibly after a close has fully finished', () => {
  click(shot());
  expect(box().hidden).toBe(false);

  escape();
  vi.advanceTimersByTime(1000); // fade-out finishes, teardown timer fires
  expect(box().hidden).toBe(true);

  click(shot());
  expect(box().hidden).toBe(false);
  // Nothing left over from the close may still be pinning the box at
  // opacity 0 — before the fix, its finished fill:'both' fade-out was.
  expect(holdsInvisible(box())).toEqual([]);
});

it('a reopen during the close animation is not torn down by the stale close', () => {
  click(shot());
  escape();
  // Reopen before the close animation or its fallback timer has run.
  click(shot());
  vi.advanceTimersByTime(1000);

  expect(box().hidden).toBe(false);
  expect(holdsInvisible(box())).toEqual([]);
});
