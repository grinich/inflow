import type { ScheduledMessage, ScheduledStatus } from '@/types/scheduled-message';

/** Scheduled messages whose send time has arrived. */
export function dueMessages(rows: ScheduledMessage[], now: number): ScheduledMessage[] {
  return rows.filter(
    (r) => r.status === 'scheduled' && typeof r.scheduledAt === 'number' && r.scheduledAt <= now,
  );
}

/** Sort for the queue: pending first (soonest scheduled, then drafts), then sent/failed. */
export function sortForQueue(rows: ScheduledMessage[]): ScheduledMessage[] {
  const rank: Record<ScheduledStatus, number> = {
    scheduled: 0,
    sending: 0,
    draft: 1,
    failed: 2,
    sent: 3,
  };
  return [...rows].sort((a, b) => {
    const r = rank[a.status] - rank[b.status];
    if (r !== 0) return r;
    // Within scheduled: soonest first. Otherwise most recently touched first.
    if (a.status === 'scheduled' && b.status === 'scheduled') {
      return (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0);
    }
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
}

export function statusLabel(status: ScheduledStatus): string {
  switch (status) {
    case 'draft': return 'Draft';
    case 'scheduled': return 'Scheduled';
    case 'sending': return 'Sending…';
    case 'sent': return 'Sent';
    case 'failed': return 'Failed';
  }
}

/**
 * Does this message still need a human to confirm who it is going to?
 *
 * Only drafts Claude made, and only InMail: Claude resolved a name to a URN
 * out of the user's sight, and one real prospect's name returned two different
 * people. A message the user composed needs no check — they picked the
 * recipient from a list showing their name, headline and photo — and a
 * connection needs none either, since that URN came from the user's own
 * synced list.
 *
 * Shared by the Outbox (which disables Send) and the background auto-sender
 * (which must not fire past a gate the UI is still showing), so the two can
 * never disagree about whether a message is cleared to go.
 */
export function awaitsRecipientConfirmation(
  msg: Pick<ScheduledMessage, 'source' | 'inMailSubject' | 'recipientConfirmedAt'>,
  confirmRecipient: boolean,
): boolean {
  if (!confirmRecipient) return false;
  if (msg.source !== 'mcp' || msg.inMailSubject === undefined) return false;
  return !msg.recipientConfirmedAt;
}

/**
 * How late a scheduled message may be and still send itself.
 *
 * Chrome has to be running for the alarm to fire, so a message whose time
 * passed while the browser was quit is found overdue on the next tick. Sending
 * it then is right when the gap is short — the laptop opened twenty minutes
 * late — and wrong when it is long, because a note timed for Tuesday morning
 * should not arrive on Wednesday afternoon on its own.
 *
 * Three hours keeps it inside the same part of the same day.
 */
export const AUTO_SEND_GRACE_MS = 3 * 60 * 60 * 1000;

/**
 * True when a message is so far past its time that it should wait for the user
 * instead of sending itself. It stays scheduled, so the Outbox keeps showing
 * it as ready and one click still sends it.
 */
export function isTooLateToAutoSend(
  msg: Pick<ScheduledMessage, 'scheduledAt'>,
  now: number,
): boolean {
  if (typeof msg.scheduledAt !== 'number') return false;
  return now - msg.scheduledAt > AUTO_SEND_GRACE_MS;
}
