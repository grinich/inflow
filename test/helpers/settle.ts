/**
 * Wait for in-flight optimistic actions before a test closes its database.
 *
 * An optimistic action patches IndexedDB immediately, then confirms (or rolls
 * back) on an un-awaited promise chain once the bridge replies. A test that
 * waits only for the local patch — which always lands first — finishes while
 * that chain is still queued, so the follow-up write hits a database that
 * teardown has already closed. Vitest reports the rejection as an unhandled
 * DatabaseClosedError and blames whichever file happened to be running, which
 * is why it looked like a flake in an unrelated suite.
 *
 * The pendingActions row is written before the bridge call and updated last on
 * both the success and rollback paths, so "no row left pending" is a good
 * signal that nothing is still queued.
 *
 * Best-effort on purpose: teardown is not the place to assert, and a test that
 * deliberately leaves a bridge call unresolved must not fail here. If the wait
 * times out the original race is simply still possible, exactly as before.
 */
export async function settleOptimistic(database: any, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let stillPending: number;
    try {
      stillPending = await database.pendingActions.where('status').equals('pending').count();
    } catch {
      return; // already closed, or no such table — nothing to wait for
    }
    if (stillPending === 0) {
      // Let the continuation that cleared the row run its remaining writes.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
