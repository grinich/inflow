/**
 * Adversarial coverage for openAppTab / reloadWebAppShellTabs edge cases:
 * the pending-navigation handoff failing, the drag-lock retry bound, how the
 * offline fallback interacts with retries, tabs the query returns without
 * usable ids, and the (deliberate) absence of retries in the reload path.
 */
import { openAppTab, reloadWebAppShellTabs } from '../../entrypoints/background/open-app-tab';
import { WEB_APP_URL } from '../../entrypoints/background/app-urls';
import { setPendingNavigation } from '@/lib/pending-navigation';

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));
vi.mock('@/lib/pending-navigation', () => ({ setPendingNavigation: vi.fn() }));

const DRAG_ERROR = new Error('Tabs cannot be edited right now (user may be dragging a tab).');
const EXTENSION_URL = 'chrome-extension://test-extension-id/app.html';

beforeEach(() => {
  vi.mocked(chrome.tabs.query).mockResolvedValue([]);
  vi.mocked(chrome.tabs.create).mockReset();
  vi.mocked(chrome.tabs.update).mockReset();
  vi.mocked(chrome.tabs.reload).mockReset().mockResolvedValue(undefined as any);
  vi.mocked(chrome.windows.update).mockReset();
  vi.mocked(setPendingNavigation).mockReset().mockResolvedValue(undefined);
  vi.unstubAllGlobals();
});

describe('pending-navigation handoff', () => {
  it('records the conversation target before touching any tab', async () => {
    const order: string[] = [];
    vi.mocked(setPendingNavigation).mockImplementation(async () => {
      order.push('record');
    });
    vi.mocked(chrome.tabs.create).mockImplementation(async () => {
      order.push('create');
      return {} as any;
    });

    await openAppTab({ conversationId: 'conv-42' });

    expect(setPendingNavigation).toHaveBeenCalledWith('conv-42', expect.any(Number));
    // The target must be durable before the tab exists — a freshly created
    // tab reads it on load, so recording after creation would race the app.
    expect(order).toEqual(['record', 'create']);
  });

  it('still opens the tab when recording the target fails (notification click must not dead-end)', async () => {
    vi.mocked(setPendingNavigation).mockRejectedValue(new Error('storage.session unavailable'));

    await expect(openAppTab({ conversationId: 'conv-42' })).resolves.toBeUndefined();

    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: WEB_APP_URL });
  });

  it('does not touch pending navigation for a plain toolbar click', async () => {
    await openAppTab();
    expect(setPendingNavigation).not.toHaveBeenCalled();
  });
});

describe('drag-lock retry bound', () => {
  it('gives up after exactly 10 attempts when the tab strip never unlocks', async () => {
    vi.mocked(chrome.tabs.create).mockRejectedValue(DRAG_ERROR);

    await expect(openAppTab({ retryDelayMs: 1 })).resolves.toBeUndefined();

    expect(chrome.tabs.create).toHaveBeenCalledTimes(10);
  });

  it('retries a drag-locked failure from tabs.query itself, not just the mutations', async () => {
    vi.mocked(chrome.tabs.query)
      .mockRejectedValueOnce(DRAG_ERROR)
      .mockResolvedValue([]);

    await openAppTab({ retryDelayMs: 1 });

    expect(chrome.tabs.query).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('re-queries on each retry: if the found tab closes mid-drag, a fresh one is created', async () => {
    vi.mocked(chrome.tabs.query)
      .mockResolvedValueOnce([{ id: 7, windowId: 3, url: WEB_APP_URL } as any])
      .mockResolvedValue([]);
    vi.mocked(chrome.tabs.update).mockRejectedValue(DRAG_ERROR);

    await openAppTab({ retryDelayMs: 1 });

    // Attempt 1 tried to focus tab 7 and hit the lock; attempt 2 re-queried,
    // found nothing (tab closed during the drag), and created a new tab.
    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: WEB_APP_URL });
  });

  it('retries a drag-locked windows.update after the tab itself was activated', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 7, windowId: 3, url: WEB_APP_URL } as any,
    ]);
    vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
    vi.mocked(chrome.windows.update)
      .mockRejectedValueOnce(DRAG_ERROR)
      .mockResolvedValue({} as any);

    await openAppTab({ retryDelayMs: 1 });

    expect(chrome.windows.update).toHaveBeenCalledTimes(2);
    expect(chrome.windows.update).toHaveBeenLastCalledWith(3, { focused: true });
  });
});

describe('offline fallback under retries', () => {
  it('keeps the offline URL choice stable across drag-lock retries', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(chrome.tabs.create)
      .mockRejectedValueOnce(DRAG_ERROR)
      .mockRejectedValueOnce(DRAG_ERROR)
      .mockResolvedValue({} as any);

    await openAppTab({ retryDelayMs: 1 });

    // The URL is chosen once per openAppTab call — every retry uses the same
    // fallback rather than re-reading connectivity mid-loop.
    expect(chrome.tabs.create).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(chrome.tabs.create).mock.calls) {
      expect(call[0]).toEqual({ url: EXTENSION_URL });
    }
  });

  it('offline still focuses an existing tab instead of creating the fallback page', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 7, windowId: 3, url: WEB_APP_URL } as any,
    ]);
    vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
    vi.mocked(chrome.windows.update).mockResolvedValue({} as any);

    await openAppTab();

    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
  });
});

describe('tabs the query returns without usable ids', () => {
  // Documents current behavior: only tabs[0] is inspected. A first match with
  // no id (Chrome only omits ids for devtools/session-restore oddities) makes
  // openAppTab fall through to creating a NEW tab — even when a second match
  // has a perfectly usable id, which would leave two app tabs open. Accepted
  // as a safe fallback for a case tabs.query should never produce for regular
  // web/extension pages; if it ever bites, prefer the first tab WITH an id.
  it('creates a new tab when the first match lacks an id, even if a later match has one', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: undefined, windowId: 3, url: WEB_APP_URL } as any,
      { id: 9, windowId: 3, url: WEB_APP_URL } as any,
    ]);

    await openAppTab();

    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: WEB_APP_URL });
  });

  it('activates the tab but skips window focus when windowId is missing', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 7, url: WEB_APP_URL } as any,
    ]);
    vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);

    await openAppTab();

    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(chrome.windows.update).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});

describe('reloadWebAppShellTabs and the drag lock', () => {
  // Documents current behavior: unlike openAppTab, the post-update shell
  // reload does NOT retry drag-locked failures — each tab's reload rejection
  // is swallowed per-tab. A user dragging a tab at the exact moment the
  // extension updates keeps a shell tab with a dead iframe until they reload
  // it manually. Accepted: the window is milliseconds wide, the failure mode
  // is benign, and the shell re-probes on its next load anyway.
  it('does not retry a drag-locked reload; other tabs still get reloaded', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 4, url: WEB_APP_URL } as any,
      { id: 9, url: `${WEB_APP_URL}?demo` } as any,
    ]);
    vi.mocked(chrome.tabs.reload)
      .mockRejectedValueOnce(DRAG_ERROR)
      .mockResolvedValue(undefined as any);

    await expect(reloadWebAppShellTabs()).resolves.toBeUndefined();

    // One attempt per tab — no retry loop here.
    expect(chrome.tabs.reload).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.reload).toHaveBeenCalledWith(4);
    expect(chrome.tabs.reload).toHaveBeenCalledWith(9);
  });

  it('reloads only web-shell tabs — raw extension tabs re-run on their own', async () => {
    await reloadWebAppShellTabs();
    expect(chrome.tabs.query).toHaveBeenCalledWith({ url: 'https://inflow.im/app*' });
    const pattern = vi.mocked(chrome.tabs.query).mock.calls[0][0] as { url: string };
    expect(pattern.url).not.toContain('chrome-extension');
  });
});
