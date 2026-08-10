import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { CHANGELOG_TEXT } from '@/lib/changelog-data';
import { coreVersion } from '@/lib/update';
import {
  parseChangelog,
  releasesSince,
  releaseForVersion,
  getLastSeenVersion,
  setLastSeenVersion,
  type ReleaseEntry,
} from '@/lib/changelog';

// The 3-part core of the manifest version (drops the prod build segment), which
// is what the changelog is keyed on.
function currentVersion(): string {
  try {
    const v = chrome?.runtime?.getManifest?.().version ?? '';
    return v ? coreVersion(v) : '';
  } catch {
    return '';
  }
}

/**
 * Shows release notes automatically the first time the app runs after an
 * update (comparing the running version against the last one the user saw), and
 * on demand via Settings/palette. Closable; dismissing marks the version seen.
 */
export function WhatsNewModal() {
  const manualOpen = useUIStore((s) => s.whatsNewOpen);
  const setManualOpen = useUIStore((s) => s.setWhatsNewOpen);

  const version = useMemo(currentVersion, []);
  const entries = useMemo(() => parseChangelog(CHANGELOG_TEXT), []);
  const [autoOpen, setAutoOpen] = useState(false);

  // Decide on mount whether to auto-show. A fresh install (no seen version) is
  // silently marked as current so we don't greet first-time users with notes.
  useEffect(() => {
    if (!version) return;
    const seen = getLastSeenVersion();
    if (seen === null) {
      setLastSeenVersion(version);
      return;
    }
    if (releasesSince(entries, seen, version).length > 0) setAutoOpen(true);
  }, [version, entries]);

  const open = autoOpen || manualOpen;

  const releases: ReleaseEntry[] = useMemo(() => {
    if (autoOpen) {
      return releasesSince(entries, getLastSeenVersion(), version);
    }
    // Manual: show the current version's notes, or the newest entry we have.
    const cur = releaseForVersion(entries, version);
    return cur ? [cur] : entries.slice(0, 1);
  }, [autoOpen, manualOpen, entries, version]);

  const close = useCallback(() => {
    if (version) setLastSeenVersion(version);
    setAutoOpen(false);
    setManualOpen(false);
  }, [version, setManualOpen]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, close]);

  if (!open || releases.length === 0) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div
        role="dialog"
        aria-label="What's new"
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-surface-raised shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-edge px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-fg-strong">What&rsquo;s new</h2>
            <p className="text-xs text-fg-muted">
              {releases.length === 1
                ? `Version ${releases[0].version}`
                : `Versions ${releases[releases.length - 1].version}–${releases[0].version}`}
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            className="rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {releases.map((rel) => (
            <div key={rel.version}>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-fg-strong">v{rel.version}</span>
                {rel.date && <span className="text-xs text-fg-faint">{rel.date}</span>}
              </div>
              {rel.groups.map((g, gi) => (
                <div key={gi} className="mt-2">
                  {g.label && (
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">{g.label}</p>
                  )}
                  <ul className="mt-1 space-y-1.5">
                    {g.items.map((item, ii) => (
                      <li key={ii} className="flex gap-2 text-sm text-fg-secondary">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-fg-faint" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="flex justify-end border-t border-edge px-5 py-3">
          <button
            onClick={close}
            className="rounded-md btn-primary px-4 py-1.5 text-sm font-medium transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
