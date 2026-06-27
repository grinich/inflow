import { useMemo } from 'react';
import { useUIStore } from '@/store/ui-store';
import { shortcutDefinitions, type ShortcutDef } from '@/lib/keyboard/shortcuts';

const GROUP_ORDER = ['Navigation', 'Actions', 'Compose', 'Global'] as const;

export const SHORTCUT_PANEL_PADDING = 'pb-64';

export function ShortcutOverlay() {
  const isOpen = useUIStore((s) => s.shortcutOverlayOpen);
  const setOpen = useUIStore((s) => s.setShortcutOverlayOpen);
  const version = chrome.runtime?.getManifest?.().version ?? '';

  const grouped = useMemo(() => {
    const map = new Map<string, ShortcutDef[]>();
    for (const group of GROUP_ORDER) map.set(group, []);
    for (const s of shortcutDefinitions) {
      map.get(s.group)?.push(s);
    }
    return map;
  }, []);

  return (
    <div
      aria-hidden={!isOpen}
      inert={!isOpen}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-edge bg-surface-raised transition-transform duration-200 ease-out ${
        isOpen ? 'translate-y-0' : 'translate-y-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-edge px-4 py-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">Shortcuts</h2>
        <span className="text-xs text-fg-muted">
          Press <kbd className="mx-0.5 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-ring">Esc</kbd> or{' '}
          <kbd className="mx-0.5 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] ring-1 ring-ring">?</kbd> to close
        </span>
        {version && (
          <span className="ml-auto text-[10px] font-medium tracking-wider text-fg-faint">
            inflow v{version}
          </span>
        )}
      </div>

      {/* Columns */}
      <div className="grid grid-cols-4 gap-0">
        {GROUP_ORDER.map((group) => (
          <div key={group} className="border-r border-edge px-3 py-2 last:border-r-0">
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{group}</h3>
            <div className="space-y-0.5">
              {grouped.get(group)?.map((s) => (
                <div
                  key={s.key + s.context + s.description}
                  className="flex items-center justify-between gap-2 py-0.5"
                >
                  <span className="truncate text-xs text-fg-secondary">{s.description}</span>
                  <kbd className="shrink-0 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary ring-1 ring-ring">
                    {s.display}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
