/**
 * Pick the best image artifact from a LinkedIn VectorImage `artifacts` array.
 *
 * Returns the smallest artifact whose width is at least `minWidth` (good enough
 * without being oversized). When none reach the threshold, falls back to the
 * LARGEST available artifact — the closest we can get to the desired size.
 *
 * Non-mutating: the input array is copied before sorting (the previous inline
 * copies sorted the source array in place, corrupting caller-held references).
 */
export function pickArtifact<T extends { width?: number }>(
  artifacts: T[] | undefined,
  minWidth: number,
): T | undefined {
  if (!artifacts || artifacts.length === 0) return undefined;
  const sorted = [...artifacts].sort((a, b) => (a.width || 0) - (b.width || 0));
  return sorted.find((a) => (a.width || 0) >= minWidth) || sorted[sorted.length - 1];
}
