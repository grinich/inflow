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
  // Clamp start into the list: when the list shrinks while the container is
  // scrolled past its new end (search narrowing a long list), an unclamped
  // start exceeds `end` and the window renders zero rows behind a huge top
  // spacer — which keeps the container tall, so the browser never clamps
  // scrollTop and the blank list never self-corrects.
  const start = Math.max(0, Math.min(Math.floor(scrollTop / rowHeight) - overscan, rowCount - 1));
  const end = Math.min(rowCount, Math.ceil((scrollTop + Math.max(viewportHeight, 0)) / rowHeight) + overscan);
  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: (rowCount - end) * rowHeight,
  };
}
