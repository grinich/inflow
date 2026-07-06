// @vitest-environment jsdom
/**
 * Feature: resizable conversation-list sidebar.
 *
 * The left pane had a fixed width (w-96) — long conversation previews
 * truncated with no way to widen the list. A divider between the panes now
 * shows a col-resize cursor and supports dragging (clamped to sane bounds),
 * double-click resets to the default, and the chosen width persists across
 * sessions via localStorage.
 */
import '../dom-setup';

// Node's experimental localStorage global shadows jsdom's here (vitest doesn't
// override pre-existing globals) — install a Map-backed polyfill.
const existing = (globalThis as any).localStorage;
if (!existing || typeof existing.getItem !== 'function') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

import { renderHook, act } from '@testing-library/react';
import {
  useResizableSidebar,
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
} from '@/hooks/useResizableSidebar';

function mouseDownAt(x: number): React.MouseEvent {
  return { clientX: x, preventDefault: () => {} } as unknown as React.MouseEvent;
}

function moveMouse(x: number) {
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: x }));
}

function releaseMouse() {
  window.dispatchEvent(new MouseEvent('mouseup'));
}

beforeEach(() => {
  localStorage.removeItem('inflow-sidebar-width');
});

describe('clampSidebarWidth (pure)', () => {
  it('enforces the minimum and maximum', () => {
    expect(clampSidebarWidth(50, 1600)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(5000, 1600)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it('caps at 60% of the window when that is below the hard maximum', () => {
    expect(clampSidebarWidth(5000, 1000)).toBe(600);
  });

  it('never collapses below the minimum on tiny windows', () => {
    expect(clampSidebarWidth(400, 300)).toBe(MIN_SIDEBAR_WIDTH);
  });

  it('passes through in-range values', () => {
    expect(clampSidebarWidth(450, 1600)).toBe(450);
  });
});

describe('useResizableSidebar', () => {
  it('starts at the default width', () => {
    const { result } = renderHook(() => useResizableSidebar());
    expect(result.current.width).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(result.current.isDragging).toBe(false);
  });

  it('drag widens the sidebar and persists on release', () => {
    const { result } = renderHook(() => useResizableSidebar());

    act(() => result.current.onDividerMouseDown(mouseDownAt(384)));
    expect(result.current.isDragging).toBe(true);

    act(() => moveMouse(484)); // +100px
    expect(result.current.width).toBe(DEFAULT_SIDEBAR_WIDTH + 100);

    act(() => releaseMouse());
    expect(result.current.isDragging).toBe(false);
    expect(localStorage.getItem('inflow-sidebar-width')).toBe(String(DEFAULT_SIDEBAR_WIDTH + 100));
  });

  it('clamps while dragging past the bounds', () => {
    const { result } = renderHook(() => useResizableSidebar());

    act(() => result.current.onDividerMouseDown(mouseDownAt(384)));
    act(() => moveMouse(0)); // drag far left
    expect(result.current.width).toBe(MIN_SIDEBAR_WIDTH);
    act(() => releaseMouse());
  });

  it('restores the persisted width on the next mount', () => {
    localStorage.setItem('inflow-sidebar-width', '512');
    const { result } = renderHook(() => useResizableSidebar());
    expect(result.current.width).toBe(512);
  });

  it('clamps a persisted width that no longer fits (garbage or huge values)', () => {
    localStorage.setItem('inflow-sidebar-width', '99999');
    expect(renderHook(() => useResizableSidebar()).result.current.width).toBeLessThanOrEqual(
      MAX_SIDEBAR_WIDTH
    );

    localStorage.setItem('inflow-sidebar-width', 'not-a-number');
    expect(renderHook(() => useResizableSidebar()).result.current.width).toBe(
      DEFAULT_SIDEBAR_WIDTH
    );
  });

  it('double-click resets to the default and persists it', () => {
    localStorage.setItem('inflow-sidebar-width', '512');
    const { result } = renderHook(() => useResizableSidebar());
    expect(result.current.width).toBe(512);

    act(() => result.current.onDividerDoubleClick());
    expect(result.current.width).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(localStorage.getItem('inflow-sidebar-width')).toBe(String(DEFAULT_SIDEBAR_WIDTH));
  });

  it('sets a col-resize cursor during the drag and restores it after', () => {
    const { result } = renderHook(() => useResizableSidebar());
    act(() => result.current.onDividerMouseDown(mouseDownAt(384)));
    expect(document.body.style.cursor).toBe('col-resize');
    act(() => releaseMouse());
    expect(document.body.style.cursor).toBe('');
  });
});
