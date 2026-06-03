/**
 * Read a single key from chrome.storage.local, swallowing access errors.
 * Returns the raw stored value (or undefined if unset / on error); callers apply
 * their own defaulting and validation. Centralizes the try/get/catch boilerplate
 * shared by the settings modules.
 */
export async function readLocal<T = unknown>(key: string): Promise<T | undefined> {
  try {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  } catch {
    return undefined;
  }
}
