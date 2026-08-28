/**
 * Regression: getBackfillWindow's validation was bypassable by a prototype key.
 *
 * The guard used `stored in WINDOW_MS`, which walks the prototype chain — a
 * corrupted stored value like "toString" passed validation, and
 * getBackfillCutoff then evaluated `WINDOW_MS['toString'] > 0` as false,
 * returning 0: precisely the "sync everything" outcome the guard's comment
 * says must not happen.
 */
import { getBackfillWindow } from '@/lib/sync-settings';

it('falls back to the default for prototype-chain keys', async () => {
  await chrome.storage.local.set({ backfillWindow: 'toString' });
  expect(await getBackfillWindow()).toBe('180d');
});

it('falls back to the default for unknown values', async () => {
  await chrome.storage.local.set({ backfillWindow: 'bogus' });
  expect(await getBackfillWindow()).toBe('180d');
});

it('still honors valid stored values', async () => {
  await chrome.storage.local.set({ backfillWindow: '30d' });
  expect(await getBackfillWindow()).toBe('30d');
});
