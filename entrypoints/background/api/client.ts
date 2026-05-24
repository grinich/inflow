import { getLinkedInCookies } from '../auth/cookies';
import { debugLog } from '@/lib/debug-log';

const BASE_URL = 'https://www.linkedin.com/voyager/api';

// Use declarativeNetRequest to attach cookies since fetch() forbids the Cookie header
let lastCookieValue = '';

export async function ensureCookieRule(): Promise<void> {
  // Fetch ALL LinkedIn cookies — the realtime endpoint needs more than
  // just li_at/JSESSIONID (e.g. lidc, bcookie, PerimeterX cookies).
  const allCookies = await chrome.cookies.getAll({ url: 'https://www.linkedin.com' });
  const authCookies = await getLinkedInCookies();
  if (!authCookies || allCookies.length === 0) return;

  const cookieValue = allCookies.map((c) => `${c.name}=${c.value}`).join('; ');

  // Skip if already installed with same cookies
  if (cookieValue === lastCookieValue) return;

  try {
    const SET = 'set' as chrome.declarativeNetRequest.HeaderOperation;
    const XHR = 'xmlhttprequest' as chrome.declarativeNetRequest.ResourceType;
    const OTHER = 'other' as chrome.declarativeNetRequest.ResourceType;
    const MODIFY = 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType;

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1, 2],
      addRules: [
        // Rule 1: inject all cookies on LinkedIn requests
        {
          id: 1,
          priority: 1,
          action: {
            type: MODIFY,
            requestHeaders: [
              { header: 'Cookie', operation: SET, value: cookieValue },
            ],
          },
          condition: {
            urlFilter: '||www.linkedin.com/',
            resourceTypes: [XHR, OTHER],
          },
        },
        // Rule 2: make /realtime/ requests look same-origin.
        // Service worker fetch sends Sec-Fetch-Site: none/cross-site,
        // which LinkedIn's server (PerimeterX) rejects. Override these
        // browser-controlled headers to match what a page fetch sends.
        {
          id: 2,
          priority: 2,
          action: {
            type: MODIFY,
            requestHeaders: [
              { header: 'Sec-Fetch-Site', operation: SET, value: 'same-origin' },
              { header: 'Sec-Fetch-Mode', operation: SET, value: 'cors' },
              { header: 'Sec-Fetch-Dest', operation: SET, value: 'empty' },
              { header: 'Referer', operation: SET, value: 'https://www.linkedin.com/messaging/' },
              { header: 'Origin', operation: SET, value: 'https://www.linkedin.com' },
            ],
          },
          condition: {
            urlFilter: '||www.linkedin.com/realtime/',
            resourceTypes: [XHR, OTHER],
          },
        },
      ],
    });
    lastCookieValue = cookieValue;
    debugLog('info', `Cookie rule installed (${allCookies.length} cookies)`);
  } catch (err) {
    debugLog('error', 'Failed to install cookie rule:', err);
  }
}

export async function voyagerFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const cookies = await getLinkedInCookies();
  if (!cookies) {
    throw new Error('Not authenticated — LinkedIn cookies not found');
  }

  // CSRF token is the JSESSIONID value without surrounding quotes
  const csrfToken = cookies.jsessionId.replace(/"/g, '');

  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  // Ensure the declarativeNetRequest rule is set to inject cookies
  await ensureCookieRule();

  debugLog('info', `voyagerFetch: ${url}`);

  const res = await fetch(url, {
    ...options,
    headers: {
      'csrf-token': csrfToken,
      'x-restli-protocol-version': '2.0.0',
      accept: 'application/vnd.linkedin.normalized+json+2.1',
      ...(options.headers || {}),
    },
  });

  const shortPath = url.split('/voyager/api/')[1]?.substring(0, 120) || url;
  if (!res.ok) {
    // Clone so callers can still read the body
    const clone = res.clone();
    const body = await clone.text().catch(() => '');
    debugLog('error', `Voyager ${res.status} ${shortPath}: ${body.substring(0, 300)}`);
  } else {
    debugLog('info', `Voyager ${res.status} OK: ${shortPath}`);
  }

  return res;
}

/**
 * Fetch helper for non-Voyager LinkedIn endpoints (e.g. /realtime/*).
 * Cookies and Sec-Fetch headers are injected via declarativeNetRequest rules.
 *
 * Includes `x-li-track` header which LinkedIn's server uses to determine the
 * app context (mpName). Without this, /realtime/connect returns 400
 * "Could not map to valid appName for supplied mpName: null".
 */
export async function realtimeFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  await ensureCookieRule();
  const cookies = await getLinkedInCookies();
  if (!cookies) throw new Error('Not authenticated — LinkedIn cookies not found');
  const csrfToken = cookies.jsessionId.replace(/"/g, '');
  const url = `https://www.linkedin.com${path.startsWith('/') ? path : `/${path}`}`;

  const liTrack = JSON.stringify({
    clientVersion: '1.13.44343',
    mpVersion: '1.13.44343',
    osName: 'web',
    timezoneOffset: new Date().getTimezoneOffset() * -1,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    deviceFormFactor: 'DESKTOP',
    mpName: 'voyager-web',
    displayDensity: 1,
    displayWidth: 1920,
    displayHeight: 1080,
  });

  return fetch(url, {
    ...options,
    headers: {
      'csrf-token': csrfToken,
      'x-li-track': liTrack,
      'x-restli-protocol-version': '2.0.0',
      'x-li-accept': 'application/vnd.linkedin.normalized+json+2.1',
      ...options.headers,
    },
  });
}

