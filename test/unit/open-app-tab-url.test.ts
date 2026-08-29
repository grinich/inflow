/**
 * The app's canonical URL is the web shell at inflow.im/app (which embeds the
 * extension page in an iframe). openAppTab must:
 *   - create new tabs at the web URL,
 *   - still find and focus tabs at EITHER the web URL or the legacy
 *     chrome-extension://…/app.html URL (old bookmarks, offline fallback),
 *   - fall back to the extension URL when the browser is offline (the shell
 *     is only cached by its service worker after one online visit).
 */
import { openAppTab, reloadWebAppShellTabs } from '../../entrypoints/background/open-app-tab';
import { WEB_APP_URL, appTabUrlPatterns } from '../../entrypoints/background/app-urls';

vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

beforeEach(() => {
  vi.mocked(chrome.tabs.query).mockResolvedValue([]);
  vi.mocked(chrome.tabs.create).mockReset();
  vi.mocked(chrome.tabs.update).mockReset();
  vi.mocked(chrome.tabs.reload).mockReset().mockResolvedValue(undefined as any);
  vi.mocked(chrome.windows.update).mockReset();
  vi.unstubAllGlobals();
});

describe('appTabUrlPatterns', () => {
  it('matches both app URL families, including query strings', () => {
    expect(appTabUrlPatterns()).toEqual([
      'chrome-extension://test-extension-id/app.html*',
      'https://inflow.im/app*',
    ]);
  });
});

describe('openAppTab URL selection', () => {
  it('creates new tabs at the web shell URL', async () => {
    await openAppTab();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: WEB_APP_URL });
  });

  it('queries for existing tabs with both URL patterns', async () => {
    await openAppTab();
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: ['chrome-extension://test-extension-id/app.html*', 'https://inflow.im/app*'],
    });
  });

  it('focuses an existing web-shell tab instead of creating one', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 7, windowId: 3, url: 'https://inflow.im/app' } as any,
    ]);
    vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
    vi.mocked(chrome.windows.update).mockResolvedValue({} as any);

    await openAppTab();

    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
  });

  it('prefers the web shell over a raw extension tab (that is where the installed app is)', async () => {
    // tabs.query returns window order, not pattern order, so a stray
    // extension tab can come first — focusing it would strand a notification
    // click in the browser with the desktop app sitting open behind it.
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 4, windowId: 1, url: 'chrome-extension://test-extension-id/app.html' } as any,
      { id: 9, windowId: 6, url: 'https://inflow.im/app' } as any,
    ]);
    vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
    vi.mocked(chrome.windows.update).mockResolvedValue({} as any);

    await openAppTab();

    expect(chrome.tabs.update).toHaveBeenCalledWith(9, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(6, { focused: true });
  });

  it('still focuses a raw extension tab when that is all there is', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 4, windowId: 1, url: 'chrome-extension://test-extension-id/app.html' } as any,
    ]);
    vi.mocked(chrome.tabs.update).mockResolvedValue({} as any);
    vi.mocked(chrome.windows.update).mockResolvedValue({} as any);

    await openAppTab();

    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(4, { active: true });
  });

  it('falls back to the extension URL when offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await openAppTab();
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension-id/app.html',
    });
  });
});

describe('reloadWebAppShellTabs', () => {
  it('reloads every open web-shell tab (they hold dead iframes after an update)', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 4, url: 'https://inflow.im/app' } as any,
      { id: 9, url: 'https://inflow.im/app?demo' } as any,
    ]);

    await reloadWebAppShellTabs();

    expect(chrome.tabs.query).toHaveBeenCalledWith({ url: 'https://inflow.im/app*' });
    expect(chrome.tabs.reload).toHaveBeenCalledWith(4);
    expect(chrome.tabs.reload).toHaveBeenCalledWith(9);
  });

  it('never rejects — a failed reload of one tab must not break the update flow', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      { id: 4, url: 'https://inflow.im/app' } as any,
      { id: undefined, url: 'https://inflow.im/app' } as any,
    ]);
    vi.mocked(chrome.tabs.reload).mockRejectedValue(new Error('No tab with id: 4.'));

    await expect(reloadWebAppShellTabs()).resolves.toBeUndefined();
  });

  it('never rejects even when the query itself fails', async () => {
    vi.mocked(chrome.tabs.query).mockRejectedValue(new Error('boom'));
    await expect(reloadWebAppShellTabs()).resolves.toBeUndefined();
  });
});
