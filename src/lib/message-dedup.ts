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

/**
 * Stable content-identity key: two entries with the same key are the same
 * logical message delivered through different channels.
 *
 * Keyed on senderUrn + createdAt (the server's deliveredAt), NOT body — an
 * edit changes the body but keeps the same sender and deliveredAt, so a
 * body-based key would treat the edited SSE copy and the original canonical
 * copy as two different messages and show both.
 */
export function messageDedupeKey(m: Pick<Message, 'senderUrn' | 'createdAt'>): string {
  return `${m.senderUrn}|${m.createdAt}`;
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
 * replacement, collapse SSE/SSE duplicates of one logical message, and keep
 * canonical + temp + un-shadowed SSE entries, sorted ascending by createdAt.
 * Does not mutate the input.
 *
 * Edits: the canonical copy fetched before an edit holds the stale body while
 * the SSE edit event holds the new one. So the surviving (canonical/kept) copy
 * is overlaid with the body/editedAt/attachments of the freshest edited twin —
 * otherwise collapsing the duplicate would show the pre-edit text.
 */
export function dedupeMessagesForDisplay(all: Message[]): Message[] {
  const sortByTime = (a: Message, b: Message) => a.createdAt - b.createdAt;

  // Freshest edit (max editedAt) seen per stable identity, to fold onto the
  // surviving copy.
  const freshestEdit = new Map<string, { body: string; editedAt: number; attachments?: Message['attachments'] }>();
  for (const m of all) {
    if (!m.editedAt) continue;
    const key = messageDedupeKey(m);
    const cur = freshestEdit.get(key);
    if (!cur || m.editedAt > cur.editedAt) {
      freshestEdit.set(key, { body: m.body, editedAt: m.editedAt, attachments: m.attachments });
    }
  }
  const withFreshestEdit = (m: Message): Message => {
    const e = freshestEdit.get(messageDedupeKey(m));
    if (e && e.editedAt > (m.editedAt ?? 0)) {
      return { ...m, body: e.body, editedAt: e.editedAt, ...(e.attachments ? { attachments: e.attachments } : {}) };
    }
    return m;
  };

  const canonicalKeys = buildCanonicalKeySet(all);
  const keptSseKeys = new Set<string>();
  const out: Message[] = [];
  for (const msg of all) {
    // Each canonical id and each optimistic temp- id is a distinct message.
    if (msg.id.startsWith('temp-')) { out.push(msg); continue; }
    if (isCanonicalMessageId(msg.id)) { out.push(withFreshestEdit(msg)); continue; }
    // SSE entry: drop if a canonical twin exists, or if we already kept an SSE
    // copy of the same logical message (e.g. original fs_event + edited fsd_message).
    const key = messageDedupeKey(msg);
    if (canonicalKeys.has(key) || keptSseKeys.has(key)) continue;
    keptSseKeys.add(key);
    out.push(withFreshestEdit(msg));
  }
  return out.sort(sortByTime);
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
  updates: {
    id: string;
    updates: { editedAt?: number; reactions?: ReactionSummary[]; body?: string; attachments?: Message['attachments'] };
  }[];
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
      (m) => isCanonicalMessageId(m.id) && messageDedupeKey(m) === messageDedupeKey(orphan)
    );
    if (!canonical) continue;
    const u: DedupPlan['updates'][number]['updates'] = {};
    // An edited SSE copy carries the new body/editedAt the canonical (fetched
    // before the edit) lacks. When the orphan's edit is newer, fold its body
    // (and attachments) onto the canonical survivor so the edit isn't lost when
    // the orphan is deleted.
    if ((orphan.editedAt ?? 0) > (canonical.editedAt ?? 0)) {
      u.editedAt = orphan.editedAt;
      if (orphan.body !== canonical.body) u.body = orphan.body;
      if (orphan.attachments?.length && !canonical.attachments?.length) u.attachments = orphan.attachments;
    }
    if (orphan.reactions?.length && !canonical.reactions?.length) u.reactions = orphan.reactions;
    if (Object.keys(u).length > 0) updates.push({ id: canonical.id, updates: u });
  }

  return { deleteIds: stale.map((m) => m.id), updates };
}
