/**
 * The app has two homes: the canonical web shell at inflow.im/app (which
 * embeds the extension page in an iframe) and the raw extension page itself
 * (legacy bookmarks, offline fallback). Tab queries must match both.
 */
export const WEB_APP_URL = 'https://inflow.im/app';

/** chrome.tabs.query URL patterns matching every form of the app tab,
 *  including query strings (`?demo`, future deep links). */
export function appTabUrlPatterns(): string[] {
  return [chrome.runtime.getURL('app.html') + '*', WEB_APP_URL + '*'];
}
