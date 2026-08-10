import { useCallback, useState } from 'react';
import { db } from '@/db/database';
import { useAISession } from './useAISession';
import { getConnectionInterests } from '@/lib/ai-settings';
import { classifyConnections } from '@/lib/connection-classifier';
import { summarizeConnection } from '@/lib/connection-summary';
import type { Connection } from '@/types/connection';

export interface RefreshConnectionState {
  refreshing: boolean;
  available: boolean;
  /** Re-run categorization + summary for one connection, now (any mode). */
  refresh: (connection: Connection) => Promise<void>;
}

/**
 * Explicit, per-connection "fetch new data" action for the detail pane. Unlike
 * the auto-categorizer this always runs when invoked (it's a user gesture), and
 * writes fresh categorization + summary in one shot so the auto-pass won't also
 * pick the row up. When a full-profile fetch endpoint lands, it plugs in here
 * before the AI step.
 */
export function useRefreshConnection(): RefreshConnectionState {
  const { available, predict } = useAISession();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(
    async (connection: Connection) => {
      if (!available || !db) return;
      setRefreshing(true);
      try {
        const interests = await getConnectionInterests();
        const catMap = await classifyConnections(
          [{
            profileUrn: connection.profileUrn,
            fullName: connection.fullName,
            headline: connection.headline,
          }],
          interests,
          predict,
        );
        const cat = catMap.get(connection.profileUrn);
        const summary = await summarizeConnection(connection.fullName, connection.headline, predict);
        const now = Date.now();
        await db.connections.update(connection.profileUrn, {
          roleCategory: cat?.roleCategory ?? connection.roleCategory ?? 'Other',
          interestTags: cat?.interestTags ?? connection.interestTags ?? [],
          categorizedAt: now,
          aiSummary: summary ?? '',
          summarizedAt: now,
        });
      } finally {
        setRefreshing(false);
      }
    },
    [available, predict],
  );

  return { refreshing, available, refresh };
}
