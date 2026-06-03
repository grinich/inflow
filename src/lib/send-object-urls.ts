/**
 * Lifecycle registry for blob: object URLs created as optimistic image-send
 * previews. Each set of URLs is keyed by the temp message id it belongs to, and
 * revoked exactly when that temp message leaves the DB — sent + cleaned up,
 * deleted, retried, or failed-then-deleted.
 *
 * Revoking on temp-message removal (rather than on send status change) fixes two
 * problems: offline-queued sends, whose URLs the synchronous success/fail paths
 * never reached (leak), and failed/queued bubbles that revoked their own URL
 * while still on screen (broken-image flash).
 */
const registry = new Map<string, string[]>();

/** Track the preview URLs for an optimistic send. No-op for an empty list. */
export function registerSendObjectUrls(tempId: string, urls: string[]): void {
  if (urls.length === 0) return;
  registry.set(tempId, urls);
}

/** Revoke and forget a temp id's URLs. Safe to call when nothing is registered. */
export function revokeSendObjectUrls(tempId: string): void {
  const urls = registry.get(tempId);
  if (!urls) return;
  for (const u of urls) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      // ignore (e.g. already revoked / non-blob URL)
    }
  }
  registry.delete(tempId);
}

/**
 * Revoke URLs for every registered temp id that is no longer present in the
 * given set of live temp message ids.
 */
export function reapOrphanSendObjectUrls(liveTempIds: Set<string>): void {
  for (const tempId of [...registry.keys()]) {
    if (!liveTempIds.has(tempId)) revokeSendObjectUrls(tempId);
  }
}

/** Test-only: number of temp ids currently holding URLs. */
export function _registeredSendUrlCount(): number {
  return registry.size;
}
