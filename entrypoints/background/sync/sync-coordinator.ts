import { type InboxCategory } from '../api/conversations';
import { syncConversations } from './sync-engine';
import { discoverPage, enqueueConversations } from './sync-discovery';
import { backfillBatch, recoverStuckItems } from './sync-backfill';
import { sweepDeletedConversations } from './sweep-deleted';
import { isRealtimeConnected } from '../realtime/sse-client';
import { drainActionQueue } from '../action-queue';
import { debugLog } from '@/lib/debug-log';
import { networkErrorLevel } from '@/lib/transient-error';
import { db, getDbGeneration, type SyncState } from '@/db/database';
import type { Conversation } from '@/types/conversation';

const ALARM_NAME = 'inflow-sync';
const POLL_INTERVAL_MINUTES = 0.5; // 30 seconds
const STALENESS_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
const BACKFILL_BATCH_SIZE = 10;
const BURST_MAX_PAGES = 5;
/**
 * Max discovery pages per tick (across all categories). Discovery used to
 * exhaust every category in a single tick — with 1.5–3s inter-page delays a
 * large mailbox monopolized the coordinator for hours while `_tickRunning`
 * blocked every subsequent tick, including the quick poll that reconciles
 * cross-device read state. Cursors are saved per page, so the next tick
 * resumes where this one stopped.
 */
const MAX_DISCOVERY_PAGES_PER_TICK = 20;
/**
 * Even while SSE is connected, run the quick poll at least this often. Realtime
 * events don't reliably carry cross-device read-state changes (a thread read on
 * another device), so without a periodic reconciliation poll such conversations
 * would stay unread in the UI indefinitely.
 */
const RECONCILE_POLL_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

/** Categories currently being discovered — prevents concurrent discovery for the same category. */
const _discoveringCategories = new Set<string>();

/** Random delay between discovery pages to look more human (1.5–3s). */
function discoveryDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, 1500 + Math.random() * 1500));
}

const CATEGORIES: InboxCategory[] = [
  'PRIMARY_INBOX',
  'SECONDARY_INBOX',
  'ARCHIVE',
  'SPAM',
];

/** In-memory pause flag — not persisted across service worker restarts. */
let paused = false;

/** Timestamp of the last quick poll, used to throttle the reconciliation poll
 *  that runs even while SSE is connected. */
let _lastQuickPollAt = 0;

export function toggleSyncPause(): boolean {
  paused = !paused;
  debugLog('info', `[COORDINATOR] Sync ${paused ? 'paused' : 'resumed'}`);
  return paused;
}

/**
 * Set up the alarm-driven sync coordinator.
 * Replaces the old poller's direct syncConversations() approach.
 */
export function setupSyncCoordinator() {
  // Run initial tick on service worker startup — only if a DB is open. On an
  // unauthenticated start `db` is null until switchDatabase() runs, and calling
  // db.open() on null throws synchronously, aborting realtime + queue startup.
  if (db) {
    db.open()
      .then(() => recoverStuckItems())
      .then(() => onSyncTick())
      .catch((err) => {
        debugLog(networkErrorLevel(err), `Initial sync tick failed: ${err}`);
      });
  }

  // Set up recurring alarm
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: POLL_INTERVAL_MINUTES,
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      onSyncTick().catch((err) => {
        debugLog(networkErrorLevel(err), `Sync tick failed: ${err}`);
      });
    }
  });
}

/**
 * Single tick of the sync engine. Called every 30 seconds.
 * Does a bounded unit of work, then yields.
 *
 * Priority:
 * 1. Quick poll — fetch Focused conversations (metadata only, fast)
 * 2. Enqueue + immediate backfill — picks up newly-pending items
 * 3. Discovery — paginate one page of a discovering category
 * 4. Second backfill pass — picks up items from discovery
 * 5. Staleness — re-discover categories not checked in 15 min
 */
let _tickRunning = false;
/** DB generation for which recoverStuckItems has already run. Startup covers
 *  the initial generation; a login/account switch after startup bumps the
 *  generation, and the next tick recovers the new DB's stuck 'syncing' rows
 *  (which would otherwise stay stuck until some future SW restart). */
let _recoveredGeneration = -1;
async function onSyncTick(): Promise<void> {
  if (!db) return; // unauthenticated — no DB open yet; a later alarm tick retries once it is
  if (_tickRunning) return; // a previous tick is still running — don't overlap on the next alarm
  _tickRunning = true;
  try {
    await _onSyncTickInner();
  } finally {
    _tickRunning = false;
  }
}
async function _onSyncTickInner(): Promise<void> {
  if (paused) {
    debugLog('info', '[COORDINATOR] Tick skipped (paused)');
    return;
  }
  debugLog('info', '[COORDINATOR] Tick started');

  // Recover items stuck in 'syncing' for a DB we haven't recovered yet
  // (first tick after startup, or after an account switch).
  const currentGen = getDbGeneration();
  if (currentGen !== _recoveredGeneration) {
    await recoverStuckItems().catch((err) => {
      debugLog(networkErrorLevel(err), `[COORDINATOR] Stuck-item recovery failed: ${err}`);
    });
    _recoveredGeneration = currentGen;
  }

  // Drain any queued offline actions before syncing
  await drainActionQueue().catch((err) => {
    debugLog(networkErrorLevel(err), `[COORDINATOR] Action queue drain failed: ${err}`);
  });

  // Ensure sync state is initialized
  await ensureSyncStateInitialized();

  // 1. Quick poll: sync Focused inbox (metadata only — no message fetching).
  //    When SSE is connected, realtime events handle new messages, so normally
  //    we skip the poll. But realtime doesn't reliably deliver cross-device
  //    read-state changes, so still poll periodically to reconcile (otherwise a
  //    thread read on another device stays unread here forever).
  //    Discovery and backfill steps still run since SSE only delivers new events.
  const reconcileDue = Date.now() - _lastQuickPollAt > RECONCILE_POLL_INTERVAL_MS;
  if (isRealtimeConnected() && !reconcileDue) {
    debugLog('info', '[COORDINATOR] SSE connected — skipping quick poll');
  } else {
    try {
      await syncConversations();
      _lastQuickPollAt = Date.now();

      // Enqueue all focused conversations currently in the DB so that
      // the sync queue stays consistent with what the UI shows.
      const focusedConvs = await db.conversations
        .where('category')
        .anyOf(['PRIMARY_INBOX', 'INBOX'])
        .toArray();
      // Also grab conversations with no category (old data)
      const noCatConvs = await db.conversations
        .filter((c: Conversation) => !c.category)
        .toArray();
      const allFocused = [...focusedConvs, ...noCatConvs];

      if (allFocused.length > 0) {
        await enqueueConversations(allFocused, 'PRIMARY_INBOX');
      }
    } catch (err) {
      debugLog(networkErrorLevel(err), `[COORDINATOR] Quick poll failed: ${err}`);
    }
  }

  // Helper: broadcast fresh progress from current DB state
  const emitProgress = async () => {
    await emitSyncProgress();
  };

  // 2. Immediate backfill: pick up newly-pending items from the quick poll
  const postPollPending = await db.syncQueue
    .where('status')
    .equals('pending')
    .count();

  if (postPollPending > 0) {
    try {
      const completed = await backfillBatch(BACKFILL_BATCH_SIZE, emitProgress);
      debugLog(
        'info',
        `[COORDINATOR] Post-poll backfill: ${completed} conversations (${postPollPending - completed} remaining)`
      );
    } catch (err) {
      debugLog(networkErrorLevel(err), `[COORDINATOR] Post-poll backfill failed: ${err}`);
    }
  }

  // 3. Discovery: process a bounded number of pages across discovering
  //    categories, then yield. Cursors persist per page, so the next tick
  //    resumes — the quick poll and backfill are never starved by a large
  //    initial sync.
  await runDiscoveryRound();

  // 4. Second backfill pass: pick up items enqueued by discovery
  const pendingCount = await db.syncQueue
    .where('status')
    .equals('pending')
    .count();

  if (pendingCount > 0) {
    try {
      const completed = await backfillBatch(BACKFILL_BATCH_SIZE, emitProgress);
      debugLog(
        'info',
        `[COORDINATOR] Backfilled ${completed} conversations (${pendingCount - completed} remaining)`
      );
    } catch (err) {
      debugLog(networkErrorLevel(err), `[COORDINATOR] Backfill failed: ${err}`);
    }
  }

  // Check per-category completion: if a category is done discovering and
  // all its queue items are backfilled, mark it complete individually.
  const updatedStates = await db.syncState.toArray();
  for (const state of updatedStates) {
    if (state.phase === 'backfilling') {
      const categoryPending = await db.syncQueue
        .where('status')
        .anyOf(['pending', 'syncing'])
        .filter((q) => q.category === state.category)
        .count();
      if (categoryPending === 0) {
        await db.syncState.update(state.category, {
          phase: 'complete',
          lastSyncCompletedAt: Date.now(),
        });
        debugLog('info', `[COORDINATOR] ${state.category} fully synced`);
      }
    }
  }

  // 5. Staleness check: re-discover categories not checked in 15 min
  const now = Date.now();
  const freshStates = await db.syncState.toArray();
  const freshStateMap = new Map(freshStates.map((s) => [s.category, s]));
  for (const cat of CATEGORIES) {
    const state = freshStateMap.get(cat);
    if (
      state &&
      state.phase === 'complete' &&
      state.discoveryCompletedAt > 0 &&
      now - state.discoveryCompletedAt > STALENESS_THRESHOLD_MS
    ) {
      debugLog(
        'info',
        `[COORDINATOR] Re-discovering ${cat} (stale: ${Math.round((now - state.discoveryCompletedAt) / 1000 / 60)}m old)`
      );
      await db.syncState.update(cat, {
        phase: 'discovering',
        cursor: '',
        totalDiscovered: 0,
        lastSyncStartedAt: now,
      });
      // Keep the in-memory snapshot in sync so the broadcast below reflects the
      // just-triggered re-discovery (and totalDiscovered doesn't inflate over cycles).
      freshStateMap.set(cat, { ...state, phase: 'discovering', cursor: '', totalDiscovered: 0, lastSyncStartedAt: now });
      break; // Only re-discover one category per tick
    }
  }

  broadcastProgress(freshStateMap);
}

/**
 * One bounded round of discovery: paginate discovering categories, at most
 * `maxPages` pages in total, saving the cursor after every page. When a
 * category reaches its genuine last page it transitions to 'backfilling' and
 * the deletion sweep runs for it (a fully-paginated discovery is the only
 * point where "the server no longer returns this conversation" is knowable).
 *
 * Exported for tests; the tick calls it with defaults.
 */
export async function runDiscoveryRound(
  maxPages: number = MAX_DISCOVERY_PAGES_PER_TICK,
  delay: () => Promise<void> = discoveryDelay
): Promise<void> {
  const allStates = await db.syncState.toArray();
  const stateMap = new Map(allStates.map((s) => [s.category, s]));
  let pagesThisRound = 0;

  for (const cat of CATEGORIES) {
    const state = stateMap.get(cat);
    if (!state || state.phase !== 'discovering') continue;
    if (paused || pagesThisRound >= maxPages) break;
    if (_discoveringCategories.has(cat)) {
      debugLog('info', `[COORDINATOR] Skipping ${cat} — discovery already in progress`);
      continue;
    }

    _discoveringCategories.add(cat);
    let cursor: string | null = state.cursor || null;
    let totalDiscovered = state.totalDiscovered;

    debugLog('info', `[COORDINATOR] Discovery round started for ${cat}`);

    try {
      const gen = getDbGeneration();
      while (!paused && pagesThisRound < maxPages) {
        if (getDbGeneration() !== gen) return; // account switched mid-discovery — don't write into the new DB
        const { conversations, isLastPage, nextCursor } = await discoverPage(cat, cursor);
        // Re-check after the network await — switchDatabase may have completed
        // mid-fetch, and `db` now points at the new account's database.
        if (getDbGeneration() !== gen) return;
        await enqueueConversations(conversations, cat);
        totalDiscovered += conversations.length;
        pagesThisRound++;

        // Stop when the server says it's done, OR when the cursor stops
        // advancing. `isLastPage` is just `!nextCursor`, so a stuck-cursor tail
        // would otherwise loop forever hammering the API.
        if (isLastPage || nextCursor === cursor) {
          if (!isLastPage) {
            debugLog('warn', `[COORDINATOR] Discovery for ${cat} stopped early (cursor not advancing)`);
          }
          await db.syncState.update(cat, {
            phase: 'backfilling',
            cursor: '',
            totalDiscovered,
            discoveryCompletedAt: Date.now(),
          });
          debugLog('info', `[COORDINATOR] Discovery complete for ${cat}: ${totalDiscovered} conversations`);
          // Only a genuinely complete pagination proves absence — a stuck
          // cursor doesn't, so no sweep in that case.
          if (isLastPage) {
            await sweepDeletedConversations(cat, state.lastSyncStartedAt).catch((err) => {
              debugLog(networkErrorLevel(err), `[COORDINATOR] Deletion sweep failed for ${cat}: ${err}`);
            });
          }
          break;
        }

        // Save cursor after each page so we can resume if interrupted
        cursor = nextCursor;
        await db.syncState.update(cat, {
          cursor: cursor || '',
          totalDiscovered,
        });

        // Broadcast progress so UI updates during discovery
        await emitSyncProgress();

        await delay();
      }
    } catch (err) {
      // Offline/timeout mid-round is routine — the cursor is saved per page,
      // so the next tick resumes where this one stopped.
      debugLog(networkErrorLevel(err), `[COORDINATOR] Discovery failed for ${cat}: ${err}`);
    } finally {
      _discoveringCategories.delete(cat);
    }
  }
}

/**
 * Burst-discover a category immediately.
 * Called when the UI switches to a non-Focused tab to populate it quickly.
 *
 * Paginates through up to BURST_MAX_PAGES pages rapidly, storing each page
 * to IndexedDB as it arrives so the UI updates progressively.
 */
export async function burstDiscover(
  category: InboxCategory,
  maxPages = BURST_MAX_PAGES
): Promise<void> {
  if (_discoveringCategories.has(category)) {
    debugLog('info', `[COORDINATOR] Burst skipped for ${category} — discovery already in progress`);
    return;
  }

  _discoveringCategories.add(category);
  debugLog('info', `[COORDINATOR] Burst discovery started for ${category}`);

  const gen = getDbGeneration();
  const state = await db.syncState.get(category);
  if (!state) {
    _discoveringCategories.delete(category);
    debugLog('warn', `[COORDINATOR] No sync state for ${category}, skipping burst`);
    return;
  }

  // If already complete or backfilling with recent data, only discover if stale
  if (state.phase === 'complete' || state.phase === 'backfilling') {
    const age = Date.now() - state.discoveryCompletedAt;
    if (age < STALENESS_THRESHOLD_MS) {
      _discoveringCategories.delete(category);
      debugLog('info', `[COORDINATOR] ${category} is fresh (${Math.round(age / 1000)}s old), skipping burst`);
      return;
    }
    // Mark as discovering so the loading indicator shows
    await db.syncState.update(category, {
      phase: 'discovering',
      cursor: '',
      totalDiscovered: 0,
      lastSyncStartedAt: Date.now(),
    });
  }

  let cursor: string | null = state.phase === 'discovering' && state.cursor ? state.cursor : null;
  let totalDiscovered = state.phase === 'discovering' ? state.totalDiscovered : 0;

  try {
    for (let page = 0; page < maxPages; page++) {
      const { conversations, isLastPage, nextCursor } = await discoverPage(category, cursor);
      // Account switched during the network await — `db` now points at the new
      // account's database; bail before writing anything into it.
      if (getDbGeneration() !== gen) return;
      await enqueueConversations(conversations, category);
      totalDiscovered += conversations.length;

      if (isLastPage) {
        await db.syncState.update(category, {
          phase: 'backfilling',
          cursor: '',
          totalDiscovered,
          discoveryCompletedAt: Date.now(),
        });
        debugLog('info', `[COORDINATOR] Burst discovery complete for ${category}: ${totalDiscovered} conversations in ${page + 1} pages`);
        // Full pagination reached — safe point to sweep server-deleted rows.
        const startedAt = (await db.syncState.get(category))?.lastSyncStartedAt ?? state.lastSyncStartedAt;
        await sweepDeletedConversations(category, startedAt).catch((err) => {
          debugLog(networkErrorLevel(err), `[COORDINATOR] Deletion sweep failed for ${category}: ${err}`);
        });
        break;
      }

      // Save progress after each page
      cursor = nextCursor;
      await db.syncState.update(category, {
        cursor: cursor || '',
        totalDiscovered,
      });

      // Small delay between pages to avoid rate limiting
      if (page < maxPages - 1) {
        await discoveryDelay();
      }
    }

    // If we hit maxPages without finishing, leave as discovering with cursor saved
    const currentState = await db.syncState.get(category);
    if (currentState?.phase === 'discovering') {
      debugLog('info', `[COORDINATOR] Burst discovery paused for ${category} at ${totalDiscovered} conversations (hit page limit)`);
    }
  } catch (err) {
    debugLog(networkErrorLevel(err), `[COORDINATOR] Burst discovery failed for ${category}: ${err}`);
  } finally {
    _discoveringCategories.delete(category);
  }

  // Run a backfill pass for any newly-discovered items
  const pending = await db.syncQueue.where('status').equals('pending').count();
  if (pending > 0) {
    try {
      const emitProgress = async () => {
        await emitSyncProgress();
      };
      await backfillBatch(BACKFILL_BATCH_SIZE, emitProgress);
    } catch (err) {
      debugLog(networkErrorLevel(err), `[COORDINATOR] Burst post-backfill failed: ${err}`);
    }
  }
}

/**
 * Ensure every category has a sync-state row, creating missing ones in the
 * 'discovering' phase. Per-category (not all-or-nothing): a category added in
 * a later version — or a partially-initialized table — must still get a row,
 * otherwise it is never discovered. Existing rows are left untouched.
 *
 * Exported for tests; the tick calls it every cycle (cheap no-op when all
 * rows exist).
 */
export async function ensureSyncStateInitialized(): Promise<void> {
  const now = Date.now();
  for (const category of CATEGORIES) {
    const existing = await db.syncState.get(category);
    if (existing) continue;
    debugLog('info', `[COORDINATOR] Initializing sync state for ${category}`);
    await db.syncState.put({
      category,
      phase: 'discovering',
      cursor: '',
      totalDiscovered: 0,
      discoveryCompletedAt: 0,
      lastSyncStartedAt: now,
      lastSyncCompletedAt: 0,
    });
  }
}

/**
 * Broadcast sync progress to any open tabs.
 */
/** Read the latest sync state from the DB and broadcast it to the UI. */
async function emitSyncProgress(): Promise<void> {
  const states = await db.syncState.toArray();
  broadcastProgress(new Map(states.map((s) => [s.category, s])));
}

export function broadcastProgress(
  stateMap: Map<string, SyncState>
): void {
  db.syncQueue
    .toArray()
    .then((queue) => {
      const pending = queue.filter((q) => q.status === 'pending').length;
      const syncing = queue.filter((q) => q.status === 'syncing').length;
      const done = queue.filter((q) => q.status === 'done').length;
      const failed = queue.filter((q) => q.status === 'failed').length;
      const total = queue.length;

      const categories: Record<
        string,
        { phase: string; totalDiscovered: number }
      > = {};
      for (const [cat, state] of stateMap) {
        categories[cat] = {
          phase: state.phase,
          totalDiscovered: state.totalDiscovered,
        };
      }

      chrome.runtime
        .sendMessage({
          type: 'SYNC_PROGRESS',
          progress: {
            categories,
            queue: { pending, syncing, done, failed, total },
          },
        })
        .catch(() => {});
    })
    .catch(() => {});
}
