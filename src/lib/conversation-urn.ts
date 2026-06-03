/**
 * Canonical conversation-ID extractor — the single source of truth for pulling
 * the thread id out of a full msg_conversation entityUrn. Previously this regex
 * was duplicated (and diverged) across the normalizer, the realtime handler, and
 * two API modules; the realtime copy was missing '+', dropping ids that contain
 * it. Handles base64 ids containing + / = and an optional trailing paren.
 *
 *   "urn:li:msg_conversation:(urn:li:fsd_profile:XXX,2-abc123)" -> "2-abc123"
 *
 * Returns '' when the input doesn't look like a conversation urn.
 */
export function extractConversationId(entityUrn: string): string {
  const match = entityUrn.match(/,([\w\-+=/]+)\)*$/);
  return match ? match[1] : '';
}
