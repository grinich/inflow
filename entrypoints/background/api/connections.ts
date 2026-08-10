import { voyagerFetch } from './client';
import { debugLog } from '@/lib/debug-log';

// Decoration that inlines the connected member's Profile (name, headline,
// picture) alongside each Connection so a single request has everything the
// list needs.
const DECORATION =
  'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16';

// LinkedIn caps this endpoint's page size; 40 is the largest it reliably honors.
export const CONNECTIONS_PAGE_SIZE = 40;

// Safety ceiling so a viewer with thousands of connections can't spin the
// pager indefinitely. Covers the vast majority of accounts; the loop also
// stops early on the first short page.
export const MAX_CONNECTIONS = 2000;

/**
 * Fetch one page of the viewer's connections, most-recently-added first.
 * Returns the raw normalized+json response for {@link normalizeConnections}.
 */
export async function fetchConnectionsPage(
  count: number = CONNECTIONS_PAGE_SIZE,
  start: number = 0,
): Promise<any> {
  const path =
    `/relationships/dash/connections?decorationId=${DECORATION}` +
    `&count=${count}&q=search&sortType=RECENTLY_ADDED&start=${start}`;

  // First page is user-initiated (panel open) — skip the human-like jitter.
  const res = await voyagerFetch(path, { skipJitter: start === 0 });
  if (!res.ok) {
    debugLog('error', `fetchConnectionsPage failed: ${res.status}`);
    throw new Error(`Fetch connections failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Page through the viewer's entire connection list (RECENTLY_ADDED first),
 * invoking `onPage` with each raw response as it arrives so the caller can
 * normalize + persist incrementally (the UI fills in progressively).
 *
 * Stops when a page returns fewer than a full page of elements (the last page)
 * or when `maxConnections` is reached. Returns the number of elements seen.
 */
export async function fetchAllConnections(
  onPage: (raw: any, pageIndex: number) => Promise<void> | void,
  maxConnections: number = MAX_CONNECTIONS,
): Promise<number> {
  let start = 0;
  let pageIndex = 0;
  let total = 0;

  while (start < maxConnections) {
    // Don't overshoot the cap on the final page.
    const count = Math.min(CONNECTIONS_PAGE_SIZE, maxConnections - start);
    const raw = await fetchConnectionsPage(count, start);
    const elements: any[] = raw?.data?.['*elements'] || [];

    await onPage(raw, pageIndex);
    total += elements.length;

    // A short page means we've reached the end of the list.
    if (elements.length < count) break;
    start += CONNECTIONS_PAGE_SIZE;
    pageIndex++;
  }

  return total;
}
