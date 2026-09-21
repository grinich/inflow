import { edgeShift, EDGE_MARGIN } from '@/lib/edge-clamp';

const BOUNDS = { left: 100, right: 500 };

describe('edgeShift', () => {
  it('leaves an overlay that already fits alone', () => {
    expect(edgeShift({ left: 200, right: 400 }, BOUNDS)).toBe(0);
  });

  it('pulls an overlay back from the right edge, keeping the margin', () => {
    expect(edgeShift({ left: 400, right: 600 }, BOUNDS)).toBe(-108);
  });

  it('pushes an overlay back from the left edge, keeping the margin', () => {
    expect(edgeShift({ left: 40, right: 240 }, BOUNDS)).toBe(68);
  });

  it('treats an overlay flush against the margin as fitting', () => {
    expect(edgeShift({ left: 100 + EDGE_MARGIN, right: 500 - EDGE_MARGIN }, BOUNDS)).toBe(0);
  });

  it('favours the left edge when the overlay is wider than the bounds', () => {
    // Both clamps fire; the left one wins, so the overlay starts at the margin
    // and runs off the right rather than starting off-screen.
    expect(edgeShift({ left: 50, right: 700 }, BOUNDS)).toBe(58);
  });

  it('accepts a custom margin', () => {
    expect(edgeShift({ left: 400, right: 600 }, BOUNDS, 0)).toBe(-100);
  });
});
