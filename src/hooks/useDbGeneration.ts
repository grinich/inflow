import { useSyncExternalStore } from 'react';
import { subscribeDbChanged, getDbGeneration } from '@/db/database';

/**
 * Reactive database generation. Include the returned value in a
 * useLiveQuery deps array whenever the querier guards on `!db`: a query that
 * ran while the database was still null subscribed to nothing and would stay
 * frozen on its fallback forever — this re-subscribes it the moment the
 * database opens (initial page-load race) or switches accounts.
 */
export function useDbGeneration(): number {
  return useSyncExternalStore(subscribeDbChanged, getDbGeneration);
}
