import type { InboxData } from '../../src/contracts.js';

export type PageUpdate = { source: 'host' | 'refresh' | 'append' };

function sameList(previous: InboxData | null, next: Pick<InboxData, 'tab' | 'query'>) {
  return previous?.tab === next.tab && previous.query === next.query;
}

/** Refresh the loaded window in one bounded request; larger lists retain their
 * cached tail until it is explicitly reloaded. Never restart pagination on a poll. */
export function inboxPageRequest(
  previous: InboxData | null,
  next: Pick<InboxData, 'tab' | 'query'>,
  append: boolean,
) {
  const current = sameList(previous, next) ? previous : null;
  return {
    offset: append ? (current?.nextOffset ?? 0) : 0,
    limit: append ? 30 : Math.min(100, Math.max(30, current?.conversations.length ?? 0)),
  };
}

export function reconcileInboxPage(
  previous: InboxData | null,
  next: InboxData,
  queryDraft: string,
  update: PageUpdate,
) {
  let data = next;
  if (previous && sameList(previous, next) && next.connected && next.state !== 'connection') {
    if (update.source === 'append') {
      const fresh = new Map(next.conversations.map((row) => [row.id, row]));
      const existingIds = new Set(previous.conversations.map((row) => row.id));
      data = {
        ...next,
        conversations: [
          ...previous.conversations.map((row) => fresh.get(row.id) ?? row),
          ...next.conversations.filter((row) => !existingIds.has(row.id)),
        ],
      };
    } else if (update.source === 'refresh' && next.nextOffset !== null) {
      const refreshedIds = new Set(next.conversations.map((row) => row.id));
      const cutoff = next.conversations.at(-1)?.lastActivityAt;
      // Keep older rows displaced by new arrivals as well as the cached tail.
      // Rows missing inside the refreshed time range have been removed/filtered.
      const tail = previous.conversations.filter(
        (row) => !refreshedIds.has(row.id) && cutoff !== undefined && row.lastActivityAt <= cutoff,
      );
      const nextOffset = next.nextOffset + tail.length;
      data = {
        ...next,
        conversations: [...next.conversations, ...tail],
        nextOffset: nextOffset >= next.total ? null : nextOffset,
      };
    }
  }
  return { data, queryDraft: update.source === 'host' ? next.query : queryDraft };
}
