/**
 * Buffer for SeenReceipts that arrive before their message row exists.
 *
 * handleReadReceipt looks the target message up by exact id; when our sent
 * message exists only under an SSE-format id (send response unparseable,
 * canonical copy not yet fetched) — or the receipt races the message write —
 * the canonical urn:li:msg_message: target misses and the receipt would be
 * lost for good (the pagination API doesn't reliably return receipts).
 *
 * Unmatched receipts are stashed here and consumed by the message write paths
 * (SSE writes, FETCH_MESSAGES) when a row with that id is created. In-memory
 * only — a service-worker restart drops the buffer, same trade-off as the
 * mark-read suppression windows.
 */

interface PendingReceipt {
  seenAt: number;
  stashedAt: number;
}

const pending = new Map<string, PendingReceipt>();
const MAX_ENTRIES = 200;
const TTL_MS = 10 * 60 * 1000;

/** Stash a receipt whose message row doesn't exist yet. */
export function stashUnmatchedReceipt(messageUrn: string, seenAt: number): void {
  prune();
  const existing = pending.get(messageUrn);
  if (existing && existing.seenAt >= seenAt) return;
  if (!existing && pending.size >= MAX_ENTRIES) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.set(messageUrn, { seenAt, stashedAt: Date.now() });
}

/**
 * Apply buffered receipts onto message rows about to be written (mutates the
 * rows in place, taking the max of buffered and already-present seenAt).
 *
 * NON-DESTRUCTIVE: returns the matched message URNs; call
 * consumePendingReceipts with them only AFTER the write commits. Deleting on
 * apply destroyed the only copy of a receipt whenever the surrounding
 * transaction aborted (e.g. an account switch's isStaleContext early-return),
 * and the pagination API doesn't reliably return receipts — the message would
 * show unseen forever.
 */
export function applyPendingReceipts(messages: Array<{ id: string; seenAt?: number }>): string[] {
  if (pending.size === 0) return [];
  prune();
  const matched: string[] = [];
  for (const m of messages) {
    const entry = pending.get(m.id);
    if (!entry) continue;
    matched.push(m.id);
    if (!m.seenAt || entry.seenAt > m.seenAt) m.seenAt = entry.seenAt;
  }
  return matched;
}

/** Drop buffered receipts whose values have been durably written. */
export function consumePendingReceipts(messageUrns: string[]): void {
  for (const urn of messageUrns) pending.delete(urn);
}

function prune(): void {
  if (pending.size === 0) return;
  const cutoff = Date.now() - TTL_MS;
  for (const [key, entry] of pending) {
    if (entry.stashedAt < cutoff) pending.delete(key);
  }
}

/** Test-only: clear the buffer. */
export function __resetPendingReceipts(): void {
  pending.clear();
}
