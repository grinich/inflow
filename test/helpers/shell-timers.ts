/**
 * Track every timer created while a test runs the shipped shell script
 * (site/app.html via `new Function(SCRIPT)()`), so afterEach can clear them.
 *
 * The shell legitimately leaves timers running (focus-retry interval, probe
 * retries, chip auto-hides). In the browser that's fine; in vitest a stray
 * tick firing after the file's jsdom environment is torn down crashes the
 * whole worker with "ReferenceError: document is not defined" — a flake that
 * lands on whatever test happens to be running next (seen gating a release
 * from test 138). Install in beforeEach, call the returned cleanup in
 * afterEach.
 */
export function trackTimers(): () => void {
  const created: { id: unknown; kind: 'timeout' | 'interval' }[] = [];
  const g = globalThis as any;
  const origSetTimeout = g.setTimeout;
  const origSetInterval = g.setInterval;

  g.setTimeout = function (...args: unknown[]) {
    const id = origSetTimeout.apply(this, args);
    created.push({ id, kind: 'timeout' });
    return id;
  };
  g.setInterval = function (...args: unknown[]) {
    const id = origSetInterval.apply(this, args);
    created.push({ id, kind: 'interval' });
    return id;
  };

  return () => {
    g.setTimeout = origSetTimeout;
    g.setInterval = origSetInterval;
    for (const t of created) {
      (t.kind === 'timeout' ? clearTimeout : clearInterval)(t.id as any);
    }
  };
}
