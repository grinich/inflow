// Bug (Medium): getBackfillCutoff cast an unvalidated stored value; an unknown
// window made WINDOW_MS[x]=undefined -> cutoff 0, i.e. silently "sync everything".
import { getBackfillCutoff, getBackfillWindow } from '@/lib/sync-settings';

describe('backfill window validation', () => {
  it('falls back to the default window for an invalid stored value (not sync-everything)', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ backfillWindow: 'garbage' } as any);
    expect(await getBackfillWindow()).toBe('180d');
    expect(await getBackfillCutoff()).toBeGreaterThan(0);
  });

  it('respects the valid "all" window (cutoff 0)', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ backfillWindow: 'all' } as any);
    expect(await getBackfillCutoff()).toBe(0);
  });
});
