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

/** Public listing, used by the migration banner's call to action. */
export const STORE_URL =
  `https://chromewebstore.google.com/detail/${STORE_EXTENSION_ID}`;

/**
 * True when this build was installed from the Chrome Web Store, and therefore
 * updates itself. False for unpacked/sideloaded builds, which never will.
 */
export function isStoreInstall(id: string | undefined = safeRuntimeId()): boolean {
  return id === STORE_EXTENSION_ID;
}

function safeRuntimeId(): string | undefined {
  try {
    return chrome.runtime?.id;
  } catch {
    return undefined;
  }
}
