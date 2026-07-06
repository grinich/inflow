import { useState, useEffect, useRef, useCallback } from 'react';

/** Default sidebar width — matches the previous fixed Tailwind w-96. */
export const DEFAULT_SIDEBAR_WIDTH = 384;
/** Narrow enough to save space, wide enough for the tab bar + previews. */
export const MIN_SIDEBAR_WIDTH = 280;
/** Hard ceiling; also capped to a fraction of the window (see clamp). */
export const MAX_SIDEBAR_WIDTH = 720;

const STORAGE_KEY = 'inflow-sidebar-width';

/** localStorage via globalThis with a guard — absent in some test/SW contexts. */
function storage(): Storage | null {
  try {
    const ls = (globalThis as any).localStorage as Storage | undefined;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

/**
 * Clamp a requested sidebar width: never narrower than MIN, never wider than
 * MAX or 60% of the window (so the thread pane always keeps real estate).
 */
export function clampSidebarWidth(px: number, windowWidth: number): number {
  const maxForWindow = Math.min(MAX_SIDEBAR_WIDTH, Math.floor(windowWidth * 0.6));
  // On very small windows the 60% cap can undercut MIN — MIN wins so the
  // sidebar never collapses into unusability.
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(px, Math.max(maxForWindow, MIN_SIDEBAR_WIDTH)));
}

function loadStoredWidth(): number {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
    return clampSidebarWidth(parsed, window.innerWidth);
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

/**
 * Resizable conversation-list sidebar: attach `onDividerMouseDown` /
 * `onDividerDoubleClick` to a divider element between the panes. Dragging
 * resizes live (clamped), releasing persists the width to localStorage, and a
 * double-click resets to the default.
 */
export function useResizableSidebar() {
  const [width, setWidth] = useState(loadStoredWidth);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); // don't start a text selection
    dragStart.current = { x: e.clientX, width };
    setIsDragging(true);
  }, [width]);

  useEffect(() => {
    if (!isDragging) return;

    function onMouseMove(e: MouseEvent) {
      const start = dragStart.current;
      if (!start) return;
      setWidth(clampSidebarWidth(start.width + (e.clientX - start.x), window.innerWidth));
    }
    function onMouseUp() {
      dragStart.current = null;
      setIsDragging(false);
      // Persist the final width (state updates queue; read it via the setter).
      setWidth((w) => {
        try { storage()?.setItem(STORAGE_KEY, String(w)); } catch {}
        return w;
      });
    }

    // Keep the resize cursor and suppress selection everywhere while dragging —
    // the pointer inevitably leaves the thin divider mid-drag.
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [isDragging]);

  const onDividerDoubleClick = useCallback(() => {
    setWidth(DEFAULT_SIDEBAR_WIDTH);
    try { storage()?.setItem(STORAGE_KEY, String(DEFAULT_SIDEBAR_WIDTH)); } catch {}
  }, []);

  return { width, isDragging, onDividerMouseDown, onDividerDoubleClick };
}
