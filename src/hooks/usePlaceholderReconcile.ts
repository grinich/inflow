import { useEffect, useRef } from 'react';
import { db } from '@/db/database';
import { useUIStore } from '@/store/ui-store';
import { navigateToConversation } from '@/lib/navigate-to-conversation';
import { reconcilePlaceholders } from '@/lib/reconcile-placeholders';
import type { Conversation } from '@/types/conversation';

/**
 * Retire accept-flow placeholders once the thread they stand in for arrives.
 *
 * Driven off the rendered list rather than a timer: the list changing is
 * exactly the moment a thread can have landed, and the sweep is an indexed
 * prefix lookup that finds nothing in the usual case. One pass at a time —
 * the deletes it makes re-render the list, and a re-entrant sweep would race
 * itself over the same rows.
 */
export function usePlaceholderReconcile(conversations: Conversation[]): void {
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    reconcilePlaceholders(db, {
      selectedId: useUIStore.getState().selectedConversationId,
      carryDraftAcross: (from, to) => useUIStore.getState().carryDraftAcross(from, to),
      navigate: navigateToConversation,
    })
      .catch(() => {})
      .finally(() => {
        running.current = false;
      });
  }, [conversations]);
}
