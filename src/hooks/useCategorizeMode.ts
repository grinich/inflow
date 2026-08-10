import { useCallback, useEffect, useState } from 'react';
import { getCategorizeMode, setCategorizeMode, type CategorizeMode } from '@/lib/ai-settings';

/**
 * Reactive access to the auto/manual categorization mode. Kept in sync across
 * the app via the chrome.storage change listener (same pattern as
 * useConnectionInterests).
 */
export function useCategorizeMode(): readonly [CategorizeMode, (m: CategorizeMode) => Promise<void>] {
  const [mode, setModeState] = useState<CategorizeMode>('auto');

  useEffect(() => {
    let active = true;
    getCategorizeMode().then((m) => {
      if (active) setModeState(m);
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ('categorizeMode' in changes) {
        setModeState(changes.categorizeMode.newValue === 'manual' ? 'manual' : 'auto');
      }
    };
    chrome?.storage?.local?.onChanged?.addListener?.(listener);
    return () => {
      active = false;
      chrome?.storage?.local?.onChanged?.removeListener?.(listener);
    };
  }, []);

  const update = useCallback(async (m: CategorizeMode) => {
    await setCategorizeMode(m);
    setModeState(m);
  }, []);

  return [mode, update] as const;
}
