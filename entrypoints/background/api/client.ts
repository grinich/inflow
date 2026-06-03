import { getLinkedInCookies } from '../auth/cookies';
import { invalidateSessionCache } from '../auth/session';
import { debugLog } from '@/lib/debug-log';

const BASE_URL = 'https://www.linkedin.com/voyager/api';

/** Abort a voyager request after this long so a hung connection can't stall sync/queue. */
const VOYAGER_TIMEOUT_MS = 20_000;

// Use declarativeNetRequest to attach cookies since fetch() forbids the Cookie header
let lastCookieValue = '';

/** Clear the cached cookie value so the next request re-installs the declarativeNetRequest rule. */
export function invalidateCookieRule(): void {
  lastCookieValue = '';
}

function randomHex(len: number): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Stable per-session values — generated once on service worker start, like a real page session
const PAGE_INSTANCE = `urn:li:page:messaging_thread;${randomHex(12)}`;

// Stable version for the session — real client sends the same version throughout a session
const SESSION_VERSION = (() => {
  const now = new Date();
  const major = 1;
  const minor = now.getFullYear() - 2012;
  const patch = now.getMonth() * 4000 + now.getDate() * 100 + Math.floor(Math.random() * 99);
  return `${major}.${minor}.${patch}`;
})();

/** Cached x-li-track header — stable for the entire session like the real client. */
const LI_TRACK = JSON.stringify({
  clientVersion: SESSION_VERSION,
  mpVersion: SESSION_VERSION,
  osName: 'web',
  timezoneOffset: new Date().getTimezoneOffset() * -1,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  deviceFormFactor: 'DESKTOP',
  mpName: 'voyager-web',
  displayDensity: globalThis.devicePixelRatio || 1,
  displayWidth: globalThis.screen?.width || 1920,
  displayHeight: globalThis.screen?.height || 1080,
});

export async function ensureCookieRule(): Promise<void> {
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

    // CRITICAL: initiatorDomains scopes rules to only apply to requests from
    // this extension's service worker, NOT to LinkedIn's own page requests.
    // Without this, the rules corrupt LinkedIn's normal page requests (wrong
    // Referer, replaced cookies) which triggers PerimeterX bot detection.
    const extDomain = chrome.runtime.id;

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1, 2],
      addRules: [
        // Rule 1: make Voyager API requests look same-origin (cookie + browser headers)
        {
          id: 1,
          priority: 1,
          action: {
            type: MODIFY,
            requestHeaders: [
              { header: 'Cookie', operation: SET, value: cookieValue },
              { header: 'Sec-Fetch-Site', operation: SET, value: 'same-origin' },
              { header: 'Sec-Fetch-Mode', operation: SET, value: 'cors' },
              { header: 'Sec-Fetch-Dest', operation: SET, value: 'empty' },
              { header: 'Origin', operation: SET, value: 'https://www.linkedin.com' },
              { header: 'Referer', operation: SET, value: 'https://www.linkedin.com/messaging/' },
            ],
          },
          condition: {
            urlFilter: '||www.linkedin.com/voyager/',
            resourceTypes: [XHR, OTHER],
            initiatorDomains: [extDomain],
          },
        },
        // Rule 2: make realtime SSE requests look same-origin
        {
          id: 2,
          priority: 2,
          action: {
            type: MODIFY,
            requestHeaders: [
              { header: 'Cookie', operation: SET, value: cookieValue },
              { header: 'Sec-Fetch-Site', operation: SET, value: 'same-origin' },
              { header: 'Sec-Fetch-Mode', operation: SET, value: 'cors' },
              { header: 'Sec-Fetch-Dest', operation: SET, value: 'empty' },
              { header: 'Origin', operation: SET, value: 'https://www.linkedin.com' },
              { header: 'Referer', operation: SET, value: 'https://www.linkedin.com/messaging/' },
            ],
          },
          condition: {
            urlFilter: '||www.linkedin.com/realtime/',
            resourceTypes: [XHR, OTHER],
            initiatorDomains: [extDomain],
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

/** Random delay between 50-300ms to avoid machine-like request patterns. */
async function jitter(): Promise<void> {
  const delay = 50 + Math.random() * 250;
  return new Promise((r) => setTimeout(r, delay));
}

export interface VoyagerFetchOptions extends RequestInit {
  /** Skip the anti-detection jitter delay (for user-initiated requests). */
  skipJitter?: boolean;
}

export async function voyagerFetch(
  path: string,
  options: VoyagerFetchOptions = {}
): Promise<Response> {
  const cookies = await getLinkedInCookies();
  if (!cookies) {
    throw new Error('Not authenticated — LinkedIn cookies not found');
  }

  const csrfToken = cookies.jsessionId.replace(/"/g, '');
  const url = `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  await ensureCookieRule();
  if (!options.skipJitter) await jitter();

  debugLog('info', `voyagerFetch: ${url}`);

  const res = await fetch(url, {
    ...options,
    // Bound the request so a hung connection can't stall sync/queue forever.
    // (Streaming SSE uses realtimeFetch with its own AbortController, not this.)
    signal: options.signal ?? AbortSignal.timeout(VOYAGER_TIMEOUT_MS),
    headers: {
      'csrf-token': csrfToken,
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
      'x-li-track': LI_TRACK,
      'x-li-page-instance': PAGE_INSTANCE,
      'x-li-deco-include-micro-schema': 'true',
      accept: 'application/vnd.linkedin.normalized+json+2.1',
      ...(options.headers || {}),
    },
  });

  const shortPath = url.split('/voyager/api/')[1]?.substring(0, 120) || url;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      invalidateSessionCache();
    }
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

  return fetch(url, {
    ...options,
    headers: {
      'csrf-token': csrfToken,
      'x-li-track': LI_TRACK,
      'x-li-page-instance': PAGE_INSTANCE,
      'x-li-lang': 'en_US',
      'x-restli-protocol-version': '2.0.0',
      'x-li-accept': 'application/vnd.linkedin.normalized+json+2.1',
      ...options.headers,
    },
  });
}
