/**
 * Accepting an invitation makes LinkedIn deliver the sender's note as a new
 * inbound message, seconds later. That is the same event as any other arrival,
 * so it alerted — announcing a message the user had just chosen to accept and
 * was already being shown.
 *
 * Accepting records the sender here; the notification path checks before
 * alerting. Deliberately keyed on the sender rather than the conversation,
 * because at accept time the conversation does not exist yet — it is what the
 * accept creates.
 */

/** Long enough for LinkedIn to deliver the note, short enough not to mask a real message. */
const WINDOW_MS = 120_000;

const acceptedAt = new Map<string, number>();

function prune(now: number): void {
  for (const [urn, at] of acceptedAt) {
    if (now - at > WINDOW_MS) acceptedAt.delete(urn);
  }
}

/** Note that we just accepted this person's invitation. */
export function recordAcceptedSender(profileUrn: string): void {
  if (!profileUrn) return;
  const now = Date.now();
  prune(now);
  acceptedAt.set(profileUrn, now);
}

/** True while a message from this person is the note we already know about. */
export function isRecentlyAccepted(profileUrn: string | undefined): boolean {
  if (!profileUrn) return false;
  const at = acceptedAt.get(profileUrn);
  if (at === undefined) return false;
  if (Date.now() - at > WINDOW_MS) {
    acceptedAt.delete(profileUrn);
    return false;
  }
  return true;
}

/** Test seam. */
export function clearAcceptSuppression(): void {
  acceptedAt.clear();
}
