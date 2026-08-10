/**
 * Small pure helpers for drag-to-reorder lists with a persisted order.
 */

/** Move `from` to sit immediately before `to`. No-op if either is missing. */
export function moveBefore<T>(list: T[], from: T, to: T): T[] {
  if (from === to) return list;
  const without = list.filter((x) => x !== from);
  const idx = without.indexOf(to);
  if (idx === -1 || !list.includes(from)) return list;
  without.splice(idx, 0, from);
  return without;
}

/**
 * Reconcile a saved order against the current set of keys: keep saved keys that
 * still exist (in saved order), then append any new keys not yet in it. Ensures
 * the order stays valid as sections are added or removed across releases.
 */
export function normalizeOrder<T>(saved: T[], all: T[]): T[] {
  const known = saved.filter((k) => all.includes(k));
  const missing = all.filter((k) => !known.includes(k));
  return [...known, ...missing];
}
