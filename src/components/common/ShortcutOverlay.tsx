import { useUIStore } from '@/store/ui-store';
import { shortcutDefinitions } from '@/lib/keyboard/shortcuts';

export function ShortcutOverlay() {
  const isOpen = useUIStore((s) => s.shortcutOverlayOpen);
  const setOpen = useUIStore((s) => s.setShortcutOverlayOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-md rounded-xl bg-surface-raised p-6 shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg-strong">Keyboard Shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-fg-muted transition-colors hover:text-fg-secondary"
          >
            Esc
          </button>
        </div>
        <div className="space-y-1">
          {shortcutDefinitions.map((s) => (
            <div key={s.key + s.context + (s.shift ? 'shift' : '') + (s.meta ? 'meta' : '')} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-fg-secondary">{s.description}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-muted">{s.context}</span>
                <kbd className="rounded bg-surface px-2 py-0.5 text-xs font-mono text-fg-secondary ring-1 ring-ring">
                  {s.display}
                </kbd>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
