import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import { isNamedConnection } from '@/components/connections/connection-format';
import type { Connection } from '@/types/connection';

/**
 * Live-query the local connections table, most-recently-connected first.
 * Mirrors useConversations: includes useDbGeneration() so the query
 * re-subscribes when the DB opens or switches accounts.
 */
export function useConnections() {
  const dbGen = useDbGeneration();

  const connections = useLiveQuery(async () => {
    if (!db) return undefined;
    const all = await db.connections.orderBy('connectedAt').reverse().toArray();
    // Hide nameless "Unknown" rows (unresolved profiles) from the whole app.
    return all.filter(isNamedConnection);
  }, [dbGen]);

  return {
    connections: (connections ?? []) as Connection[],
    isLoading: connections === undefined,
  };
}
