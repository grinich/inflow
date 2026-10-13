import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { THEME_OPTIONS, themeOption } from '@/lib/themes';

/**
 * Theme switcher for the nav rail, sitting above Settings.
 *
 * A flyout rather than a strip that opens inside the rail: the rail collapses
 * to ~48px, which cannot hold four labelled swatches, and an in-rail strip
 * would also push the items below it as it opened. The panel floats instead,
 * so the same layout works collapsed or expanded and the rail never moves.
 *
 * Picking a theme applies it immediately. The Settings panel keeps its own
 * draft-then-Save behaviour, which suits a screen full of other pending
 * choices; a one-click switcher that needed a second confirmation elsewhere
 * would not be worth reaching for.
 */
export function ThemeSwitcher({ collapsed }: { collapsed?: boolean }) {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = themeOption(theme);

  // Escape closes and returns focus, so the keyboard is not left in a panel
  // that is no longer on screen.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${current.label}`}
        title={collapsed ? `Theme: ${current.label}` : undefined}
        className={`flex w-full cursor-pointer items-center rounded-lg py-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary ${
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5'
        }`}
      >
        <span
          aria-hidden
          className="h-[18px] w-[18px] shrink-0 rounded-md ring-1 ring-inset ring-black/25 dark:ring-white/25"
          style={{ background: current.swatch }}
        />
        {!collapsed && <span className="text-xs">Theme</span>}
      </button>

      {open && (
        <>
          {/* Click-away. Covers the viewport beneath the panel so a click
              anywhere else closes rather than falling through to the app. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Theme"
            className="absolute bottom-0 left-full z-50 ml-2 min-w-[132px] rounded-xl border border-edge bg-surface-raised p-1.5 shadow-lg"
          >
            {THEME_OPTIONS.map((o) => {
              const active = o.value === theme;
              return (
                <button
                  key={o.value}
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setTheme(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-[background-color,transform] duration-150 hover:translate-x-0.5 hover:bg-surface-hover ${
                    active ? 'font-semibold text-fg-strong' : 'text-fg-secondary hover:text-fg-strong'
                  }`}
                >
                  <span
                    aria-hidden
                    className="h-4 w-4 shrink-0 rounded ring-1 ring-inset ring-black/25 dark:ring-white/25"
                    style={{ background: o.swatch }}
                  />
                  {o.label}
                  {active && <span aria-hidden className="ml-auto text-[11px] text-blue-500">✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
