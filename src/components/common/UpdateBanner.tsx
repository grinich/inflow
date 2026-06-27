import { useState, useEffect } from 'react';
import { readLocal } from '@/lib/storage';
import { isNewerVersion, UPDATE_STORAGE_KEY, type UpdateStatus } from '@/lib/update';

const DISMISS_KEY = 'updateBannerDismissedVersion';

/**
 * Persistent banner shown when a newer GitHub release exists than the running
 * build. Reads the status the background update checker writes to storage, and
 * re-renders live when it changes. Dismissal is per-version, so the banner
 * reappears only when a newer release ships.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      readLocal<UpdateStatus>(UPDATE_STORAGE_KEY),
      readLocal<string>(DISMISS_KEY),
    ]).then(([s, d]) => {
      if (!active) return;
      setStatus(s ?? null);
      setDismissedVersion(d ?? null);
    });

    // Reflect background writes (a fresh check) without a reload.
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes[UPDATE_STORAGE_KEY]) {
        setStatus((changes[UPDATE_STORAGE_KEY].newValue as UpdateStatus | undefined) ?? null);
      }
      if (changes[DISMISS_KEY]) {
        setDismissedVersion((changes[DISMISS_KEY].newValue as string | undefined) ?? null);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const current = chrome.runtime.getManifest().version;

  if (!status || !status.releaseUrl) return null;
  if (!isNewerVersion(status.latestVersion, current)) return null;
  if (dismissedVersion === status.latestVersion) return null;

  const dismiss = () => {
    setDismissedVersion(status.latestVersion);
    chrome.storage.local.set({ [DISMISS_KEY]: status.latestVersion });
  };

  return (
    <div className="flex items-center justify-center gap-3 border-b border-edge bg-surface-raised px-4 py-2 text-sm">
      {/* Arrow-up / update icon */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-500">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
      <span className="text-fg-secondary">
        inflow <span className="font-medium text-fg-strong">v{status.latestVersion}</span> is available
        <span className="text-fg-muted"> · you have v{current}</span>
      </span>
      <a
        href={status.releaseUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
      >
        What&apos;s changed
      </a>
      <button
        onClick={dismiss}
        className="ml-auto flex cursor-pointer items-center rounded p-0.5 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
        aria-label="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
