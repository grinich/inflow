/**
 * GET /api/store-status
 *
 * Reports which version of inflow is actually live in the Chrome Web Store,
 * and when it went live, so the changelog can mark a release as shipped or
 * still in review. The browser cannot ask Google directly — the store sends
 * no CORS headers — so the fetch happens here.
 *
 *   { "ok": true, "chrome": { "version": "0.5.2",
 *                             "publishedAt": "2026-08-26T06:44:23.000Z",
 *                             "updatedText": "August 25, 2026" },
 *     "checkedAt": "..." }
 *
 * On any failure it answers { ok: false } with a short cache, and the page
 * simply renders no badge. Never 5xx: a missing badge should not look like a
 * broken site.
 */
import { parseListing } from './_cws.mjs';

const EXTENSION_ID = 'ndehgbgifkapdigmefglpgacpagoclge';
const LISTING_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`;
const UPSTREAM_TIMEOUT_MS = 8000;

/** Long enough that Google sees very little traffic, short enough to feel live. */
const CACHE_OK = 'public, s-maxage=900, stale-while-revalidate=86400';
/** A blip should retry soon, but still not once per visitor. */
const CACHE_FAIL = 'public, s-maxage=60, stale-while-revalidate=600';

async function fetchListing() {
  const res = await fetch(LISTING_URL, {
    headers: {
      // The listing is language-dependent; pin it so the parse is predictable.
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': 'inflow-site/1.0 (+https://inflow.im)',
    },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`store responded ${res.status}`);
  return res.text();
}

export default async function handler(_req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');

  try {
    const chrome = parseListing(await fetchListing());
    if (!chrome) throw new Error('listing did not parse');

    res.setHeader('cache-control', CACHE_OK);
    res.status(200).end(JSON.stringify({
      ok: true,
      chrome,
      checkedAt: new Date().toISOString(),
    }));
  } catch (err) {
    res.setHeader('cache-control', CACHE_FAIL);
    res.status(200).end(JSON.stringify({
      ok: false,
      reason: String(err && err.message ? err.message : err).slice(0, 200),
      checkedAt: new Date().toISOString(),
    }));
  }
}

export { parseListing, LISTING_URL };
