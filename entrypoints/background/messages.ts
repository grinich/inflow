import Dexie from 'dexie';
import {
  archiveConversation,
  unarchiveConversation,
  moveToOther,
  moveToFocused,
  moveToSpam,
  markConversationRead,
  markConversationUnread,
  deleteConversation,
  starConversation,
  unstarConversation,
  searchConversations,
} from './api/conversations';
import { fetchMessages, fetchAllMessages, sendMessage, editMessage, createConversation, reactWithEmoji, recallMessage } from './api/messages';
import { enqueueSend } from './send-queue';
import { searchTypeahead } from './api/typeahead';
import { getSession, getMemberUrn } from './auth/session';
import { syncConversations, syncCategory } from './sync/sync-engine';
import { burstDiscover, toggleSyncPause, broadcastProgress } from './sync/sync-coordinator';

import { backfillBatch } from './sync/sync-backfill';
import { fetchPost } from './api/posts';
import { prefetchSharedPosts, POST_CACHE_TTL } from './sync/prefetch-posts';
import { fetchInvitationsRaw, fetchSentInvitationsRaw, fetchConnectionsRaw, respondToInvitation, withdrawInvitation } from './api/relationships';
import { normalizeInvitations, normalizeSentInvitations, normalizeConnections, invitationPaging } from '@/lib/network-normalizer';
import { normalizeConversations, normalizeMessages, extractSentMessage } from '@/lib/voyager-normalizer';
import { applyPendingReceipts, consumePendingReceipts } from './realtime/pending-receipts';
import { planSseDedup, preserveSseFields, withoutRecalled } from '@/lib/message-dedup';
import { repairConversationParticipants } from './sync/repair-participants';
import { reconcileRecalledMessages } from './sync/reconcile-messages';
import { debugLog, getDebugLogs, clearDebugLogs } from '@/lib/debug-log';
import { getBackfillCutoff } from '@/lib/sync-settings';
import { db, mergeProfiles } from '@/db/database';
import { mergeConversation } from './sync/merge-conversation';
import { dbReady } from './db-ready';
import { runDiagnosticSync } from './diagnostic';
import { recordMarkRead, recordMutation } from './realtime/mark-read-suppression';
import { getSSEStatus } from './realtime/sse-client';
import { checkForUpdate } from './update-check';
import type { BridgeMessage, BridgeResponse } from '@/types/bridge';
import type { Invitation, SentInvitation } from '@/types/network';
import type { Profile } from '@/types/profile';

/**
 * Serialize a mutation (archive/move/read/star/delete/edit) on the same
 * per-conversation chain as sends. Category mutations used to run as
 * independent concurrent fetches, so archive + quick undo (UNARCHIVE) raced
 * and could land on LinkedIn out of order — leaving the server archived while
 * the UI showed unarchived (and the next poll re-archiving it).
 *
 * `record` starts the echo-suppression window immediately (guards merges while
 * the mutation waits in the chain) and again right before the API call.
 */
function enqueueMutation(
  conversationId: string,
  record: ((conversationId: string) => void) | null,
  fn: () => Promise<unknown>,
): Promise<unknown> {
  record?.(conversationId);
  return enqueueSend(conversationId, () => {
    record?.(conversationId);
    return fn();
  });
}

export function setupMessageRouter() {
  chrome.runtime.onMessage.addListener(
    (message: BridgeMessage, _sender, sendResponse: (response: BridgeResponse) => void) => {
      handleMessage(message).then(sendResponse).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // keep channel open for async
    }
  );
}

export async function handleMessage(msg: BridgeMessage): Promise<BridgeResponse> {
  // CHECK_AUTH must work before DB init (AuthGate calls it to determine the account).
  // All other handlers wait for the DB to be pointed at the correct account.
  if (msg.type !== 'CHECK_AUTH' && msg.type !== 'GET_DEBUG_LOGS' && msg.type !== 'GET_SSE_STATUS') {
    await dbReady;
    // dbReady can resolve while unauthenticated (no account → DB never opened).
    // Bail with a clean error instead of dereferencing a null db in the handlers.
    if (!db) {
      return { success: false, error: 'Not authenticated — database not initialized' };
    }
  }

  switch (msg.type) {
    case 'CHECK_AUTH': {
      const session = await getSession();
      return { success: true, data: session };
    }
    case 'GET_SSE_STATUS': {
      return { success: true, data: getSSEStatus() };
    }
    case 'SYNC_CONVERSATIONS': {
      await syncConversations();
      return { success: true };
    }
    case 'SYNC_CATEGORY': {
      await syncCategory(msg.category as any);
      return { success: true };
    }
    case 'FETCH_MESSAGES': {
      const memberUrn = await getMemberUrn();
      const existingCount = await db.messages
        .where('conversationId')
        .equals(msg.conversationId)
        .count();

      let hasAttachments = false;

      if (existingCount > 0) {
        // Already have messages — just fetch latest page (fast path)
        const rawPage = await fetchMessages(msg.conversationId, undefined, undefined, { skipJitter: true });
        const messages = normalizeMessages(rawPage, msg.conversationId);
        for (const m of messages) {
          if (m.senderUrn === memberUrn) m.isFromMe = true;
        }
        // Recalled tombstones are never stored (orphaned-separator bug) but
        // stay in `messages` so the reconcile below removes stored copies.
        const live = withoutRecalled(messages);
        // Re-fetched rows lack SSE-only fields (seenAt/reactions/editedAt) —
        // carry them over from the existing rows inside one transaction so a
        // concurrent SSE write can't land between the read and the put.
        // Receipts that arrived before these rows existed: apply AFTER the
        // preserve step (so a newer stored seenAt wins) and consume only once
        // the write commits.
        let appliedReceipts: string[] = [];
        await db.transaction('rw', db.messages, async () => {
          const existingRows = await db.messages.bulkGet(live.map((m) => m.id));
          preserveSseFields(live, existingRows);
          appliedReceipts = applyPendingReceipts(live);
          await db.messages.bulkPut(live);
        });
        consumePendingReceipts(appliedReceipts);
        if (live.some(m => m.attachments && m.attachments.length > 0)) hasAttachments = true;
        prefetchSharedPosts(live).catch(() => {});
        // Drop stored copies of messages this page no longer returned live
        // within its time range — messages recalled/unsent on LinkedIn.
        await reconcileRecalledMessages(msg.conversationId, messages);
        await repairConversationParticipants(msg.conversationId, rawPage.included || [], memberUrn);
      } else {
        // New conversation — fetch page by page, writing each to DB immediately
        // so useLiveQuery renders the first 20 messages without waiting for all pages.
        const MAX_PAGES = 10;
        const PAGE_SIZE = 20;
        for (let page = 0; page < MAX_PAGES; page++) {
          const rawPage = await fetchMessages(msg.conversationId, PAGE_SIZE, page * PAGE_SIZE, { skipJitter: page === 0 });
          const messages = withoutRecalled(normalizeMessages(rawPage, msg.conversationId));
          for (const m of messages) {
            if (m.senderUrn === memberUrn) m.isFromMe = true;
          }
          // Write immediately — UI updates via useLiveQuery after each page
          const appliedReceipts = applyPendingReceipts(messages);
          await db.messages.bulkPut(messages);
          consumePendingReceipts(appliedReceipts);
          if (messages.some(m => m.attachments && m.attachments.length > 0)) hasAttachments = true;
          prefetchSharedPosts(messages).catch(() => {});
          if (page === 0) {
            await repairConversationParticipants(msg.conversationId, rawPage.included || [], memberUrn);
          }

          const messageCount = (rawPage.included || []).filter(
            (e: any) => e.$type === 'com.linkedin.messenger.Message'
          ).length;
          if (messageCount === 0) break;
        }
      }

      // Clean up optimistic temp messages and SSE duplicates.
      // Preserve editedAt and reactions from SSE-delivered entries onto canonical
      // versions before deleting the duplicates. The Messenger API doesn't return
      // editedAt — it only comes via SSE Voyager events on the fsd_message entry.
      // Also clears optimistic temp- messages that have been confirmed sent.
      // Read + reconcile in one transaction (like backfill) so a concurrent
      // SSE/backfill write can't interleave between the read and the delete.
      await db.transaction('rw', db.messages, async () => {
        const allConvMessages = await db.messages
          .where('[conversationId+createdAt]')
          .between([msg.conversationId, Dexie.minKey], [msg.conversationId, Dexie.maxKey])
          .toArray();
        const plan = planSseDedup(allConvMessages, { includeSentTemps: true });
        if (plan.deleteIds.length === 0) return;
        for (const u of plan.updates) {
          await db.messages.update(u.id, u.updates);
        }
        await db.messages.bulkDelete(plan.deleteIds);
      });
      if (hasAttachments) {
        await db.conversations.update(msg.conversationId, { hasAttachments: 1 });
      }
      return { success: true };
    }
    case 'SEND_MESSAGE': {
      // Serialize per conversation (shared with the offline drainer) so a rapid
      // second message is delivered in order rather than racing/rejected.
      const response = await enqueueSend(msg.conversationId, () =>
        sendMessage(msg.conversationId, msg.body, msg.attachments, msg.replyTo),
      );
      // Opportunistic: the createMessage response usually carries the created
      // message entity — store the canonical row now (server timestamp, no
      // wait for the SSE echo) and retire the matching optimistic temp. When
      // the shape isn't recognized this is a no-op and the echo path handles it.
      const sent = extractSentMessage(response, msg.conversationId, await getMemberUrn());
      if (sent) {
        debugLog(
          'info',
          `[SEND] Stored canonical from response: ${sent.id.substring(0, 50)}... deliveredAt=${sent.createdAt}`
        );
        await db.transaction('rw', db.messages, async () => {
          // Retire at most ONE matching temp — the OLDEST, since rapid
          // same-body sends resolve in order (same rules as the SSE echo
          // cleanup: failed/queued temps have no server copy and must stay).
          const temps = (await db.messages
            .where('conversationId')
            .equals(msg.conversationId)
            .filter((m) =>
              m.id.startsWith('temp-') &&
              m.body === sent.body &&
              m.status !== 'failed' &&
              m.status !== 'queued'
            )
            .toArray()).sort((a, b) => a.createdAt - b.createdAt);
          if (temps.length > 0) await db.messages.delete(temps[0].id);
          await db.messages.put(sent);
        });
        await db.transaction('rw', db.conversations, async () => {
          const conv = await db.conversations.get(msg.conversationId);
          if (!conv) return;
          if (sent.createdAt > conv.lastActivityAt) {
            await db.conversations.update(msg.conversationId, {
              lastActivityAt: sent.createdAt,
              lastMessage: sent.body || conv.lastMessage,
            });
          } else if (conv.lastMessage === sent.body && conv.lastActivityAt > sent.createdAt) {
            // The preview already shows this send, so the newer local value is
            // the optimistic Date.now() stamp. Correct it DOWN to the server's
            // deliveredAt — a fast local clock would otherwise mask genuinely
            // new inbound messages from the freshness checks.
            await db.conversations.update(msg.conversationId, {
              lastActivityAt: sent.createdAt,
            });
          }
        });
      }
      return { success: true };
    }
    case 'ARCHIVE': {
      await enqueueMutation(msg.conversationId, recordMutation, () => archiveConversation(msg.conversationId));
      return { success: true };
    }
    case 'UNARCHIVE': {
      await enqueueMutation(msg.conversationId, recordMutation, () => unarchiveConversation(msg.conversationId));
      return { success: true };
    }
    case 'MOVE_TO_OTHER': {
      await enqueueMutation(msg.conversationId, recordMutation, () => moveToOther(msg.conversationId));
      return { success: true };
    }
    case 'MOVE_TO_FOCUSED': {
      await enqueueMutation(msg.conversationId, recordMutation, () => moveToFocused(msg.conversationId));
      return { success: true };
    }
    case 'MOVE_TO_SPAM': {
      await enqueueMutation(msg.conversationId, recordMutation, () => moveToSpam(msg.conversationId));
      return { success: true };
    }
    case 'MARK_READ': {
      debugLog('info', `[MUTATION] MARK_READ received for ${msg.conversationId.substring(0, 20)}... — dispatching to LinkedIn`);
      await enqueueMutation(msg.conversationId, recordMarkRead, () => markConversationRead(msg.conversationId));
      return { success: true };
    }
    case 'MARK_UNREAD': {
      debugLog('info', `[MUTATION] MARK_UNREAD received for ${msg.conversationId.substring(0, 20)}... — dispatching to LinkedIn`);
      await enqueueMutation(msg.conversationId, recordMutation, () => markConversationUnread(msg.conversationId));
      return { success: true };
    }
    case 'DELETE_CONVERSATION': {
      await enqueueMutation(msg.conversationId, null, () => deleteConversation(msg.conversationId));
      return { success: true };
    }
    case 'STAR': {
      await enqueueMutation(msg.conversationId, recordMutation, () => starConversation(msg.conversationId));
      return { success: true };
    }
    case 'UNSTAR': {
      await enqueueMutation(msg.conversationId, recordMutation, () => unstarConversation(msg.conversationId));
      return { success: true };
    }
    case 'EDIT_MESSAGE': {
      await enqueueMutation(msg.conversationId, null, async () => {
        await editMessage(msg.conversationId, msg.messageId, msg.body);
        // Update message in DB
        await db.messages.update(msg.messageId, { body: msg.body, editedAt: Date.now() });
      });
      return { success: true };
    }
    case 'REACT_EMOJI': {
      await enqueueMutation(msg.conversationId, null, () => reactWithEmoji(msg.messageId, msg.emoji));
      return { success: true };
    }
    case 'RECALL_MESSAGE': {
      await enqueueMutation(msg.conversationId, null, async () => {
        await recallMessage(msg.messageId);
        // Remove message from DB
        await db.messages.delete(msg.messageId);
      });
      return { success: true };
    }
    case 'TYPEAHEAD_SEARCH': {
      const results = await searchTypeahead(msg.query);
      return { success: true, data: results };
    }
    case 'FETCH_INVITATIONS': {
      const PAGE = 40;
      // 382 invitations already sits inside the old 10-page (400) cap, which
      // would have started silently truncating within a few weeks. This ceiling
      // is a runaway stop, not an expected limit — the walk normally ends on a
      // short page long before reaching it.
      const MAX_PAGES = 50;
      const invitations: Invitation[] = [];
      const profiles: Profile[] = [];
      const seenIds = new Set<string>();
      // Walk every page: the view has no load-more, so anything left unfetched
      // is permanently invisible to the user.
      let complete = false;
      let total: number | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        let raw: any;
        try {
          raw = await fetchInvitationsRaw(page * PAGE, PAGE);
        } catch (err) {
          // Keep what we already have. Ten-plus sequential Voyager calls will
          // occasionally trip a rate limit, and discarding several hundred
          // successfully fetched invitations over the last page is far worse
          // than storing a prefix. `complete` stays false, so we won't prune.
          debugLog('error', `FETCH_INVITATIONS stopped at page ${page}: ${String(err)}`);
          break;
        }
        const { invitations: batch, profiles: batchProfiles, rawCount } = normalizeInvitations(raw);
        total ??= invitationPaging(raw)?.total ?? null;
        // Guard against a server that ignores `start` and replays page 1 forever.
        const unseen = batch.filter((i) => !seenIds.has(i.id));
        for (const i of unseen) seenIds.add(i.id);
        invitations.push(...unseen);
        profiles.push(...batchProfiles);
        // `paging.total` is only ever trusted in the direction of fetching
        // MORE. This endpoint has been OBSERVED reporting `total` as the page
        // size (40) rather than the size of the full set: treating it as a
        // stop condition cost a 382-invitation account all but the first page,
        // because the walk stopped at 40, called itself complete, and the
        // prune deleted the other 342. It may only withhold the completeness
        // claim or extend the walk, never end it.
        const serverSaysMore = total !== null && invitations.length < total;
        // A page that repeats what we've already seen means the server is
        // ignoring `start`; we have to stop either way, but it is not proof
        // that we saw everything.
        if (unseen.length === 0) {
          complete = !serverSaysMore;
          break;
        }
        // Stop on the SERVER's page size, not the normalized count: a full page
        // where some entities failed to parse is not the end of the list.
        if (rawCount < PAGE && !serverSaysMore) {
          complete = true;
          break;
        }
      }
      // Only prune when we walked the COMPLETE server set. Pruning after a
      // partial read would delete valid invitations we simply didn't fetch.
      // We still never resurrect locally-acted-on ones.
      if (complete) {
        const serverIds = new Set(invitations.map((i) => i.id));
        const localPending = await db.invitations.where('status').equals('pending').toArray();
        const doomed = localPending.filter((i) => !serverIds.has(i.id)).map((i) => i.id);
        // Last line of defence. A walk that calls itself complete after
        // returning far less than we already had is the signature of a
        // truncation we failed to detect, not of an invitation list that
        // genuinely emptied out. Hundreds of rows disappearing is the worst
        // outcome here, so decline the inference and say so.
        const looksTruncated = doomed.length > 50 && invitations.length < localPending.length / 2;
        if (looksTruncated) {
          debugLog(
            'error',
            `FETCH_INVITATIONS declined to prune ${doomed.length} rows: fetched only ${invitations.length} but hold ${localPending.length}`
          );
        } else {
          await db.invitations.bulkDelete(doomed);
        }
      }
      const existing = await db.invitations.bulkGet(invitations.map((i) => i.id));
      const fresh = invitations.filter((_, i) => !existing[i] || existing[i]!.status === 'pending');
      await db.invitations.bulkPut(fresh);
      // These senders are often richer than the sparse profiles the Messenger
      // API returns, and they were previously discarded on every sync.
      await mergeProfiles(profiles);
      return { success: true, data: { count: invitations.length, complete } };
    }
    case 'ACCEPT_INVITATION':
    case 'IGNORE_INVITATION': {
      const inv = await db.invitations.get(msg.invitationId);
      if (!inv) return { success: false, error: 'Invitation not found' };
      const action: 'accept' | 'ignore' = msg.type === 'ACCEPT_INVITATION' ? 'accept' : 'ignore';
      await respondToInvitation(inv.id, inv.sharedSecret, action);
      await db.invitations.update(inv.id, { status: action === 'accept' ? 'accepted' : 'ignored' });
      return { success: true };
    }
    case 'FETCH_SENT_INVITATIONS': {
      // Same walk as FETCH_INVITATIONS, and for the same reasons: the tab has
      // no load-more, paging.total is only ever trusted in the direction of
      // fetching more, a failed page keeps what came before it, and pruning
      // needs a walk that proved it saw everything.
      const PAGE = 40;
      const MAX_PAGES = 50;
      const sent: SentInvitation[] = [];
      const profiles: Profile[] = [];
      const seenIds = new Set<string>();
      let complete = false;
      let total: number | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        let raw: any;
        try {
          raw = await fetchSentInvitationsRaw(page * PAGE, PAGE);
        } catch (err) {
          debugLog('error', `FETCH_SENT_INVITATIONS stopped at page ${page}: ${String(err)}`);
          break;
        }
        const { sent: batch, profiles: batchProfiles, rawCount } = normalizeSentInvitations(raw);
        total ??= invitationPaging(raw)?.total ?? null;
        const unseen = batch.filter((i) => !seenIds.has(i.id));
        for (const i of unseen) seenIds.add(i.id);
        sent.push(...unseen);
        profiles.push(...batchProfiles);
        const serverSaysMore = total !== null && sent.length < total;
        if (unseen.length === 0) {
          complete = !serverSaysMore;
          break;
        }
        if (rawCount < PAGE && !serverSaysMore) {
          complete = true;
          break;
        }
      }
      if (complete) {
        const serverIds = new Set(sent.map((i) => i.id));
        const localPending = await db.sentInvitations.where('status').equals('pending').toArray();
        const doomed = localPending.filter((i) => !serverIds.has(i.id)).map((i) => i.id);
        const looksTruncated = doomed.length > 50 && sent.length < localPending.length / 2;
        if (looksTruncated) {
          debugLog(
            'error',
            `FETCH_SENT_INVITATIONS declined to prune ${doomed.length} rows: fetched only ${sent.length} but hold ${localPending.length}`
          );
        } else {
          await db.sentInvitations.bulkDelete(doomed);
        }
      }
      const existing = await db.sentInvitations.bulkGet(sent.map((i) => i.id));
      const fresh = sent.filter((_, i) => !existing[i] || existing[i]!.status === 'pending');
      await db.sentInvitations.bulkPut(fresh);
      await mergeProfiles(profiles);
      return { success: true, data: { count: sent.length, complete } };
    }
    case 'WITHDRAW_INVITATION': {
      const inv = await db.sentInvitations.get(msg.invitationId);
      if (!inv) return { success: false, error: 'Sent invitation not found' };
      await withdrawInvitation(inv.id, inv.sharedSecret);
      await db.sentInvitations.update(inv.id, { status: 'withdrawn' });
      return { success: true };
    }
    case 'FETCH_CONNECTIONS': {
      const PAGE = 40;
      const raw = await fetchConnectionsRaw(msg.start ?? 0, PAGE);
      const { connections, profiles } = normalizeConnections(raw);
      await db.connections.bulkPut(connections);
      await mergeProfiles(profiles);
      return { success: true, data: { fetched: connections.length, hasMore: connections.length === PAGE } };
    }
    case 'CREATE_CONVERSATION': {
      const result = await createConversation(msg.recipientUrns, msg.body, msg.attachments);
      // LinkedIn REUSES the conversation id when messaging a person whose
      // thread was deleted — the thread is live again, so a leftover delete
      // tombstone must not keep blocking sync from re-inserting it.
      await db.tombstones.delete(result.conversationId).catch(() => {});
      return { success: true, data: result };
    }
    case 'CHECK_FOR_UPDATE': {
      const status = await checkForUpdate();
      return { success: true, data: status };
    }
    case 'GET_DEBUG_LOGS': {
      return { success: true, data: getDebugLogs() };
    }
    case 'CLEAR_DEBUG_LOGS': {
      clearDebugLogs();
      return { success: true };
    }
    case 'RESET_DB': {
      // Clear all tables (safer than db.delete() which can break the Dexie instance)
      await db.transaction('rw', [db.conversations, db.messages, db.profiles, db.pendingActions, db.imageCache, db.postCache, db.syncState, db.syncQueue, db.draftAttachments, db.tombstones, db.invitations, db.sentInvitations, db.connections], async () => {
        await db.conversations.clear();
        await db.messages.clear();
        await db.profiles.clear();
        await db.pendingActions.clear();
        await db.imageCache.clear();
        await db.postCache.clear();
        await db.syncState.clear();
        await db.syncQueue.clear();
        await db.draftAttachments.clear();
        await db.tombstones.clear();
        await db.invitations.clear();
        await db.sentInvitations.clear();
        await db.connections.clear();
      });
      clearDebugLogs();
      await syncConversations();
      return { success: true };
    }
    case 'DIAGNOSTIC_SYNC': {
      const report = await runDiagnosticSync();
      return { success: true, data: report };
    }
    case 'GET_SYNC_PROGRESS': {
      const states = await db.syncState.toArray();
      const queue = await db.syncQueue.toArray();
      const pending = queue.filter(q => q.status === 'pending').length;
      const syncing = queue.filter(q => q.status === 'syncing').length;
      const done = queue.filter(q => q.status === 'done').length;
      const failed = queue.filter(q => q.status === 'failed').length;

      const categories: Record<string, { phase: string; totalDiscovered: number }> = {};
      for (const s of states) {
        categories[s.category] = { phase: s.phase, totalDiscovered: s.totalDiscovered };
      }

      return {
        success: true,
        data: {
          categories,
          queue: { pending, syncing, done, failed, total: queue.length },
        },
      };
    }
    case 'RESET_SYNC_STATE': {
      await db.transaction('rw', [db.syncState, db.syncQueue], async () => {
        await db.syncState.clear();
        await db.syncQueue.clear();
      });
      debugLog('info', 'Sync state reset — will re-discover on next tick');
      return { success: true };
    }
    case 'BURST_DISCOVER': {
      // Fire-and-forget: don't block the response on discovery completing
      burstDiscover(msg.category as any).catch((err) => {
        debugLog('error', `Burst discover failed for ${msg.category}: ${err}`);
      });
      return { success: true };
    }
    case 'FETCH_POST': {
      // Check cache first — but only serve entries within the TTL. A stale row
      // (or stale not-found sentinel) falls through to a refetch, matching the
      // prefetch path's policy; serving it forever meant edited/deleted posts
      // never refreshed and a transient fetch failure was cached permanently.
      const cached = await db.postCache.get(msg.activityUrn);
      if (cached && Date.now() - cached.cachedAt < POST_CACHE_TTL) {
        // Return null for "not found" sentinels (empty authorName + text)
        const data = (cached.authorName || cached.text) ? cached : null;
        return { success: true, data };
      }
      const post = await fetchPost(msg.activityUrn);
      if (post) {
        await db.postCache.put({ urn: msg.activityUrn, ...post, cachedAt: Date.now() }).catch(() => {});
      } else {
        // Cache "not found" sentinel to prevent infinite retries
        await db.postCache.put({
          urn: msg.activityUrn,
          authorName: '', authorHeadline: '', authorPicture: '',
          text: '', imageUrl: '', activityUrl: '',
          cachedAt: Date.now(),
        }).catch(() => {});
      }
      return { success: true, data: post };
    }
    case 'SEARCH_CONVERSATIONS': {
      const memberUrn = await getMemberUrn();
      const { response: rawData, nextCursor } = await searchConversations(msg.query, msg.cursor || null);
      const { conversations, profiles } = normalizeConversations(rawData, memberUrn);

      // Diagnostic: settle whether LinkedIn's search entities are sparse
      // (missing categories/unreadCount). Sparse fields are already guarded by
      // the merge (kept as "unknown"), this only makes it visible in the logs.
      const sparse = conversations.filter(
        (c) => c.category === undefined || c.read === undefined
      ).length;
      debugLog(
        'info',
        `[SEARCH] ${conversations.length} result(s)${sparse > 0 ? ` — ${sparse} sparse (categories/unreadCount omitted; merge-guarded)` : ' — all carry full category/read fields'}`
      );

      // Store in IndexedDB using shared merge logic
      if (conversations.length > 0 || profiles.length > 0) {
        await db.transaction('rw', [db.conversations, db.profiles, db.pendingActions, db.tombstones], async () => {
          await mergeProfiles(profiles);
          for (const conv of conversations) {
            await mergeConversation(conv);
          }
        });
      }

      return {
        success: true,
        data: { conversationIds: conversations.map(c => c.id), nextCursor },
      };
    }
    case 'TOGGLE_SYNC_PAUSE': {
      const paused = toggleSyncPause();
      return { success: true, data: { paused } };
    }
    case 'PREFETCH_MESSAGES': {
      // Fire-and-forget: respond immediately, process sequentially to avoid
      // flooding the API and starving on-demand message loads.
      (async () => {
        const memberUrn = await getMemberUrn();
        for (const convId of msg.conversationIds) {
          try {
            // Skip archived/spam conversations — no point prefetching for hidden items
            const convRecord = await db.conversations.get(convId);
            if (convRecord?.archived === 1 || convRecord?.category === 'SPAM') continue;

            const existingCount = await db.messages
              .where('conversationId')
              .equals(convId)
              .count();
            if (existingCount > 0) continue;

            const pages = await fetchAllMessages(convId);
            let hasAttachments = false;
            // Server-clock watermark for messagesSyncedAt (see SyncQueueItem).
            let maxCreatedAt = 0;
            for (const rawPage of pages) {
              const messages = withoutRecalled(normalizeMessages(rawPage, convId));
              for (const m of messages) {
                if (m.senderUrn === memberUrn) m.isFromMe = true;
                if (m.createdAt > maxCreatedAt) maxCreatedAt = m.createdAt;
              }
              await db.messages.bulkPut(messages);
              if (messages.some(m => m.attachments && m.attachments.length > 0)) {
                hasAttachments = true;
              }
              prefetchSharedPosts(messages).catch(() => {});
            }
            if (hasAttachments) {
              await db.conversations.update(convId, { hasAttachments: 1 });
            }
            const syncedThrough =
              Math.max(maxCreatedAt, convRecord?.lastActivityAt ?? 0) || Date.now();
            await db.syncQueue
              .where('conversationId')
              .equals(convId)
              .modify({ messagesSyncedAt: syncedThrough, status: 'done' });
            debugLog('info', `[PREFETCH] Prefetched messages for ${convId}`);
          } catch (err) {
            debugLog('error', `[PREFETCH] Failed for ${convId}: ${err}`);
          }
        }
      })().catch((err) => {
        debugLog('error', `[PREFETCH] Batch failed: ${err}`);
      });
      return { success: true };
    }
    case 'REEVAL_BACKFILL_WINDOW': {
      const cutoff = await getBackfillCutoff();
      let promoted = 0;
      let demoted = 0;

      await db.transaction('rw', db.syncQueue, async () => {
        const all = await db.syncQueue.toArray();
        for (const item of all) {
          const tooOld = cutoff > 0 && item.lastActivityAt < cutoff;
          if (tooOld && item.status === 'pending') {
            // Window shortened — this item is now outside the window
            await db.syncQueue.update(item.conversationId, { status: 'done' });
            demoted++;
          } else if (!tooOld && item.status === 'done' && item.messagesSyncedAt === 0) {
            // Window extended — this item was skipped but now falls within the window
            await db.syncQueue.update(item.conversationId, { status: 'pending' });
            promoted++;
          }
        }
      });

      debugLog('info', `[BACKFILL] Re-evaluated queue: promoted=${promoted}, demoted=${demoted}`);

      // Broadcast fresh progress so the UI shows the new pending count immediately
      const emitProgress = async () => {
        const states = await db.syncState.toArray();
        broadcastProgress(new Map(states.map((s) => [s.category, s])));
      };
      await emitProgress();

      // Kick off immediate backfill for promoted items (fire-and-forget)
      if (promoted > 0) {
        backfillBatch(promoted, emitProgress).catch((err) => {
          debugLog('error', `[BACKFILL] Immediate backfill after reeval failed: ${err}`);
        });
      }

      return { success: true, data: { promoted, demoted } };
    }
    default:
      return { success: false, error: 'Unknown message type' };
  }
}
