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

// ---------------------------------------------------------------------------
// Mutation suppression — prevents SSE events from un-archiving / re-categorizing
// conversations that were just mutated by the user (archive, move, star, etc.).
//
// This covers the "echo" period after the API call completes but before the
// SSE stream stops sending stale events. The pending-action guard (Fix #1)
// covers the in-flight period before the API call completes.
// ---------------------------------------------------------------------------

const MUTATION_TTL_MS = 15_000; // 15 seconds

const _recentMutations = new Map<string, number>();

/**
 * Record that we just sent a mutation API call (archive, move, star, etc.)
 * for this conversation. Call this from the action handlers in messages.ts.
 */
export function recordMutation(conversationId: string): void {
  _recentMutations.set(conversationId, Date.now());
}

/**
 * Check whether a conversation's category/archived state should be protected
 * from SSE overwrites because we recently mutated it.
 */
export function isMutationSuppressed(conversationId: string): boolean {
  const now = Date.now();
  for (const [id, ts] of _recentMutations) {
    if (now - ts > MUTATION_TTL_MS) _recentMutations.delete(id);
  }
  const mutatedAt = _recentMutations.get(conversationId);
  return !!mutatedAt && now - mutatedAt <= MUTATION_TTL_MS;
}
