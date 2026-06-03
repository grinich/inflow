/**
 * Serializes sends per conversation so a rapid second message queues behind the
 * first (delivered in order) instead of racing it. Shared by the live
 * SEND_MESSAGE handler (messages.ts) and the offline action-queue drainer, so an
 * offline drain and a fresh live send to the same conversation can't run
 * concurrently. Entries are dropped once drained, so the map can't grow unbounded.
 */
const _chains = new Map<string, Promise<unknown>>();

export function enqueueSend<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
  const prev = _chains.get(conversationId) ?? Promise.resolve();
  // Chain after the previous send regardless of its outcome (a failed send must
  // not block the next one).
  const run = prev.then(fn, fn);
  _chains.set(conversationId, run);
  const cleanup = () => {
    if (_chains.get(conversationId) === run) _chains.delete(conversationId);
  };
  run.then(cleanup, cleanup);
  return run;
}
