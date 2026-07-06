/**
 * Regression: clicking the toolbar icon/notification while dragging a tab
 * threw "Uncaught (in promise) Error: Tabs cannot be edited right now (user
 * may be dragging a tab)." — and the click silently did nothing.
 *
 * Chrome locks the tab strip during a tab drag: any tabs.update/tabs.create/
 * windows.update issued in that window rejects with that error. openAppTab
 * fired those calls without await or catch, so the rejection surfaced as an
 * unhandled promise rejection and the app tab never opened.
 *
 * Fix: openAppTab awaits every tab call, retries while the tab strip is
 * locked (the lock clears the moment the drag ends), and never rejects —
 * a failed UI click must not produce an uncaught error.
 */
import { openAppTab } from '../../entrypoints/background/open-app-tab';

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

const DRAG_ERROR = new Error('Tabs cannot be edited right now (user may be dragging a tab).');

beforeEach(() => {
  vi.mocked(chrome.tabs.query).mockResolvedValue([]);
  vi.mocked(chrome.tabs.create).mockReset();
  vi.mocked(chrome.tabs.update).mockReset();
  vi.mocked(chrome.windows.update).mockReset();
});

describe('openAppTab under a tab drag', () => {
  it('retries until the drag ends and the tab opens', async () => {
    vi.mocked(chrome.tabs.create)
      .mockRejectedValueOnce(DRAG_ERROR)
      .mockRejectedValueOnce(DRAG_ERROR)
      .mockResolvedValue({ id: 42 } as any);

    await expect(openAppTab({ retryDelayMs: 1 })).resolves.toBeUndefined();
    expect(chrome.tabs.create).toHaveBeenCalledTimes(3);
  });

  it('never rejects even when the tab strip stays locked (no uncaught rejection)', async () => {
    vi.mocked(chrome.tabs.create).mockRejectedValue(DRAG_ERROR);

    await expect(openAppTab({ retryDelayMs: 1 })).resolves.toBeUndefined();
  });

  it('focuses an existing app tab, awaiting (and retrying) the update calls', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 7, windowId: 3, url: 'chrome-extension://test-extension-id/app.html' } as any,
    ]);
    vi.mocked(chrome.tabs.update)
      .mockRejectedValueOnce(DRAG_ERROR)
      .mockResolvedValue({} as any);
    vi.mocked(chrome.windows.update).mockResolvedValue({} as any);

    await openAppTab({ retryDelayMs: 1 });

    expect(chrome.tabs.update).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.update).toHaveBeenLastCalledWith(7, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
  });

  it('does not retry (but still swallows) unrelated errors', async () => {
    vi.mocked(chrome.tabs.create).mockRejectedValue(new Error('No current window'));

    await expect(openAppTab({ retryDelayMs: 1 })).resolves.toBeUndefined();
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });
});
