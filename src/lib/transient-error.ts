/**
 * Classify errors produced by ordinary network flakiness — offline, a dropped
 * connection (typically after machine sleep/wake or a network switch), or a
 * request cut off by an AbortSignal timeout.
 *
 * Every caller that catches one of these already recovers on its own (sync
 * resumes from its saved cursor on the next tick, the SSE client reconnects
 * with backoff), so they should log as warnings: error-level console output is
 * collected into chrome://extensions "Errors" and reads as a crash.
 */
export function isTransientNetworkError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null | undefined;
  if (!e || typeof e !== 'object') return false;
  // AbortSignal.timeout() → TimeoutError; an aborted request → AbortError.
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return true;
  // fetch() rejects with a TypeError whose message names the network failure
  // ("Failed to fetch", stream reads fail with "network error").
  return (
    e.name === 'TypeError' &&
    /failed to fetch|network error|fetch failed|load failed|network connection was lost/i.test(
      e.message ?? ''
    )
  );
}

/** Log level for a caught fetch/network error: 'warn' when transient, 'error' otherwise. */
export function networkErrorLevel(err: unknown): 'warn' | 'error' {
  return isTransientNetworkError(err) ? 'warn' : 'error';
}
