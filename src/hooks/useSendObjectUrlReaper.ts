import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useDbGeneration } from '@/hooks/useDbGeneration';
import { reapOrphanSendObjectUrls } from '@/lib/send-object-urls';

/**
 * Mount once at the app root. Watches the set of optimistic temp- message ids and
 * revokes any registered preview object URLs whose temp message has left the DB,
 * so blob: previews don't leak after a send is confirmed, deleted, or retried.
 */
export function useSendObjectUrlReaper(): void {
  const dbGen = useDbGeneration();
  const tempIds = useLiveQuery(
    async () => {
      if (!db) return [] as string[];
      const ids = await db.messages.where('id').startsWith('temp-').primaryKeys();
      return ids as string[];
    },
    [dbGen],
    [] as string[],
  );

  useEffect(() => {
    reapOrphanSendObjectUrls(new Set(tempIds));
  }, [tempIds.join(',')]);
}
