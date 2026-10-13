import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import { dueMessages } from '@/lib/scheduled-messages';
import type { ScheduledMessage } from '@/types/scheduled-message';

export interface OutboxGroups {
  /** Scheduled messages whose time has arrived — surfaced for a one-click send. */
  ready: ScheduledMessage[];
  /** Scheduled for a future time. */
  scheduled: ScheduledMessage[];
  /** Drafts with no send time yet. */
  drafts: ScheduledMessage[];
  /** Failed sends (retryable). */
  failed: ScheduledMessage[];
  /** Sent history, most recent first. */
  sent: ScheduledMessage[];
  /** Count that needs the user's attention now (ready + failed). */
  attention: number;
}

/**
 * Groups the local outbound queue for the Outbox section. "Scheduled" messages
 * whose time has passed are *resurfaced* as `ready` (we never auto-send — the
 * user sends with one click), so we re-evaluate on a slow tick while mounted.
 */
export function useOutbox(): OutboxGroups {
  const dbGen = useDbGeneration();
  const rows = useLiveQuery(async () => {
    if (!db) return [] as ScheduledMessage[];
    return db.scheduledMessages.toArray();
  }, [dbGen]) ?? [];

  // Re-evaluate "ready" as time passes, even without a DB change.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const dueIds = new Set(dueMessages(rows, now).map((r) => r.id));

  const ready: ScheduledMessage[] = [];
  const scheduled: ScheduledMessage[] = [];
  const drafts: ScheduledMessage[] = [];
  const failed: ScheduledMessage[] = [];
  const sent: ScheduledMessage[] = [];

  for (const r of rows) {
    if (r.status === 'sent') sent.push(r);
    else if (r.status === 'failed') failed.push(r);
    else if (r.status === 'draft') drafts.push(r);
    else if (dueIds.has(r.id)) ready.push(r); // scheduled + due
    else scheduled.push(r); // scheduled (future) or sending
  }

  // Every comparison needs a tie-break, or equal keys leave the order to
  // db.scheduledMessages.toArray() — which is primary-key order over random
  // UUIDs. Queueing a batch for one time (a morning's outreach, all at 08:00)
  // made every row compare equal, so they appeared in no order at all and
  // reshuffled whenever anything changed. Oldest first within a tie, then id,
  // so the sequence is total and stable across renders.
  const tie = (a: ScheduledMessage, b: ScheduledMessage) =>
    (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id);
  const by = (key: (m: ScheduledMessage) => number, desc = false) =>
    (a: ScheduledMessage, b: ScheduledMessage) => {
      const d = desc ? key(b) - key(a) : key(a) - key(b);
      return d || tie(a, b);
    };

  ready.sort(by((m) => m.scheduledAt ?? 0));
  scheduled.sort(by((m) => m.scheduledAt ?? 0));
  drafts.sort(by((m) => m.updatedAt ?? 0, true));
  failed.sort(by((m) => m.updatedAt ?? 0, true));
  sent.sort(by((m) => m.sentAt ?? m.updatedAt ?? 0, true));

  return { ready, scheduled, drafts, failed, sent, attention: ready.length + failed.length };
}
