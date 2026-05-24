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
import { fetchMessages, fetchAllMessages, sendMessage, editMessage, createConversation } from './api/messages';
import { searchTypeahead } from './api/typeahead';
import { fetchProfileByUrn } from './api/profiles';
import { getSession, getMemberUrn } from './auth/session';
import { syncConversations, syncCategory } from './sync/sync-engine';
import { burstDiscover, toggleSyncPause, broadcastProgress } from './sync/sync-coordinator';

import { backfillBatch } from './sync/sync-backfill';
import { fetchPost } from './api/posts';
import { prefetchSharedPosts } from './sync/prefetch-posts';
import { normalizeConversations, normalizeMessages } from '@/lib/voyager-normalizer';
import { debugLog, getDebugLogs, clearDebugLogs } from '@/lib/debug-log';
import { getBackfillCutoff } from '@/lib/sync-settings';
import { db, mergeProfiles } from '@/db/database';
import { linkedInVariables, raw } from './api/encode';
import { voyagerFetch } from './api/client';
import type { BridgeMessage, BridgeResponse } from '@/types/bridge';

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

async function handleMessage(msg: BridgeMessage): Promise<BridgeResponse> {
  switch (msg.type) {
    case 'CHECK_AUTH': {
      const session = await getSession();
      return { success: true, data: session };
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
      // Check if we already have messages for this conversation — if so, just fetch latest page
      const existingCount = await db.messages
        .where('conversationId')
        .equals(msg.conversationId)
        .count();
      const pages = existingCount > 0
        ? [await fetchMessages(msg.conversationId)]
        : await fetchAllMessages(msg.conversationId);

      let hasAttachments = false;
      for (const rawPage of pages) {
        const messages = normalizeMessages(rawPage, msg.conversationId);
        for (const m of messages) {
          if (m.senderUrn === memberUrn) m.isFromMe = true;
        }
        await db.messages.bulkPut(messages);
        if (messages.some(m => m.attachments && m.attachments.length > 0)) {
          hasAttachments = true;
        }
        // Pre-fetch shared posts in background (non-blocking)
        prefetchSharedPosts(messages).catch(() => {});
      }
      // Clean up optimistic temp messages and SSE duplicates now that
      // canonical messages (urn:li:msg_message:...) are stored.
      // Only delete SSE messages that have a matching canonical replacement
      // (same body + sender). SSE messages without a canonical match are
      // newer than what the API returned — keep them until next sync.
      const allConvMessages = await db.messages
        .where('[conversationId+createdAt]')
        .between([msg.conversationId, Dexie.minKey], [msg.conversationId, Dexie.maxKey])
        .toArray();
      const canonicalKeys = new Set<string>();
      for (const m of allConvMessages) {
        if (m.id.startsWith('urn:li:msg_message:')) {
          canonicalKeys.add(`${m.body}|${m.senderUrn}`);
        }
      }
      const staleMessages = allConvMessages.filter((m) =>
        (m.id.startsWith('temp-') && m.status === 'sent') ||
        ((m.id.startsWith('urn:li:fsd_message:') || m.id.startsWith('urn:li:fs_event:')) &&
          canonicalKeys.has(`${m.body}|${m.senderUrn}`))
      );
      if (staleMessages.length > 0) {
        await db.messages.bulkDelete(staleMessages.map((m) => m.id));
      }
      if (hasAttachments) {
        await db.conversations.update(msg.conversationId, { hasAttachments: 1 });
      }
      return { success: true };
    }
    case 'SEND_MESSAGE': {
      await sendMessage(msg.conversationId, msg.body, msg.attachments);
      return { success: true };
    }
    case 'ARCHIVE': {
      await archiveConversation(msg.conversationId);
      return { success: true };
    }
    case 'UNARCHIVE': {
      await unarchiveConversation(msg.conversationId);
      return { success: true };
    }
    case 'MOVE_TO_OTHER': {
      await moveToOther(msg.conversationId);
      return { success: true };
    }
    case 'MOVE_TO_FOCUSED': {
      await moveToFocused(msg.conversationId);
      return { success: true };
    }
    case 'MOVE_TO_SPAM': {
      await moveToSpam(msg.conversationId);
      return { success: true };
    }
    case 'MARK_READ': {
      await markConversationRead(msg.conversationId);
      return { success: true };
    }
    case 'MARK_UNREAD': {
      await markConversationUnread(msg.conversationId);
      return { success: true };
    }
    case 'DELETE_CONVERSATION': {
      await deleteConversation(msg.conversationId);
      return { success: true };
    }
    case 'STAR': {
      await starConversation(msg.conversationId);
      return { success: true };
    }
    case 'UNSTAR': {
      await unstarConversation(msg.conversationId);
      return { success: true };
    }
    case 'EDIT_MESSAGE': {
      await editMessage(msg.conversationId, msg.messageId, msg.body);
      // Update message in DB
      await db.messages.update(msg.messageId, { body: msg.body, editedAt: Date.now() });
      return { success: true };
    }
    case 'TYPEAHEAD_SEARCH': {
      const results = await searchTypeahead(msg.query);
      return { success: true, data: results };
    }
    case 'CREATE_CONVERSATION': {
      const result = await createConversation(msg.recipientUrns, msg.body, msg.attachments);
      return { success: true, data: result };
    }
    case 'FETCH_PROFILE_BY_URN': {
      const profile = await fetchProfileByUrn(msg.urn);
      return { success: true, data: profile };
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
      await db.transaction('rw', [db.conversations, db.messages, db.profiles, db.pendingActions, db.imageCache, db.syncState, db.syncQueue, db.draftAttachments], async () => {
        await db.conversations.clear();
        await db.messages.clear();
        await db.profiles.clear();
        await db.pendingActions.clear();
        await db.imageCache.clear();
        await db.syncState.clear();
        await db.syncQueue.clear();
        await db.draftAttachments.clear();
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
      // Check cache first
      const cached = await db.postCache.get(msg.activityUrn);
      if (cached) {
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

      // Store in IndexedDB using same merge logic as discovery
      if (conversations.length > 0 || profiles.length > 0) {
        await db.transaction('rw', [db.conversations, db.profiles], async () => {
          await mergeProfiles(profiles);
          for (const conv of conversations) {
            const existing = await db.conversations.get(conv.id);
            if (existing) {
              await db.conversations.update(conv.id, {
                participantUrns: conv.participantUrns.length > 0 ? conv.participantUrns : existing.participantUrns,
                participantNames: conv.participantNames.length > 0 ? conv.participantNames : existing.participantNames,
                participantPictures: conv.participantPictures.length > 0 ? conv.participantPictures : existing.participantPictures,
                lastMessage: conv.lastMessage || existing.lastMessage,
                lastActivityAt: Math.max(conv.lastActivityAt, existing.lastActivityAt),
                category: conv.category,
                archived: conv.archived,
                starred: existing.starred,  // preserve starred state during search merge
              });
            } else {
              await db.conversations.put(conv);
            }
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
      // Fire-and-forget: respond immediately, fetch all in parallel
      (async () => {
        const memberUrn = await getMemberUrn();
        await Promise.allSettled(msg.conversationIds.map(async (convId) => {
          const existingCount = await db.messages
            .where('conversationId')
            .equals(convId)
            .count();
          if (existingCount > 0) return;

          const pages = await fetchAllMessages(convId);
          let hasAttachments = false;
          for (const rawPage of pages) {
            const messages = normalizeMessages(rawPage, convId);
            for (const m of messages) {
              if (m.senderUrn === memberUrn) m.isFromMe = true;
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
          await db.syncQueue
            .where('conversationId')
            .equals(convId)
            .modify({ messagesSyncedAt: Date.now(), status: 'done' });
          debugLog('info', `[PREFETCH] Prefetched messages for ${convId}`);
        }));
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
          if (tooOld && (item.status === 'pending' || item.status === 'syncing')) {
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

async function runDiagnosticSync(): Promise<string> {
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg);
  const ts = () => new Date().toISOString();

  log(`=== INFLOW DIAGNOSTIC SYNC REPORT ===`);
  log(`Time: ${ts()}`);
  log('');

  // 1. Auth check
  try {
    const session = await getSession();
    const memberUrn = await getMemberUrn();
    log(`[AUTH] OK — memberUrn: ${memberUrn}`);
    log(`[AUTH] session keys: ${Object.keys(session || {}).join(', ')}`);
  } catch (err) {
    log(`[AUTH] FAILED: ${err}`);
    log('--- Cannot proceed without auth ---');
    return lines.join('\n');
  }

  const memberUrn = await getMemberUrn();

  // 2. Test default query (no category — should return focused inbox)
  log('');
  log('--- Query 1: Default (no category filter) ---');
  try {
    const variables = linkedInVariables({ mailboxUrn: memberUrn, count: 5, start: 0 });
    const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48&variables=${variables}`;
    log(`[URL] ${path}`);
    const res = await voyagerFetch(path);
    log(`[HTTP] ${res.status} ${res.statusText}`);
    if (res.ok) {
      const json = await res.json();
      const included = json.included || [];
      const convs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Conversation');
      const msgs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Message');
      const parts = included.filter((e: any) => e.$type === 'com.linkedin.messenger.MessagingParticipant');
      log(`[DATA] included.length=${included.length}, conversations=${convs.length}, messages=${msgs.length}, participants=${parts.length}`);
      log(`[DATA] $types: ${JSON.stringify([...new Set(included.map((e: any) => e.$type))])}`);
      if (convs.length > 0) {
        const c = convs[0];
        log(`[SAMPLE CONV] entityUrn=${c.entityUrn}`);
        log(`[SAMPLE CONV] categories=${JSON.stringify(c.categories)}, lastActivityAt=${c.lastActivityAt}, unreadCount=${c.unreadCount}`);
        log(`[SAMPLE CONV] keys: ${Object.keys(c).join(', ')}`);
        // Normalize to check
        const norm = normalizeConversations(json, memberUrn);
        log(`[NORMALIZED] conversations=${norm.conversations.length}, profiles=${norm.profiles.length}`);
        if (norm.conversations.length > 0) {
          const nc = norm.conversations[0];
          log(`[NORM SAMPLE] id=${nc.id}, category=${nc.category}, archived=${nc.archived}, read=${nc.read}, names=${nc.participantNames.join(', ')}`);
        }
      } else {
        log(`[DATA] No conversations in response!`);
        // Log first 3 entities for debugging
        for (let i = 0; i < Math.min(3, included.length); i++) {
          log(`[ENTITY ${i}] $type=${included[i].$type}, entityUrn=${included[i].entityUrn}`);
        }
      }
    } else {
      const body = await res.text().catch(() => '');
      log(`[ERROR BODY] ${body.substring(0, 500)}`);
    }
  } catch (err) {
    log(`[FAILED] ${err}`);
  }

  // 3. Test PRIMARY_INBOX category query
  log('');
  log('--- Query 2: PRIMARY_INBOX category filter ---');
  try {
    const variables = linkedInVariables({
      mailboxUrn: memberUrn,
      count: 5,
      start: 0,
      categories: raw('List(PRIMARY_INBOX)'),
    });
    const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.737b27144cf922499202658a5345016f&variables=${variables}`;
    log(`[URL] ${path}`);
    const res = await voyagerFetch(path);
    log(`[HTTP] ${res.status} ${res.statusText}`);
    if (res.ok) {
      const json = await res.json();
      const included = json.included || [];
      const convs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Conversation');
      log(`[DATA] included.length=${included.length}, conversations=${convs.length}`);
      if (convs.length > 0) {
        log(`[SAMPLE CONV] categories=${JSON.stringify(convs[0].categories)}`);
      }
    } else {
      const body = await res.text().catch(() => '');
      log(`[ERROR BODY] ${body.substring(0, 500)}`);
    }
  } catch (err) {
    log(`[FAILED] ${err}`);
  }

  // 4. Test SECONDARY_INBOX (Other)
  log('');
  log('--- Query 3: SECONDARY_INBOX (Other) ---');
  try {
    const variables = linkedInVariables({
      mailboxUrn: memberUrn,
      count: 5,
      start: 0,
      categories: raw('List(SECONDARY_INBOX)'),
    });
    const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.737b27144cf922499202658a5345016f&variables=${variables}`;
    log(`[URL] ${path}`);
    const res = await voyagerFetch(path);
    log(`[HTTP] ${res.status} ${res.statusText}`);
    if (res.ok) {
      const json = await res.json();
      const included = json.included || [];
      const convs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Conversation');
      log(`[DATA] included.length=${included.length}, conversations=${convs.length}`);
    } else {
      const body = await res.text().catch(() => '');
      log(`[ERROR BODY] ${body.substring(0, 500)}`);
    }
  } catch (err) {
    log(`[FAILED] ${err}`);
  }

  // 5. Test ARCHIVE
  log('');
  log('--- Query 4: ARCHIVE ---');
  try {
    const variables = linkedInVariables({
      mailboxUrn: memberUrn,
      count: 5,
      start: 0,
      categories: raw('List(ARCHIVE)'),
    });
    const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.737b27144cf922499202658a5345016f&variables=${variables}`;
    log(`[URL] ${path}`);
    const res = await voyagerFetch(path);
    log(`[HTTP] ${res.status} ${res.statusText}`);
    if (res.ok) {
      const json = await res.json();
      const included = json.included || [];
      const convs = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Conversation');
      log(`[DATA] included.length=${included.length}, conversations=${convs.length}`);
    } else {
      const body = await res.text().catch(() => '');
      log(`[ERROR BODY] ${body.substring(0, 500)}`);
    }
  } catch (err) {
    log(`[FAILED] ${err}`);
  }

  // 6. Message structure inspection — paginate through conversations to find attachments
  log('');
  log('--- Query 5: Scanning for messages with attachments ---');
  try {
    const MAX_CONVS = 80;
    const RICH_TARGET = 3; // stop after finding this many rich conversations
    let scanned = 0;
    let richFound = 0;
    let page = 0;

    outer:
    while (scanned < MAX_CONVS && richFound < RICH_TARGET) {
      // Fetch a page of conversations from the API
      const convVars = linkedInVariables({ mailboxUrn: memberUrn, count: 20, start: page * 20 });
      const convPath = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.0d5e6781bbee71c3e51c8843c6519f48&variables=${convVars}`;
      const convRes = await voyagerFetch(convPath);
      if (!convRes.ok) {
        log(`[SCAN] Conversation page ${page} failed: HTTP ${convRes.status}`);
        break;
      }
      const convJson = await convRes.json();
      const convNorm = normalizeConversations(convJson, memberUrn);
      if (convNorm.conversations.length === 0) {
        log(`[SCAN] No more conversations at page ${page}`);
        break;
      }
      log(`[SCAN] Page ${page}: ${convNorm.conversations.length} conversations`);

      for (const conv of convNorm.conversations) {
        if (richFound >= RICH_TARGET) break outer;
        scanned++;
        try {
          const conversationUrn = `urn:li:msg_conversation:(${memberUrn},${conv.id})`;
          const msgVars = `(conversationUrn:${conversationUrn.replace(/:/g, '%3A').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/,/g, '%2C').replace(/=/g, '%3D')})`;
          const msgPath = `/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.5846eeb71c981f11e0134cb6626cc314&variables=${msgVars}`;
          const msgRes = await voyagerFetch(msgPath);
          if (!msgRes.ok) continue;
          const msgJson = await msgRes.json();
          const included = msgJson.included || [];
          const msgEntities = included.filter((e: any) => e.$type === 'com.linkedin.messenger.Message');
          const allTypes = [...new Set(included.map((e: any) => e.$type))];

          const richMsgs = msgEntities.filter((m: any) => m.renderContent?.length > 0);
          const nonStdTypes = allTypes.filter((t: string) =>
            t !== 'com.linkedin.messenger.Message' &&
            t !== 'com.linkedin.messenger.MessagingParticipant' &&
            t !== 'com.linkedin.messenger.Conversation'
          );
          const msgsWithAttrs = msgEntities.filter((m: any) => m.body?.attributes?.length > 0);

          if (richMsgs.length === 0 && nonStdTypes.length === 0 && msgsWithAttrs.length === 0) {
            // plain text only — log compactly
            if (scanned <= 20 || scanned % 10 === 0) {
              log(`[SCAN ${scanned}] ${conv.participantNames.join(', ')}: ${msgEntities.length} msgs, plain text`);
            }
            continue;
          }

          // Found rich content!
          richFound++;
          log('');
          log(`[RICH #${richFound}] === ${conv.participantNames.join(', ')} (conv ${scanned}) ===`);
          log(`[RICH #${richFound}] ${msgEntities.length} messages, ${richMsgs.length} with renderContent, ${msgsWithAttrs.length} with body.attributes`);
          log(`[RICH #${richFound}] $types: ${JSON.stringify(allTypes)}`);

          // Dump non-standard entity types in full
          for (const type of nonStdTypes) {
            const entities = included.filter((e: any) => e.$type === type);
            log(`[RICH #${richFound}] Entity type ${type}: ${entities.length} found`);
            for (let i = 0; i < Math.min(3, entities.length); i++) {
              log(`  [${i}] keys: ${Object.keys(entities[i]).join(', ')}`);
              log(`  [${i}] data: ${JSON.stringify(entities[i]).substring(0, 1000)}`);
            }
          }

          // Dump messages with renderContent
          for (let i = 0; i < Math.min(3, richMsgs.length); i++) {
            const m = richMsgs[i];
            log(`[RICH #${richFound} MSG ${i}] body: ${(m.body?.text || '(empty)').substring(0, 120)}`);
            log(`[RICH #${richFound} MSG ${i}] renderContent: ${JSON.stringify(m.renderContent).substring(0, 1200)}`);
            log(`[RICH #${richFound} MSG ${i}] fallbackText: ${m.renderContentFallbackText}`);
            log(`[RICH #${richFound} MSG ${i}] format: ${m.messageBodyRenderFormat}`);
            // Dump all keys and values for this message
            log(`[RICH #${richFound} MSG ${i}] ALL FIELDS:`);
            for (const [key, value] of Object.entries(m)) {
              const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
              log(`  ${key}: ${valStr.substring(0, 400)}`);
            }
          }

          // Dump messages with body.attributes
          for (let i = 0; i < Math.min(3, msgsWithAttrs.length); i++) {
            const m = msgsWithAttrs[i];
            log(`[RICH #${richFound} ATTR ${i}] body.text: ${(m.body?.text || '(empty)').substring(0, 120)}`);
            log(`[RICH #${richFound} ATTR ${i}] attributes: ${JSON.stringify(m.body.attributes).substring(0, 1000)}`);
          }
        } catch (err) {
          log(`[SCAN ${scanned}] ${conv.participantNames.join(', ')}: error — ${err}`);
        }
      }
      page++;
    }

    log('');
    log(`[SCAN COMPLETE] Scanned ${scanned} conversations, found ${richFound} with rich content`);
  } catch (err) {
    log(`[SCAN FAILED] ${err}`);
  }

  // 7. Current IndexedDB state
  log('');
  log('--- IndexedDB State ---');
  try {
    const allConvs = await db.conversations.toArray();
    log(`[DB] Total conversations: ${allConvs.length}`);
    const byCat: Record<string, number> = {};
    const byArchived: Record<string, number> = {};
    for (const c of allConvs) {
      byCat[c.category || 'UNDEFINED'] = (byCat[c.category || 'UNDEFINED'] || 0) + 1;
      byArchived[String(c.archived)] = (byArchived[String(c.archived)] || 0) + 1;
    }
    log(`[DB] By category: ${JSON.stringify(byCat)}`);
    log(`[DB] By archived: ${JSON.stringify(byArchived)}`);

    const msgCount = await db.messages.count();
    const profileCount = await db.profiles.count();
    log(`[DB] Messages: ${msgCount}, Profiles: ${profileCount}`);

    // Sample first 3 conversations
    const sample = allConvs.slice(0, 3);
    for (const c of sample) {
      log(`[DB SAMPLE] id=${c.id.substring(0, 25)}... cat=${c.category} archived=${c.archived} read=${c.read} names=${c.participantNames.join(', ')}`);
    }
  } catch (err) {
    log(`[DB ERROR] ${err}`);
  }

  // 7. Dexie schema info
  log('');
  log('--- Dexie Schema ---');
  try {
    log(`[SCHEMA] version: ${db.verno}`);
    for (const table of db.tables) {
      log(`[SCHEMA] ${table.name}: ${table.schema.primKey.name} indexes=[${table.schema.indexes.map(i => i.name).join(', ')}]`);
    }
  } catch (err) {
    log(`[SCHEMA ERROR] ${err}`);
  }

  log('');
  log('=== END DIAGNOSTIC REPORT ===');
  return lines.join('\n');
}
