/**
 * Regression: computeWindow could return start > end, rendering ZERO rows
 * behind a giant top spacer.
 *
 * `start` was clamped only against 0, never against rowCount. When the list
 * shrinks while the container is scrolled far down (e.g. 500 conversations,
 * scrolled near the bottom, then a search narrows the list to one match),
 * computeWindow(31400, 600, 64, 1, 8) returned {start: 482, end: 1,
 * topPad: 30848} — conversations.slice(482, 1) is [] and the huge topPad
 * keeps the container tall, so the browser never clamps scrollTop and the
 * list stays blank until the user scrolls by hand.
 *
 * Fix: clamp start into [0, rowCount-1], so the window degrades to rendering
 * the tail rows instead of nothing.
 */
import { computeWindow } from '@/lib/list-window';

it('renders the tail rows when scrollTop is beyond the shrunken content', () => {
  const w = computeWindow(31400, 600, 64, 1, 8);
  expect(w.start).toBeLessThan(w.end);
  expect(w).toEqual({ start: 0, end: 1, topPad: 0, bottomPad: 0 });
});

it('never returns an empty window for a non-empty list', () => {
  for (const scrollTop of [0, 100, 5000, 100000]) {
    for (const rowCount of [1, 5, 100]) {
      const w = computeWindow(scrollTop, 600, 64, rowCount, 8);
      expect(w.start).toBeGreaterThanOrEqual(0);
      expect(w.end).toBeGreaterThan(w.start);
      expect(w.end).toBeLessThanOrEqual(rowCount);
      expect(w.topPad).toBe(w.start * 64);
      expect(w.bottomPad).toBe((rowCount - w.end) * 64);
    }
  }
});

it('keeps normal mid-list windows unchanged', () => {
  const w = computeWindow(640, 600, 64, 100, 8);
  // rows 10..19 visible, ±8 overscan
  expect(w).toEqual({ start: 2, end: 28, topPad: 128, bottomPad: 72 * 64 });
});
