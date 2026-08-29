/**
 * Parsing for the public Chrome Web Store listing.
 *
 * The store gives no API for "is this version live yet" without publisher
 * OAuth, but its public listing page is server-rendered and carries both the
 * published version and the exact moment it went live. That moment is what
 * the changelog calls the approval date: v0.5.2 was tagged 18:12 UTC and the
 * listing timestamp reads 06:44 UTC the next day.
 *
 * The page is Google's, so it can change without warning. Everything here
 * returns null rather than guessing, and the caller degrades to showing
 * nothing at all — a missing badge is fine, a wrong one is not.
 *
 * Underscore-prefixed so Vercel treats it as a helper, not a route, and
 * .mjs so it is ESM in both places: the repo root sets type=module, while
 * Vercel builds from site/ where no package.json says so.
 */

/** The listing's own "Version" row: the label is stable, the classes are not. */
const VERSION_LABEL = />Version<\/div>\s*<div[^>]*>\s*([0-9][0-9A-Za-z.\-_]*)\s*<\/div>/;

/** The "Updated" row, kept only as the human string Google itself displays. */
const UPDATED_LABEL = />Updated<\/div>\s*<div[^>]*>\s*([^<]+?)\s*<\/div>/;

/**
 * Turn "1.2.10" into a comparable tuple. Non-numeric segments sort as 0, which
 * is good enough for the version numbers this project ships.
 */
function versionParts(v) {
  return String(v).split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** -1 / 0 / 1, like a comparator. */
function compareVersions(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The publish timestamp sits in a data array beside the version string:
 *   "0.5.2",[1787726663,228096000],"443KiB"
 * Anchoring the search to the version we already read off the Version row is
 * what keeps another extension on the page (the listing shows several) from
 * supplying its timestamp.
 */
function findPublishedAt(html, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`"${escaped}",\\[(\\d{9,11}),`).exec(html);
  if (!m) return null;
  const seconds = Number(m[1]);
  // Sanity-bound it: seconds since epoch, from 2009 (the store's launch) to a
  // little beyond now. A parse that drifts onto some other number fails here.
  if (!Number.isFinite(seconds) || seconds < 1230768000) return null;
  if (seconds > Date.now() / 1000 + 86400) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Pull the published version and its go-live time out of listing HTML.
 * Returns null when the page does not look like a listing any more.
 */
function parseListing(html) {
  if (typeof html !== 'string' || html.length < 1000) return null;

  const version = VERSION_LABEL.exec(html)?.[1] ?? null;
  if (!version) return null;

  return {
    version,
    publishedAt: findPublishedAt(html, version),
    updatedText: UPDATED_LABEL.exec(html)?.[1] ?? null,
  };
}

export { parseListing, compareVersions, versionParts };
