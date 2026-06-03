/** Shared helpers for the AI prompt builders (reply-suggestions + autocomplete). */

/** Remove the <conversation> delimiter tags from untrusted message bodies so a
 *  crafted body can't break out of the data block and inject instructions. */
export function stripConversationTags(s: string): string {
  return s.replace(/<\/?conversation>/gi, '');
}

/** Truncate to `max` chars with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
