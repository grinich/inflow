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

  // Near-time fallback (mirrors planSseDedup): after a send, the canonical row
  // stored from the send response and the SSE echo can carry server timestamps
  // a few ms apart — an exact-key check alone rendered the message twice until
  // the next fetch reconciled the DB. Canonicals already claimed by an exact
  // key twin are excluded, so two genuine rapid same-body sends don't collapse.
  const sseKeys = new Set(
    all.filter((m) => isSseMessageId(m.id)).map((m) => messageDedupeKey(m))
  );
  const fallbackCandidates = all.filter(
    (m) => isCanonicalMessageId(m.id) && !sseKeys.has(messageDedupeKey(m))
  );
  const consumedFallbackIds = new Set<string>();
  const hasNearTimeCanonicalTwin = (m: Message): boolean => {
    const twin = fallbackCandidates.find(
      (c) =>
        !consumedFallbackIds.has(c.id) &&
        c.senderUrn === m.senderUrn &&
        c.body === m.body &&
        Math.abs(c.createdAt - m.createdAt) <= FALLBACK_MATCH_WINDOW_MS
    );
    if (twin) consumedFallbackIds.add(twin.id);
    return !!twin;
  };

  const keptSseKeys = new Set<string>();
  const out: Message[] = [];
  for (const msg of all) {
    // Each canonical id and each optimistic temp- id is a distinct message.
    if (msg.id.startsWith('temp-')) { out.push(msg); continue; }
    if (isCanonicalMessageId(msg.id)) { out.push(withFreshestEdit(msg)); continue; }
    // SSE entry: drop if a canonical twin exists (exact key or near-time), or
    // if we already kept an SSE copy of the same logical message (e.g. original
    // fs_event + edited fsd_message).
    const key = messageDedupeKey(msg);
    if (canonicalKeys.has(key) || keptSseKeys.has(key)) continue;
    if (hasNearTimeCanonicalTwin(msg)) continue;
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
 * Window for the near-time fallback match: an SSE entry whose timestamp was
 * fabricated locally (Date.now() when the event lacked deliveredAt) can never
 * key-match its canonical twin, so we also match same-sender + same-body
 * entries within this window.
 */
const FALLBACK_MATCH_WINDOW_MS = 5_000;

/**
 * Plan a DB-cleanup dedup over all messages in a conversation. Pure — the caller
 * performs the actual `db.messages.update` / `bulkDelete` from the returned plan.
 *
 * @param opts.includeSentTemps also delete `temp-` messages whose status is 'sent'
 *   (used after a REST fetch confirms the optimistic send landed).
 */
export function planSseDedup(allMsgs: Message[], opts: { includeSentTemps?: boolean } = {}): DedupPlan {
  const canonicalKeys = buildCanonicalKeySet(allMsgs);

  // Canonical entries already claimed by an exact key twin are not available
  // for fallback matching — otherwise a rapid repeat of the same text ("ok"
  // sent twice) would let one canonical absorb both SSE copies.
  const consumedCanonicalKeys = new Set(
    allMsgs
      .filter((m) => !isCanonicalMessageId(m.id) && canonicalKeys.has(messageDedupeKey(m)))
      .map((m) => messageDedupeKey(m))
  );
  const fallbackCandidates = allMsgs.filter(
    (m) => isCanonicalMessageId(m.id) && !consumedCanonicalKeys.has(messageDedupeKey(m))
  );
  const consumedFallbackIds = new Set<string>();

  /** Canonical twin for an SSE orphan: exact key match, else one near-time
   *  same-sender+body match (each canonical absorbs at most one orphan). */
  const findCanonicalTwin = (orphan: Message): Message | undefined => {
    const exact = allMsgs.find(
      (m) => isCanonicalMessageId(m.id) && messageDedupeKey(m) === messageDedupeKey(orphan)
    );
    if (exact) return exact;
    const near = fallbackCandidates.find(
      (m) =>
        !consumedFallbackIds.has(m.id) &&
        m.senderUrn === orphan.senderUrn &&
        m.body === orphan.body &&
        Math.abs(m.createdAt - orphan.createdAt) <= FALLBACK_MATCH_WINDOW_MS
    );
    if (near) consumedFallbackIds.add(near.id);
    return near;
  };

  const staleWithTwins = allMsgs
    .map((m) => {
      if (opts.includeSentTemps && m.id.startsWith('temp-') && m.status === 'sent') {
        return { orphan: m, canonical: undefined };
      }
      if (!isSseMessageId(m.id)) return null;
      const canonical = findCanonicalTwin(m);
      return canonical ? { orphan: m, canonical } : null;
    })
    .filter((x): x is { orphan: Message; canonical: Message | undefined } => x !== null);

  const updates: DedupPlan['updates'] = [];
  for (const { orphan, canonical } of staleWithTwins) {
    // Only SSE entries carry editedAt / reactions worth preserving.
    if (!isSseMessageId(orphan.id)) continue;
    if (!orphan.editedAt && !orphan.reactions?.length) continue;
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

  return { deleteIds: staleWithTwins.map((s) => s.orphan.id), updates };
}

/** Messages safe to STORE from a fetch/event — recalled tombstones excluded. */
export function withoutRecalled(msgs: Message[]): Message[] {
  return msgs.filter((m) => !m.recalledAt);
}

/**
 * Plan deletions for messages recalled/unsent on the server. Pure.
 *
 * A freshly fetched page is authoritative for its own time range
 * [min fetched, max fetched] (recalled tombstone entities count toward the
 * range — a recalled LATEST message must still be removable):
 * - a stored CANONICAL row inside the range that the fetch no longer returned
 *   (or only returned as a recalled tombstone) was deleted server-side;
 * - a stored SSE-format row inside the range with no LIVE twin in the fetch
 *   (no exact senderUrn|createdAt key match, and no near-time same-sender+body
 *   match for fabricated timestamps) was recalled before its canonical copy
 *   was ever fetched — without this it would stay visible forever.
 * Rows outside the range (older pages, or a concurrent newer send) and
 * optimistic temps are never touched.
 */
export function planRecalledDeletions(fetched: Message[], stored: Message[]): string[] {
  const fetchedCanonical = fetched.filter((m) => isCanonicalMessageId(m.id));
  if (fetchedCanonical.length === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  const liveIds = new Set<string>();
  const liveKeys = new Set<string>();
  const liveByBody: Message[] = [];
  for (const m of fetchedCanonical) {
    if (m.createdAt < min) min = m.createdAt;
    if (m.createdAt > max) max = m.createdAt;
    if (m.recalledAt) continue; // a tombstone proves deletion — never "keeps" a row
    liveIds.add(m.id);
    liveKeys.add(messageDedupeKey(m));
    liveByBody.push(m);
  }

  const hasLiveTwin = (m: Message): boolean => {
    if (liveKeys.has(messageDedupeKey(m))) return true;
    return liveByBody.some(
      (f) =>
        f.senderUrn === m.senderUrn &&
        f.body === m.body &&
        Math.abs(f.createdAt - m.createdAt) <= FALLBACK_MATCH_WINDOW_MS
    );
  };

  return stored
    .filter((m) => {
      if (m.createdAt < min || m.createdAt > max) return false;
      if (isCanonicalMessageId(m.id)) return !liveIds.has(m.id);
      if (isSseMessageId(m.id)) return !hasLiveTwin(m);
      return false; // temps and anything else are never touched
    })
    .map((m) => m.id);
}
