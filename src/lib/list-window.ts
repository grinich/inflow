/**
 * Pure windowing math for virtualized fixed-row-height lists. Renders only the
 * rows intersecting the viewport (plus overscan) with spacer padding above and
 * below, so a folder with hundreds of conversations mounts ~25 row components
 * instead of all of them.
 */
export interface ListWindow {
  /** First rendered row index (inclusive). */
  start: number;
  /** Last rendered row index (exclusive). */
  end: number;
  /** Height of the spacer above the rendered slice, in px. */
  topPad: number;
  /** Height of the spacer below the rendered slice, in px. */
  bottomPad: number;
}

export function computeWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
  overscan = 8
): ListWindow {
  if (rowCount <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  }
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(rowCount, Math.ceil((scrollTop + Math.max(viewportHeight, 0)) / rowHeight) + overscan);
  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: (rowCount - end) * rowHeight,
  };
}
