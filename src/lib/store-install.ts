/**
 * Tells a Chrome Web Store install apart from a manually loaded one.
 *
 * The two are different extensions to Chrome: the store assigns its own ID,
 * while unpacked builds carry the `key` pinned in wxt.config.ts. That identity
 * split is why a store install starts with an empty database — and why only the
 * sideloaded copy needs to be told to migrate. Comparing `chrome.runtime.id`
 * avoids the "management" permission that installType would cost.
 */

/** Extension ID Google assigned to the Chrome Web Store listing. */
export const STORE_EXTENSION_ID = 'ndehgbgifkapdigmefglpgacpagoclge';

/**
 * Extension ID Microsoft assigns to the Edge Add-ons listing. Empty until the
 * first Edge submission exists — paste the ID from the Partner Center listing
 * here AND into the site probe lists (site/app.html candidates,
 * site/index.html probes). See docs/edge-add-ons-release.md.
 */
export const EDGE_STORE_EXTENSION_ID = '';

/** Every store-assigned ID. Store installs auto-update via their store. */
const STORE_EXTENSION_IDS = new Set(
  [STORE_EXTENSION_ID, EDGE_STORE_EXTENSION_ID].filter(Boolean)
);

/** Public CWS listing, used by the migration banner's call to action. */
export const STORE_URL =
  `https://chromewebstore.google.com/detail/${STORE_EXTENSION_ID}`;

/** The listing an install came from (CWS for anything that isn't Edge-store). */
export function storeUrlFor(id: string | undefined = safeRuntimeId()): string {
  if (id && id === EDGE_STORE_EXTENSION_ID) {
    return `https://microsoftedge.microsoft.com/addons/detail/${EDGE_STORE_EXTENSION_ID}`;
  }
  return STORE_URL;
}

/**
 * True when this build was installed from a store (Chrome Web Store or Edge
 * Add-ons), and therefore updates itself. False for unpacked/sideloaded
 * builds, which never will.
 */
export function isStoreInstall(id: string | undefined = safeRuntimeId()): boolean {
  return id !== undefined && STORE_EXTENSION_IDS.has(id);
}

function safeRuntimeId(): string | undefined {
  try {
    return chrome.runtime?.id;
  } catch {
    return undefined;
  }
}
