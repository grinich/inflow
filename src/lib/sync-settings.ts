/** Backfill window options — how far back to sync message contents. */
export type BackfillWindow = '7d' | '30d' | '90d' | '180d' | '365d' | 'all';

export const BACKFILL_OPTIONS: { value: BackfillWindow; label: string }[] = [
  { value: '7d', label: '1 week' },
  { value: '30d', label: '1 month' },
  { value: '90d', label: '3 months' },
  { value: '180d', label: '6 months' },
  { value: '365d', label: '1 year' },
  { value: 'all', label: 'Everything' },
];

const STORAGE_KEY = 'backfillWindow';
const DEFAULT_WINDOW: BackfillWindow = '180d';

const WINDOW_MS: Record<BackfillWindow, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '180d': 180 * 24 * 60 * 60 * 1000,
  '365d': 365 * 24 * 60 * 60 * 1000,
  'all': 0,
};

/** Get the cutoff timestamp — conversations older than this should skip backfill. Returns 0 for 'all'. */
export async function getBackfillCutoff(): Promise<number> {
  const window = await getBackfillWindow();
  const ms = WINDOW_MS[window];
  return ms > 0 ? Date.now() - ms : 0;
}

/** Get the current backfill window setting. */
export async function getBackfillWindow(): Promise<BackfillWindow> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    // Validate against known windows — an unknown value must NOT fall through to
    // WINDOW_MS[x]=undefined (which getBackfillCutoff would read as "sync everything").
    return stored && stored in WINDOW_MS ? (stored as BackfillWindow) : DEFAULT_WINDOW;
  } catch {
    return DEFAULT_WINDOW;
  }
}

/** Set the backfill window. */
export async function setBackfillWindow(window: BackfillWindow): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: window });
}
