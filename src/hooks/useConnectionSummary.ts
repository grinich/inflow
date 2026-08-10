import { useEffect, useRef, useState } from 'react';
import { db } from '@/db/database';
import { useAISession } from './useAISession';
import { useCategorizeMode } from './useCategorizeMode';
import { summarizeConnection } from '@/lib/connection-summary';
import type { Connection } from '@/types/connection';

export interface ConnectionSummaryState {
  /** The cached summary ('' if none / not applicable). */
  summary: string;
  /** True while a summary is being generated. */
  generating: boolean;
}

/**
 * Lazily generate + cache a one-line AI summary for the selected connection.
 * Runs only when the detail pane shows a person without a cached summary and
 * the AI key is configured. The result is written back to IndexedDB, so it
 * persists and is generated at most once per person (until their headline
 * changes, which drops the cache via mergeConnections).
 */
export function useConnectionSummary(connection: Connection | null): ConnectionSummaryState {
  const { available, predict } = useAISession();
  const [mode] = useCategorizeMode();
  const inFlight = useRef<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!connection || !available || !db) return;
    // In manual mode no AI runs on its own — summaries come only from the
    // per-connection Refresh button.
    if (mode !== 'auto') return;
    // Already summarized (summarizedAt set even if summary is empty) or nothing
    // to summarize.
    if (connection.summarizedAt || !connection.headline) return;
    if (inFlight.current.has(connection.profileUrn)) return;

    const urn = connection.profileUrn;
    inFlight.current.add(urn);
    let cancelled = false;
    setGenerating(true);

    (async () => {
      const summary = await summarizeConnection(connection.fullName, connection.headline, predict);
      if (cancelled || !db) return;
      // Stamp summarizedAt even when empty so we don't retry a dud forever.
      await db.connections.update(urn, { aiSummary: summary || '', summarizedAt: Date.now() });
    })()
      .catch(() => {
        // Leave unsummarized so a later open retries.
      })
      .finally(() => {
        inFlight.current.delete(urn);
        if (!cancelled) setGenerating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connection?.profileUrn, connection?.summarizedAt, connection?.headline, available, predict, mode]);

  return { summary: connection?.aiSummary || '', generating };
}
