import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/db/database';
import { useAISession } from './useAISession';
import { useCategorizeMode } from './useCategorizeMode';
import { getConnectionInterests } from '@/lib/ai-settings';
import { classifyConnections } from '@/lib/connection-classifier';
import { needsCategorization } from '@/lib/categorization-policy';
import type { Connection } from '@/types/connection';

export interface AutoCategorizeState {
  /** True while a categorization pass is running. */
  categorizing: boolean;
  /** People in the current pass still awaiting a result. */
  remaining: number;
  /** People successfully categorized in the current/last pass. */
  done: number;
  /** People whose categorization failed (retryable). Cumulative this session. */
  failed: number;
  /** Human-readable last error, if any. */
  error: string | null;
  /** Connections not yet categorized (drives the manual "Categorize now" CTA). */
  uncategorized: number;
  /** 'auto' runs after each sync; 'manual' waits for categorizeNow(). */
  mode: 'auto' | 'manual';
  /** Manually retry failed people (clears the failure cooldown). */
  retry: () => void;
  /** Force a categorization run now, regardless of mode (also clears failures). */
  categorizeNow: () => void;
}

/**
 * Auto-categorize connections after they sync, with visible progress + error
 * reporting. Watches the live connection list; rows without a `categorizedAt`
 * stamp are classified in batches and written back to IndexedDB, streaming in
 * per batch so the list fills progressively.
 *
 * Batches that fail (e.g. a rate limit) don't silently mislabel people or stall
 * the run — the affected people are held in a failure cooldown (so we don't
 * hammer the API) and surfaced via `failed`/`error`, and `retry()` re-attempts
 * them on demand.
 */
export function useAutoCategorize(connections: Connection[]): AutoCategorizeState {
  const { available, predict } = useAISession();
  const [mode] = useCategorizeMode();
  // Rows handed to an in-flight pass (dedupe overlapping renders).
  const inFlight = useRef<Set<string>>(new Set());
  // Rows that failed this session — excluded until retry() so a persistent
  // failure (e.g. quota exhausted) can't spin in a tight retry loop.
  const failedRef = useRef<Set<string>>(new Set());
  // Set by categorizeNow() to force one pass even in manual mode.
  const forceRef = useRef(false);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<Pick<AutoCategorizeState, 'categorizing' | 'remaining' | 'done' | 'failed' | 'error'>>({
    categorizing: false,
    remaining: 0,
    done: 0,
    failed: 0,
    error: null,
  });

  const uncategorized = useMemo(
    () => connections.filter((c) => !c.categorizedAt).length,
    [connections],
  );

  const retry = useCallback(() => {
    failedRef.current.clear();
    forceRef.current = true;
    setState((s) => ({ ...s, failed: 0, error: null }));
    setNonce((n) => n + 1); // re-run the effect
  }, []);

  const categorizeNow = useCallback(() => {
    failedRef.current.clear();
    forceRef.current = true;
    setState((s) => ({ ...s, failed: 0, error: null }));
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!available || !db) return;
    // In manual mode, only run when explicitly asked (categorizeNow/retry).
    if (mode !== 'auto' && !forceRef.current) return;
    forceRef.current = false;

    // Scan connections that have never been categorized OR whose categorization
    // is stale (older than ~6 months — people change roles).
    const now0 = Date.now();
    const pending = connections.filter(
      (c) =>
        needsCategorization(c, now0) &&
        !inFlight.current.has(c.profileUrn) &&
        !failedRef.current.has(c.profileUrn),
    );
    if (pending.length === 0) return;

    let cancelled = false;
    const abort = new AbortController();
    for (const c of pending) inFlight.current.add(c.profileUrn);
    setState((s) => ({ ...s, categorizing: true, remaining: pending.length, done: 0, error: null }));

    (async () => {
      const interests = await getConnectionInterests();
      const now = Date.now();
      let done = 0;

      await classifyConnections(
        pending.map((c) => ({
          profileUrn: c.profileUrn,
          fullName: c.fullName,
          headline: c.headline,
        })),
        interests,
        predict,
        // onBatch: persist a resolved batch.
        async (batch) => {
          if (cancelled || !db) return;
          await db.connections.bulkUpdate(
            batch.map((r) => ({
              key: r.profileUrn,
              changes: {
                roleCategory: r.roleCategory,
                interestTags: r.interestTags,
                categorizedAt: now,
              },
            })),
          );
          done += batch.length;
          if (!cancelled) {
            setState((s) => ({ ...s, done, remaining: Math.max(0, pending.length - done) }));
          }
        },
        // onError: hold failed people back and surface the reason.
        (urns, err) => {
          for (const u of urns) failedRef.current.add(u);
          if (!cancelled) {
            setState((s) => ({
              ...s,
              failed: failedRef.current.size,
              error: err instanceof Error ? err.message : 'Categorization failed',
            }));
          }
        },
        // Throttle + backoff so a big scan survives the free-tier rate limit;
        // abort stops the paced loop if the section unmounts mid-run.
        { signal: abort.signal },
      );
    })()
      .catch((e) => {
        if (!cancelled) {
          setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Categorization failed' }));
        }
      })
      .finally(() => {
        for (const c of pending) inFlight.current.delete(c.profileUrn);
        if (!cancelled) setState((s) => ({ ...s, categorizing: false, remaining: 0 }));
      });

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [connections, available, predict, mode, nonce]);

  return { ...state, uncategorized, mode, retry, categorizeNow };
}
