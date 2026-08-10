import { useCallback, useState } from 'react';
import { db } from '@/db/database';
import { useConnections } from './useConnections';
import { useAISession } from './useAISession';
import { useConnectionInterests } from './useConnectionInterests';
import { useUIStore } from '@/store/ui-store';
import { classifyConnections } from '@/lib/connection-classifier';
import {
  suggestInterestTags,
  diffRoles,
  pickRecatSample,
  type RecatCandidate,
} from '@/lib/connection-suggestions';

/** Cap the re-categorization scan so one run stays cheap. */
const RECAT_SAMPLE = 60;

export interface ConnectionSuggestionsState {
  available: boolean;
  loading: boolean;
  hasRun: boolean;
  error: string | null;
  suggestedTags: string[];
  recatCandidates: RecatCandidate[];
  refresh: () => Promise<void>;
  addTag: (tag: string) => Promise<void>;
  applyRecat: (c: RecatCandidate) => Promise<void>;
  dismissRecat: (profileUrn: string) => void;
}

/**
 * On-demand AI suggestions: proposed interest tags + re-categorization
 * candidates. Nothing runs until `refresh()` is called (a button), so it never
 * spends API calls on its own.
 */
export function useConnectionSuggestions(): ConnectionSuggestionsState {
  const { connections } = useConnections();
  const { available, predict } = useAISession();
  const [interests, setInterests] = useConnectionInterests();
  const showToast = useUIStore((s) => s.showToast);

  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const [recatCandidates, setRecatCandidates] = useState<RecatCandidate[]>([]);

  const refresh = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    setError(null);
    try {
      const tags = await suggestInterestTags(connections, interests, predict);
      const sample = pickRecatSample(connections, RECAT_SAMPLE);
      const results = await classifyConnections(
        sample.map((c) => ({ profileUrn: c.profileUrn, fullName: c.fullName, headline: c.headline })),
        interests,
        predict,
      );
      setSuggestedTags(tags);
      setRecatCandidates(diffRoles(sample, results));
      setHasRun(true);
    } catch (e: any) {
      setError(e?.message || 'Could not get suggestions');
    } finally {
      setLoading(false);
    }
  }, [available, connections, interests, predict]);

  const addTag = useCallback(
    async (tag: string) => {
      await setInterests([...interests, tag]);
      setSuggestedTags((t) => t.filter((x) => x !== tag));
      // Do NOT clear categorizedAt for everyone — re-scanning the whole network
      // for one tag is expensive. New connections pick it up automatically;
      // applying it to existing people is an explicit "Re-categorize all" action.
      showToast({ message: `Added “${tag}” — new connections will use it. Re-categorize to apply to existing.` });
    },
    [interests, setInterests, showToast],
  );

  const applyRecat = useCallback(
    async (c: RecatCandidate) => {
      if (db) await db.connections.update(c.profileUrn, { roleCategory: c.to, categorizedAt: Date.now() });
      setRecatCandidates((list) => list.filter((x) => x.profileUrn !== c.profileUrn));
    },
    [],
  );

  const dismissRecat = useCallback((profileUrn: string) => {
    setRecatCandidates((list) => list.filter((x) => x.profileUrn !== profileUrn));
  }, []);

  return {
    available,
    loading,
    hasRun,
    error,
    suggestedTags,
    recatCandidates,
    refresh,
    addTag,
    applyRecat,
    dismissRecat,
  };
}
