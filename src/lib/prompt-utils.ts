/** Shared helpers for the AI prompt builders (reply-suggestions + autocomplete). */

/** Remove the <conversation> delimiter tags from untrusted message bodies so a
 *  crafted body can't break out of the data block and inject instructions.
 *  Loops until the string stops changing: a single pass leaves nested tags
 *  behind ("<con<conversation>versation>" → "<conversation>"). */
export function stripConversationTags(s: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<\/?conversation>/gi, '');
  } while (s !== prev);
  return s;
}

/** Truncate to `max` chars with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

/** Keep the LAST `max` chars (with a leading ellipsis) — for text being
 *  completed, where the model must see what's immediately before the cursor. */
export function truncateTail(s: string, max: number): string {
  return s.length > max ? '...' + s.slice(-max) : s;
}
