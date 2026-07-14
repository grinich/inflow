import { useSyncExternalStore } from 'react';

/** Below this window width the conversation list collapses to an avatar rail.
 *  MIN_SIDEBAR_WIDTH (280) plus a usable thread pane (~420px) no longer fit,
 *  so instead of squeezing both panes the list yields to the thread. */
export const SIDEBAR_COLLAPSE_THRESHOLD = 700;

/** Fixed width of the collapsed avatar rail. */
export const RAIL_WIDTH = 68;

function subscribe(callback: () => void) {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}

/** True when the window is too narrow for the full conversation list. */
export function useCollapsedSidebar(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.innerWidth < SIDEBAR_COLLAPSE_THRESHOLD
  );
}
