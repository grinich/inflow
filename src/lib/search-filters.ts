/**
 * Filter-token patterns recognized by the conversation search box. Stripping
 * these from a query leaves the free-text remainder used for matching and
 * highlighting. Keep in sync with the parser in src/hooks/useConversations.ts.
 */
const FILTER_TOKEN_PATTERNS: RegExp[] = [
  /has:draft/gi,
  /has:attachment/gi,
  /is:unread/gi,
  /is:starred/gi,
  /is:read/gi,
  /is:group/gi,
  /from:\S+/gi,
  /company:\S+/gi,
  /after:\d{4}-\d{2}-\d{2}/gi,
  /before:\d{4}-\d{2}-\d{2}/gi,
  /newer:\d+d/gi,
  /older:\d+d/gi,
];

/** Remove every recognized filter token, returning the trimmed free-text query. */
export function stripFilterTokens(query: string): string {
  let q = query;
  for (const re of FILTER_TOKEN_PATTERNS) q = q.replace(re, ' ');
  return q.replace(/\s+/g, ' ').trim();
}
