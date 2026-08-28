/**
 * Regression: a timed-out /me check flashed the login screen.
 *
 * voyagerFetch bounds every request with AbortSignal.timeout(20s), which
 * rejects with a DOMException named "TimeoutError" — but getSession's
 * network-error guard only recognized `TypeError` / messages containing
 * "fetch". A hung /me therefore fell through to `{ authenticated: false }`,
 * making AuthGate flash the login screen on a transient network stall — the
 * exact behavior the guard exists to prevent (and its comment documents).
 *
 * Fix: classify errors with the shared isTransientNetworkError helper, which
 * already covers TimeoutError / AbortError / fetch TypeErrors.
 */

const voyagerFetch = vi.fn();
vi.mock('../../entrypoints/background/api/client', () => ({
  voyagerFetch: (...args: any[]) => voyagerFetch(...args),
}));

vi.mock('../../entrypoints/background/auth/cookies', () => ({
  getLinkedInCookies: vi.fn().mockResolvedValue({ liAt: 'cookie-a', jsessionId: 'ajax:123' }),
}));

vi.mock('@/db/database', async (importOriginal) => ({
  ...(await importOriginal() as any),
  switchDatabase: vi.fn(),
}));

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

import { getSession, invalidateSessionCache, clearCachedMemberUrn } from '../../entrypoints/background/auth/session';

function meResponse() {
  return new Response(
    JSON.stringify({
      included: [
        {
          $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
          entityUrn: 'urn:li:fs_miniProfile:ACoAATEST',
          firstName: 'Test',
          lastName: 'User',
          publicIdentifier: 'test-user',
        },
      ],
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  voyagerFetch.mockReset();
  invalidateSessionCache();
  clearCachedMemberUrn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getSession under transient failures', () => {
  it('keeps the cached session when a /me re-check times out', async () => {
    voyagerFetch.mockResolvedValueOnce(meResponse());
    const first = await getSession();
    expect(first.authenticated).toBe(true);

    // TTL expires; the re-check hits AbortSignal.timeout's rejection.
    vi.advanceTimersByTime(31_000);
    voyagerFetch.mockRejectedValueOnce(new DOMException('signal timed out', 'TimeoutError'));

    const second = await getSession();
    expect(second.authenticated).toBe(true);
    expect(second.memberUrn).toBe('urn:li:fsd_profile:ACoAATEST');
  });

  it('keeps the cached session when a /me re-check hits a fetch TypeError', async () => {
    voyagerFetch.mockResolvedValueOnce(meResponse());
    expect((await getSession()).authenticated).toBe(true);

    vi.advanceTimersByTime(31_000);
    voyagerFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect((await getSession()).authenticated).toBe(true);
  });

  it('still reports unauthenticated when there is no cached session to fall back to', async () => {
    voyagerFetch.mockRejectedValueOnce(new DOMException('signal timed out', 'TimeoutError'));
    expect((await getSession()).authenticated).toBe(false);
  });
});
