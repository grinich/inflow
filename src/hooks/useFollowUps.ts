import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useDbGeneration } from './useDbGeneration';
import { useConnections } from './useConnections';
import { computeFollowUps, type FollowUp } from '@/lib/connection-followups';

/**
 * Follow-up suggestions derived from connections × conversation recency. The
 * "last contact" map is built from every conversation's lastActivityAt keyed by
 * participant, then handed to the pure {@link computeFollowUps}.
 */
export function useFollowUps(): { followUps: FollowUp[]; loading: boolean } {
  const { connections } = useConnections();
  const dbGen = useDbGeneration();

  const lastContact = useLiveQuery(async () => {
    if (!db) return undefined;
    const convs = await db.conversations.toArray();
    const map = new Map<string, number>();
    for (const c of convs) {
      const t = c.lastActivityAt ?? 0;
      for (const urn of c.participantUrns ?? []) {
        if (t > (map.get(urn) ?? 0)) map.set(urn, t);
      }
    }
    return map;
  }, [dbGen]);

  const followUps = useMemo(
    () => computeFollowUps(connections, lastContact ?? new Map(), { now: Date.now() }),
    [connections, lastContact],
  );

  return { followUps, loading: lastContact === undefined };
}
