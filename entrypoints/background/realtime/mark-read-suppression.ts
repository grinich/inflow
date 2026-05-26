/**
 * Tracks conversations we've recently marked as read via the API.
 *
 * LinkedIn's SSE sends a RealtimeConversation echo after our mark-as-read
 * PATCH with unreadConversationsCount > 0 (inbox-wide count, not per-conversation).
 * Without suppression, this echo sets the conversation back to unread, triggering
 * auto-mark-read again in an infinite loop.
 *
 * The suppression window is 10 seconds — long enough for the echo to arrive
 * and be dropped, short enough that a genuine new message will be processed.
 */

const SUPPRESSION_TTL_MS = 10_000;

/** Map of conversationId → timestamp when we marked it read. */
const _recentlyMarkedRead = new Map<string, number>();

/**
 * Record that we just sent a mark-as-read API call for this conversation.
 * Call this from the MARK_READ handler in messages.ts.
 */
export function recordMarkRead(conversationId: string): void {
  _recentlyMarkedRead.set(conversationId, Date.now());
}

/**
 * Check whether a conversation update event should be suppressed because
 * we recently marked this conversation as read.
 *
 * Also cleans up expired entries to prevent unbounded growth.
 */
export function shouldSuppressConversationUpdate(conversationId: string): boolean {
  const now = Date.now();

  // Clean up expired entries (lazy GC)
  for (const [id, ts] of _recentlyMarkedRead) {
    if (now - ts > SUPPRESSION_TTL_MS) {
      _recentlyMarkedRead.delete(id);
    }
  }

  const markedAt = _recentlyMarkedRead.get(conversationId);
  if (markedAt && now - markedAt <= SUPPRESSION_TTL_MS) {
    return true;
  }

  return false;
}
