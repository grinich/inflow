import type { InflowDatabase } from '@/db/database';
import type { Conversation } from '@/types/conversation';

/**
 * How long the accept flow gets to complete its own hand-off before the sweep
 * treats a stand-in as stranded. Its deadline is 15s (settleJump); the margin
 * keeps the two from both carrying the same half-typed reply, which loses it.
 */
export const PLACEHOLDER_STALE_MS = 20_000;

export interface ReconcileHooks {
  /** The conversation the user is looking at, if any. */
  selectedId: string | null;
  /** Hand a half-typed reply from the placeholder to the real thread. */
  carryDraftAcross: (from: string, to: string) => void;
  /** Put the user in the real thread when the row under them goes away. */
  navigate: (conversationId: string) => void | Promise<void>;
  /** Injectable clock, so the staleness rule is testable. */
  now?: () => number;
}

/**
 * Retire accept-flow placeholders whose real thread has since arrived.
 *
 * Accepting an invitation writes a `draft-` stand-in so the jump is instant,
 * and the accept flow deletes it once the thread LinkedIn creates shows up.
 * That hand-off is time-boxed (15s) and only runs while the user stays in the
 * inbox, so a slow thread — or a click elsewhere — strands the placeholder
 * forever. Stranded, it hides the real thread from the list, and the row the
 * user clicks opens a composer instead of the message that came with the
 * invitation.
 *
 * Runs the same hand-off late, whenever the list settles: carry the draft
 * across, follow the selection to the real thread, drop the stand-in. A draft
 * the user is composing is never taken away from them — stamped rows are the
 * accept flow's own, and an unstamped row (stranded by a build that predates
 * the stamp) is only retired when it is empty and not the one on screen.
 *
 * Returns the ids it retired.
 */
export async function reconcilePlaceholders(
  db: InflowDatabase,
  hooks: ReconcileHooks,
): Promise<string[]> {
  // Primary-key prefix scan: placeholders are all `draft-` ids, so this is an
  // index range, not a walk of every conversation.
  const drafts = await db.conversations.where('id').startsWith('draft-').toArray();
  const now = (hooks.now ?? Date.now)();
  const candidates = drafts.filter(
    (c) =>
      c.participantUrns.length === 1 &&
      // Leave a fresh accept to its own hand-off — it snapshots the live
      // composer and waits for the flush, which this sweep cannot do.
      now - c.lastActivityAt >= PLACEHOLDER_STALE_MS,
  );
  if (candidates.length === 0) return [];

  const retired: string[] = [];
  for (const placeholder of candidates) {
    // Rows stranded by builds that predate the `placeholder` stamp are
    // indistinguishable from a new message being composed, so they are only
    // retired on terms that are safe for either: nothing typed into them, and
    // the user somewhere else. An empty draft to someone you already have a
    // thread with is leftover whichever wrote it — composing to them ends up
    // in that thread anyway (see NewMessageComposer's handleTransitionToThread).
    const stamped = placeholder.placeholder === 1;
    if (!stamped) {
      if (hooks.selectedId === placeholder.id) continue;
      const typed = await db.draftAttachments.get(placeholder.id).catch(() => undefined);
      if (typed?.text || typed?.files?.length) continue;
    }

    const real = await findRealThread(db, placeholder.participantUrns[0]);
    if (!real) continue; // still waiting on the thread — the stand-in earns its keep

    if (hooks.selectedId === placeholder.id) {
      hooks.carryDraftAcross(placeholder.id, real.id);
      await hooks.navigate(real.id);
    }
    await moveStoredDraft(db, placeholder.id, real.id);
    await db.conversations.delete(placeholder.id);
    retired.push(placeholder.id);
  }
  return retired;
}

/** The newest real 1:1 thread with this person, if one exists. */
async function findRealThread(
  db: InflowDatabase,
  participantUrn: string,
): Promise<Conversation | undefined> {
  const withPerson = await db.conversations.where('participantUrns').equals(participantUrn).toArray();
  return withPerson
    .filter((c) => c.draft !== 1 && c.participantUrns.length === 1)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
}

/**
 * Carry anything already typed into the placeholder over to the real thread.
 * A reply the destination already holds wins — it is the newer of the two, and
 * clobbering it would lose what the user is typing right now.
 */
async function moveStoredDraft(db: InflowDatabase, fromId: string, toId: string): Promise<void> {
  const stored = await db.draftAttachments.get(fromId).catch(() => undefined);
  if (!stored) return;
  const destination = await db.draftAttachments.get(toId).catch(() => undefined);
  if (!destination?.text && !destination?.files?.length && (stored.text || stored.files?.length)) {
    await db.draftAttachments.put({ ...stored, conversationId: toId }).catch(() => {});
  }
  await db.draftAttachments.delete(fromId).catch(() => {});
}
