import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_CONNECTION_INTERESTS,
  getConnectionInterests,
  setConnectionInterests,
} from '@/lib/ai-settings';

/**
 * Reactive access to the user's connection interest tags. Reads from
 * chrome.storage.local and stays in sync across the app (and other tabs) via
 * the storage change listener. Returns the tags plus an async setter.
 */
export function useConnectionInterests(): readonly [string[], (next: string[]) => Promise<void>] {
  const [interests, setInterestsState] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    getConnectionInterests().then((v) => {
      if (active) setInterestsState(v);
    });

    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('connectionInterests' in changes) {
        const next = changes.connectionInterests.newValue as string[] | undefined;
        setInterestsState(Array.isArray(next) ? next : [...DEFAULT_CONNECTION_INTERESTS]);
      }
    };
    chrome?.storage?.local?.onChanged?.addListener?.(listener);
    return () => {
      active = false;
      chrome?.storage?.local?.onChanged?.removeListener?.(listener);
    };
  }, []);

  const update = useCallback(async (next: string[]) => {
    await setConnectionInterests(next);
    // Optimistic local update; the storage listener will confirm it.
    setInterestsState(next.map((t) => t.trim()).filter((t, i, a) => t && a.indexOf(t) === i));
  }, []);

  return [interests, update] as const;
}
