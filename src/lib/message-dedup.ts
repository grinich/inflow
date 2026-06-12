import type { Message, ReactionSummary } from '@/types/message';

/**
 * Message deduplication helpers.
 *
 * LinkedIn delivers the same logical message through two channels with different
 * IDs: the SSE Voyager stream stores `urn:li:fsd_message:` / `urn:li:fs_event:`
 * entries, while the Messenger REST API uses the canonical `urn:li:msg_message:`.
 * When both exist we treat the canonical one as the source of truth and drop the
 * SSE duplicate — but the SSE entry is the only one that carries `editedAt` and
 * `reactions`, so those fields must be preserved onto the canonical version first.
 */

const CANONICAL_PREFIX = 'urn:li:msg_message:';
const SSE_PREFIXES = ['urn:li:fsd_message:', 'urn:li:fs_event:'];

export function isCanonicalMessageId(id: string): boolean {
  return id.startsWith(CANONICAL_PREFIX);
}

export function isSseMessageId(id: string): boolean {
  return SSE_PREFIXES.some((p) => id.startsWith(p));
}

/** Content-identity key: two entries with the same key are the same logical message. */
export function messageDedupeKey(m: Pick<Message, 'body' | 'senderUrn' | 'createdAt'>): string {
  return `${m.body}|${m.senderUrn}|${m.createdAt}`;
}

/** Set of content keys for which a canonical (msg_message) entry exists. */
export function buildCanonicalKeySet(msgs: Message[]): Set<string> {
  const keys = new Set<string>();
  for (const m of msgs) {
    if (isCanonicalMessageId(m.id)) keys.add(messageDedupeKey(m));
  }
  return keys;
}

/**
 * Read-side dedup for display: drop SSE duplicates that have a canonical
 * replacement, keep canonical + temp + un-shadowed SSE entries, sorted ascending
 * by createdAt. Does not mutate the input.
 */
export function dedupeMessagesForDisplay(all: Message[]): Message[] {
  const canonicalKeys = buildCanonicalKeySet(all);
  const sortByTime = (a: Message, b: Message) => a.createdAt - b.createdAt;
  if (canonicalKeys.size === 0) return [...all].sort(sortByTime);
  return all
    .filter((msg) => {
      if (isCanonicalMessageId(msg.id) || msg.id.startsWith('temp-')) return true;
      return !canonicalKeys.has(messageDedupeKey(msg));
    })
    .sort(sortByTime);
}

/**
 * Carry SSE-written fields (seenAt / reactions / editedAt) from existing DB
 * rows onto freshly fetched replacements before a bulkPut. The pagination API
 * doesn't return these fields — they only arrive via SSE — so re-fetching a
 * conversation without this would silently wipe read receipts, reactions, and
 * edit markers. Mutates `incoming` in place. `existing` is positionally
 * aligned with `incoming` (the result of `bulkGet(incoming.map(m => m.id))`).
 */
export function preserveSseFields(incoming: Message[], existing: (Message | undefined)[]): void {
  for (let i = 0; i < incoming.length; i++) {
    const prev = existing[i];
    if (!prev) continue;
    if (prev.seenAt && !incoming[i].seenAt) incoming[i].seenAt = prev.seenAt;
    if (prev.reactions?.length && !incoming[i].reactions?.length) incoming[i].reactions = prev.reactions;
    if (prev.editedAt && !incoming[i].editedAt) incoming[i].editedAt = prev.editedAt;
  }
}

export interface DedupPlan {
  /** Message IDs to delete (SSE orphans, plus sent temps when requested). */
  deleteIds: string[];
  /** Field preservation to apply to canonical entries before deleting orphans. */
  updates: { id: string; updates: { editedAt?: number; reactions?: ReactionSummary[] } }[];
}

/**
 * Plan a DB-cleanup dedup over all messages in a conversation. Pure — the caller
 * performs the actual `db.messages.update` / `bulkDelete` from the returned plan.
 *
 * @param opts.includeSentTemps also delete `temp-` messages whose status is 'sent'
 *   (used after a REST fetch confirms the optimistic send landed).
 */
export function planSseDedup(allMsgs: Message[], opts: { includeSentTemps?: boolean } = {}): DedupPlan {
  const canonicalKeys = buildCanonicalKeySet(allMsgs);

  const stale = allMsgs.filter((m) => {
    if (opts.includeSentTemps && m.id.startsWith('temp-') && m.status === 'sent') return true;
    return isSseMessageId(m.id) && canonicalKeys.has(messageDedupeKey(m));
  });

  const updates: DedupPlan['updates'] = [];
  for (const orphan of stale) {
    // Only SSE entries carry editedAt / reactions worth preserving.
    if (!isSseMessageId(orphan.id)) continue;
    if (!orphan.editedAt && !orphan.reactions?.length) continue;
    const canonical = allMsgs.find(
      (m) =>
        isCanonicalMessageId(m.id) &&
        m.body === orphan.body &&
        m.senderUrn === orphan.senderUrn &&
        m.createdAt === orphan.createdAt
    );
    if (!canonical) continue;
    const u: { editedAt?: number; reactions?: ReactionSummary[] } = {};
    if (orphan.editedAt && !canonical.editedAt) u.editedAt = orphan.editedAt;
    if (orphan.reactions?.length && !canonical.reactions?.length) u.reactions = orphan.reactions;
    if (Object.keys(u).length > 0) updates.push({ id: canonical.id, updates: u });
  }

  return { deleteIds: stale.map((m) => m.id), updates };
}
