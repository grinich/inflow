import { useState, useEffect } from 'react';
import { readLocal } from '@/lib/storage';
import { isStoreInstall, STORE_URL } from '@/lib/store-install';

/** Dismissals are keyed by the running version, so a rebuild re-surfaces the nudge. */
const DISMISS_KEY = 'storeMigrationDismissedVersion';

/**
 * Banner asking sideloaded users to reinstall from the Chrome Web Store, where
 * Chrome keeps the extension up to date on its own.
 *
 * Store installs render nothing: they already auto-update, so the old
 * "download the zip and reload the folder" advice was not just unnecessary
 * there but wrong. Only an unpacked copy can be stranded on an old build.
 */
export function UpdateBanner() {
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    let active = true;
    readLocal<string>(DISMISS_KEY).then((d) => {
      if (!active) return;
      setDismissedVersion(d ?? null);
      setLoaded(true);
    });

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
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

  if (isStoreInstall()) return null;
  if (!loaded) return null;
  if (dismissedVersion === current) return null;

  const dismiss = () => {
    setDismissedVersion(current);
    chrome.storage.local.set({ [DISMISS_KEY]: current });
  };

  return (
    <div className="border-b border-edge bg-surface-raised text-sm">
      <div className="flex items-center justify-center gap-3 px-4 py-2">
        {/* Storefront / download icon */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-500">
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M4 19h16" />
        </svg>
        <span className="text-fg-secondary">
          inflow is now on the{' '}
          <span className="font-medium text-fg-strong">Chrome Web Store</span>
          <span className="text-fg-muted"> · this copy was loaded manually and won&apos;t update itself</span>
        </span>
        <a
          href={STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-md bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          Install from the store
        </a>
        <button
          onClick={() => setShowDetail((v) => !v)}
          className="cursor-pointer text-xs text-fg-muted underline-offset-2 transition-colors hover:text-fg-strong hover:underline"
        >
          What happens to my messages?
        </button>
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
      {showDetail && (
        <div className="border-t border-edge px-4 py-2 text-xs leading-relaxed text-fg-muted">
          <p>
            The store version is a separate extension as far as Chrome is concerned, so it starts
            with an <span className="font-medium text-fg-secondary">empty local database</span>. Your
            conversations re-sync from LinkedIn the first time you open it — nothing on LinkedIn is
            touched — but unsent drafts and your Gemini API key stay with this copy and will need to
            be re-entered.
          </p>
          <ol className="mt-1.5 ml-4 list-decimal space-y-1">
            <li>
              <a href={STORE_URL} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                Install inflow from the Chrome Web Store
              </a>
              {' '}and let it sync.
            </li>
            <li>Once your inbox looks right, remove this manually loaded copy.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
