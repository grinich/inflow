// Regression: fetchAllMessages registered its inflight-map cleanup with
// `promise.finally(...)`. `.finally()` returns a NEW promise that rejects
// alongside the original, and nobody handled that one — so every failed fetch
// produced an unhandledRejection in the service worker console even though
// the caller handled the error.
import { fetchAllMessages } from '../../entrypoints/background/api/messages';

vi.mock('../../entrypoints/background/api/client', () => ({
  voyagerFetch: vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    text: () => Promise.resolve(''),
  }),
}));

vi.mock('../../entrypoints/background/auth/session', () => ({
  getMemberUrn: vi.fn().mockResolvedValue('urn:li:fsd_profile:SELF'),
}));

vi.mock('@/lib/debug-log', () => ({
  debugLog: vi.fn(),
}));

it('does not produce an unhandledRejection when the fetch fails', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    await expect(fetchAllMessages('conv-fail')).rejects.toThrow('Failed to fetch messages: 500');

    // Give Node a few ticks to surface any orphaned rejected promise
    await new Promise((r) => setTimeout(r, 20));

    expect(unhandled).toHaveLength(0);
    // The inflight entry must still be cleaned up so the next call retries
    await expect(fetchAllMessages('conv-fail')).rejects.toThrow('Failed to fetch messages: 500');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
