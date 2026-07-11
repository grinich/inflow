import { isTransientNetworkError, networkErrorLevel } from '@/lib/transient-error';

describe('isTransientNetworkError', () => {
  it('classifies fetch network failures as transient', () => {
    // Chrome's fetch() rejection when offline / connection dropped
    expect(isTransientNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    // Chrome's streaming body read failure (SSE stream drop)
    expect(isTransientNetworkError(new TypeError('network error'))).toBe(true);
    // Node/undici variant (dev environment)
    expect(isTransientNetworkError(new TypeError('fetch failed'))).toBe(true);
  });

  it('classifies AbortSignal timeouts and aborts as transient', () => {
    // AbortSignal.timeout() → DOMException named TimeoutError
    expect(
      isTransientNetworkError(new DOMException('signal timed out', 'TimeoutError'))
    ).toBe(true);
    expect(
      isTransientNetworkError(new DOMException('The user aborted a request.', 'AbortError'))
    ).toBe(true);
  });

  it('does not classify unrelated errors as transient', () => {
    expect(isTransientNetworkError(new Error('SSE connect failed: 401'))).toBe(false);
    expect(isTransientNetworkError(new Error('Not authenticated — LinkedIn cookies not found'))).toBe(false);
    // A TypeError from a code bug must stay an error
    expect(
      isTransientNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')"))
    ).toBe(false);
    expect(isTransientNetworkError('Failed to fetch')).toBe(false);
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });
});

describe('networkErrorLevel', () => {
  it('maps transient → warn, everything else → error', () => {
    expect(networkErrorLevel(new TypeError('Failed to fetch'))).toBe('warn');
    expect(networkErrorLevel(new DOMException('signal timed out', 'TimeoutError'))).toBe('warn');
    expect(networkErrorLevel(new Error('boom'))).toBe('error');
  });
});
