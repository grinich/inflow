/** Horizontal bounds of the area an overlay has to stay inside. */
export interface EdgeBounds {
  left: number;
  right: number;
}

/** Gap kept between an overlay and the edge it would otherwise cross. */
export const EDGE_MARGIN = 8;

/**
 * How far to slide an overlay horizontally so it sits inside `bounds`.
 *
 * The thread's scroll container clips horizontally (`overflow-x-hidden`), so an
 * overlay anchored to a bubble — the hover action card, the reaction picker —
 * is cut off rather than merely overhanging when its anchor sits near an edge.
 * `rect` is the overlay's natural (unshifted) position; the result is 0 when it
 * already fits. Clamping the left edge last keeps that edge visible if the
 * overlay is ever wider than the bounds.
 */
export function edgeShift(
  rect: { left: number; right: number },
  bounds: EdgeBounds,
  margin = EDGE_MARGIN,
): number {
  let shift = 0;
  if (rect.right > bounds.right - margin) shift = bounds.right - margin - rect.right;
  if (rect.left + shift < bounds.left + margin) shift = bounds.left + margin - rect.left;
  return shift;
}
