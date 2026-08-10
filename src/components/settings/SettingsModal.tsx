import { useCallback, useEffect, useState } from 'react';
import { useUIStore, type SettingsSection, type Theme } from '@/store/ui-store';
import { isDemoMode, enableDemoMode, disableDemoMode } from '@/lib/demo-mode';
import { checkForUpdateAndToast } from '@/lib/check-update';
import { AIKeySettings } from './AIKeySettings';
import { BackupSettings } from './BackupSettings';
import { Logo } from '@/components/common/Wordmark';

interface SectionDef {
  id: SettingsSection;
  label: string;
}

const SECTIONS: SectionDef[] = [
  { id: 'ai', label: 'AI' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'backup', label: 'Backup' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'about', label: 'About' },
];

function AppearanceSettings() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const options: { value: Theme; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
    { value: 'purple', label: 'Purple' },
  ];
  return (
    <div>
      <h3 className="text-sm font-semibold text-fg-strong">Theme</h3>
      <p className="mt-1 text-sm text-fg-secondary">Choose how inflow looks.</p>
      <div className="mt-3 inline-flex rounded-lg bg-surface p-1 ring-1 ring-ring">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => setTheme(o.value)}
            aria-pressed={theme === o.value}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              theme === o.value
                ? 'bg-blue-500/20 text-blue-200'
                : 'text-fg-secondary hover:text-fg-strong'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AdvancedSettings() {
  // demoMode from the store keeps this in sync if toggled elsewhere.
  const demoMode = useUIStore((s) => s.demoMode);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-strong">Demo mode</p>
          <p className="text-xs text-fg-muted">
            Browse a synthetic inbox with fake data — nothing touches your real LinkedIn account.
          </p>
        </div>
        <button
          onClick={() => (isDemoMode() ? disableDemoMode() : enableDemoMode())}
          className="shrink-0 rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          {demoMode ? 'Exit demo mode' : 'Enter demo mode'}
        </button>
      </div>
    </div>
  );
}

function AboutSettings() {
  const showToast = useUIStore((s) => s.showToast);
  const [checking, setChecking] = useState(false);
  const version = (() => {
    try {
      return chrome?.runtime?.getManifest?.().version ?? '';
    } catch {
      return '';
    }
  })();

  const check = async () => {
    setChecking(true);
    try {
      await checkForUpdateAndToast(showToast);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Logo />
        {version && <p className="mt-1 text-sm text-fg-secondary">Version {version}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={check}
          disabled={checking}
          className="rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong disabled:opacity-40"
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        <button
          onClick={() => {
            useUIStore.getState().closeSettings();
            useUIStore.getState().setWhatsNewOpen(true);
          }}
          className="rounded-md bg-surface-input px-3 py-1.5 text-sm font-medium text-fg-secondary ring-1 ring-inset ring-edge transition-colors hover:text-fg-strong"
        >
          What&rsquo;s new
        </button>
      </div>
      <div className="flex flex-col gap-2 border-t border-edge pt-4 text-sm">
        <a
          href="https://github.com/grinich/inflow/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-400"
        >
          Report a bug
        </a>
        <a
          href="https://chat.whatsapp.com/Cgj71APZz0uBkW5Y4WOhQO"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-400"
        >
          Join the WhatsApp group
        </a>
      </div>
    </div>
  );
}

export function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const section = useUIStore((s) => s.settingsSection);
  const close = useUIStore((s) => s.closeSettings);
  const setSection = useCallback(
    (s: SettingsSection) => useUIStore.getState().openSettings(s),
    [],
  );

  // Escape to close
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={close}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex h-[32rem] max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl bg-surface-raised shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Section nav */}
        <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-edge bg-surface p-2">
          <p className="px-2 pb-1 pt-1 text-sm font-semibold text-fg-strong">Settings</p>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? 'page' : undefined}
              className={`rounded-lg px-2.5 py-1.5 text-left text-sm font-medium transition-colors ${
                section === s.id
                  ? 'bg-blue-500/15 text-fg-strong ring-1 ring-inset ring-blue-500/30'
                  : 'text-fg-muted hover:bg-surface-hover hover:text-fg-secondary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {/* Section content */}
        <div className="relative min-w-0 flex-1 overflow-y-auto p-6">
          <button
            onClick={close}
            aria-label="Close settings"
            className="absolute right-4 top-4 rounded-md p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>

          {section === 'ai' && <AIKeySettings />}
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'backup' && <BackupSettings />}
          {section === 'advanced' && <AdvancedSettings />}
          {section === 'about' && <AboutSettings />}
        </div>
      </div>
    </div>
  );
}
