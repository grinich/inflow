// @vitest-environment jsdom
/**
 * checkForUpdateAndToast: the shared manual update check used by the command
 * palette and Settings → About.
 */
const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a) }));

import { checkForUpdateAndToast } from '@/lib/check-update';

const toasts: string[] = [];
const showToast = (t: { message: string }) => toasts.push(t.message);

beforeEach(() => {
  sendBridgeMessage.mockReset();
  toasts.length = 0;
  (globalThis as any).chrome = {
    runtime: { getManifest: () => ({ version: '1.2.3' }) },
  };
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => vi.restoreAllMocks());

it('reports up-to-date when latest matches the running version', async () => {
  sendBridgeMessage.mockResolvedValue({
    success: true,
    data: { latestVersion: '1.2.3', releaseUrl: 'https://example.com/r' },
  });
  await checkForUpdateAndToast(showToast);
  expect(toasts[0]).toMatch(/Checking for updates/i);
  expect(toasts.at(-1)).toMatch(/up to date \(v1\.2\.3\)/i);
  expect(window.open).not.toHaveBeenCalled();
});

it('announces and opens the release when a newer version exists', async () => {
  sendBridgeMessage.mockResolvedValue({
    success: true,
    data: { latestVersion: '2.0.0', releaseUrl: 'https://example.com/r' },
  });
  await checkForUpdateAndToast(showToast);
  expect(toasts.at(-1)).toMatch(/Update available: v2\.0\.0/i);
  expect(window.open).toHaveBeenCalledWith('https://example.com/r', '_blank');
});

it('handles a failed check gracefully', async () => {
  sendBridgeMessage.mockRejectedValue(new Error('offline'));
  await checkForUpdateAndToast(showToast);
  expect(toasts.at(-1)).toMatch(/Couldn.t check for updates/i);
});
