/**
 * Process incoming SSE events from LinkedIn's /realtime/connect stream.
 *
 * The exact event format is discovered at runtime — this handler logs all
 * events for debugging and processes the ones we recognise (new messages,
 * read receipts, conversation updates).
 *
 * LinkedIn's SSE events typically wrap Voyager-style entities inside an
 * event payload keyed by topic. The handler extracts message data,
 * normalises it using the same helpers the poller uses, and writes
 * directly to IndexedDB so the UI updates via Dexie's useLiveQuery.
 */

import { getMemberUrn } from '../auth/session';
import { fetchProfileByUrn } from '../api/profiles';
import { fetchMessages } from '../api/messages';
import { normalizeMessages, extractProfileId, getParticipantPicture, extractReactions, needsParticipantRepair, extractAudioAttachment, extractParticipantsFromIncluded, isValidProfileUrn, type ExtractedParticipants } from '@/lib/voyager-normalizer';
import { withoutRecalled } from '@/lib/message-dedup';
import { repairConversationParticipants } from '../sync/repair-participants';
import { reconcileRecalledMessages } from '../sync/reconcile-messages';
import { debugLog } from '@/lib/debug-log';
import { db, getDbGeneration, mergeProfiles } from '@/db/database';
import { ENABLE_PROFILE_ENRICHMENT } from '@/lib/feature-flags';
import { shouldSuppressConversationUpdate, isMutationSuppressed } from './mark-read-suppression';
import { hasPendingAction } from '../sync/pending-guard';
import { extractConversationId } from '@/lib/conversation-urn';

interface RealtimeContext {
  database: typeof db;
  dbGeneration: number;
}

function createRealtimeContext(): RealtimeContext {
  return { database: db, dbGeneration: getDbGeneration() };
}

function isStaleContext(ctx: RealtimeContext): boolean {
  return getDbGeneration() !== ctx.dbGeneration;
}

/**
 * Of a batch's messages for one conversation, return the genuinely NEW inbound
 * ones: not already stored under their id, and newer (in server time) than
 * every stored non-temp message — falling back to the conversation's
 * lastActivityAt when no messages are stored yet. Re-deliveries of old
 * messages (edit/reaction echoes) and SSE copies of already-fetched canonical
 * rows return empty. MUST be called BEFORE the batch is written to the DB.
 *
 * Temp (optimistic) rows are excluded from the threshold because their
 * createdAt is the local wall clock — a fast local clock would otherwise mask
 * a genuine reply arriving right after our own send.
 */
async function findNewInboundMessages(
  ctx: RealtimeContext,
  convId: string,
  msgs: Message[],
): Promise<Message[]> {
  const inbound = msgs.filter((m) => !m.isFromMe);
  if (inbound.length === 0) return [];
  const database = ctx.database;
  const existingRows = await database.messages.bulkGet(inbound.map((m) => m.id));
  const fresh = inbound.filter((_, i) => !existingRows[i]);
  if (fresh.length === 0) return [];

  const stored = await database.messages.where('conversationId').equals(convId).toArray();
  let threshold = 0;
  for (const m of stored) {
    if (!m.id.startsWith('temp-') && m.createdAt > threshold) threshold = m.createdAt;
  }
  if (threshold === 0) {
    const conv = await database.conversations.get(convId);
    threshold = conv?.lastActivityAt ?? 0;
  }
  return fresh.filter((m) => m.createdAt > threshold);
}

/**
 * Apply an inbound SSE message batch to its parent conversation: bump
 * lastMessage/lastActivityAt and (unless suppressed or a pending optimistic
 * action exists) mark unread + move to Focused + un-archive on a reply. Creates
 * a minimal conversation if none exists yet. Shared by handleNewMessage and
 * handleIncludedMessage (previously copy-pasted in both).
 *
 * `hasNewInbound` (from findNewInboundMessages, computed before the batch was
 * written) gates the unread/move/un-archive side effects: LinkedIn re-delivers
 * Message entities for edits and reactions, and those echoes of OLD messages
 * must not act like new mail.
 */
async function applyInboundMessageToConversation(
  ctx: RealtimeContext,
  convId: string,
  convMessages: any[],
  memberUrn: string,
  eventParticipants: ExtractedParticipants | undefined,
  hasNewInbound: boolean,
): Promise<void> {
  if (isStaleContext(ctx)) return;
  const database = ctx.database;
  // The realtime event itself often carries the full participant list (the other
  // party included), even when the only message is outbound — e.g. a first message
  // sent from another device. Prefer it so the conversation never shows "Unknown".
  const haveEventParts = !!eventParticipants && eventParticipants.participantUrns.length > 0;
  const latest = convMessages.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  // Read pending-actions (a different table) outside the conversations transaction.
  const pending = await hasPendingAction(convId);
  const existing = await database.conversations.get(convId);
  if (existing) {
    // Atomic read-modify-write: the detached RealtimeConversation fetch can write
    // the same conversation concurrently, so re-read inside the transaction to
    // avoid clobbering read/category/lastActivityAt.
    await database.transaction('rw', database.conversations, async () => {
      if (isStaleContext(ctx)) return;
      const conv = await database.conversations.get(convId);
      if (!conv) return;
      const updates: Record<string, any> = {
        lastActivityAt: Math.max(latest.createdAt, conv.lastActivityAt),
      };
      // Only advance the preview for genuinely new mail or for the current
      // latest message (an edit of the latest message re-arrives with the same
      // deliveredAt and should update the preview text). An edit echo of an
      // OLDER message must not rewind the preview under a newer timestamp.
      if (hasNewInbound || latest.createdAt >= conv.lastActivityAt) {
        updates.lastMessage = latest.body || 'New message';
      }
      if (!isMutationSuppressed(convId) && !pending && conv.category !== 'SPAM' && hasNewInbound) {
        updates.read = 0;
        // Move to Focused and un-archive when someone replies
        if (conv.category !== 'PRIMARY_INBOX') updates.category = 'PRIMARY_INBOX';
        if (conv.archived === 1) updates.archived = 0;
      }
      await database.conversations.update(convId, updates);
    });
    // Heal a conversation previously seeded from an unresolved SSE echo
    // (participants left as "Unknown" / a garbage URN). Prefer the participant
    // data carried in this event; only fall back to a fetch if it's absent.
    if (needsParticipantRepair(existing)) {
      if (haveEventParts) {
        await database.conversations.update(convId, {
          participantUrns: eventParticipants!.participantUrns,
          participantNames: eventParticipants!.participantNames,
          participantPictures: eventParticipants!.participantPictures,
        });
        // Profile records (best-effort) back the open-profile shortcut.
        if (eventParticipants!.profiles.length) await mergeProfiles(eventParticipants!.profiles).catch(() => {});
        debugLog('info', `[RT] Healed participants for ${convId.substring(0, 20)}... from event: ${eventParticipants!.participantNames.join(', ')}`);
      } else {
        backfillConversationParticipants(ctx, convId, memberUrn);
      }
    }
  } else {
    // Create a minimal conversation so it appears in the list immediately.
    // Prefer participant data from the event (covers outbound-only messages from
    // another device); else use the message sender; else backfill via the API.
    const senders = convMessages.filter((m) => !m.isFromMe);
    const sender = senders[0];
    if (isStaleContext(ctx)) return;
    // A live SSE message means the thread is active again on LinkedIn's side —
    // clear any local delete tombstone so the resurrected conversation can sync.
    await database.tombstones.delete(convId).catch(() => {});
    await database.conversations.put({
      id: convId,
      participantUrns: haveEventParts ? eventParticipants!.participantUrns : sender ? [sender.senderUrn] : [],
      participantNames: haveEventParts ? eventParticipants!.participantNames : sender ? [sender.senderName] : [],
      participantPictures: haveEventParts ? eventParticipants!.participantPictures : sender ? [sender.senderPicture] : [],
      lastMessage: latest.body || 'New message',
      lastActivityAt: latest.createdAt,
      read: senders.length > 0 ? 0 : 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
      hasAttachments: convMessages.some((m) => m.attachments?.length) ? 1 : 0,
      starred: 0,
    });
    debugLog('info', `[RT] Created minimal conversation ${convId} from SSE message`);
    // Store participant profiles (best-effort) so the open-profile shortcut works.
    if (haveEventParts && eventParticipants!.profiles.length) await mergeProfiles(eventParticipants!.profiles).catch(() => {});
    // Still no usable participant data (outbound-only, none in the event) → fetch it.
    if (!haveEventParts && !sender) backfillConversationParticipants(ctx, convId, memberUrn);
  }
}
import type { Message, MessageAttachment, ReactionSummary } from '@/types/message';

/**
 * Show a native OS notification for an inbound message.
 * Suppressed when the inflow tab is active and focused (the in-app toast
 * handles that case). Uses the conversation ID as the notification ID so
 * rapid messages in the same thread replace the previous notification.
 * Fire-and-forget — errors are swallowed.
 */
function showNativeNotification(msg: {
  senderName: string;
  senderPicture: string;
  body: string;
  conversationId: string;
}): void {
  (async () => {
    const appUrl = chrome.runtime.getURL('app.html');
    const activeTabs = await chrome.tabs.query({ url: appUrl, active: true, lastFocusedWindow: true });
    if (activeTabs.length > 0) return; // in-app toast will show instead

    chrome.notifications.create(msg.conversationId, {
      type: 'basic',
      iconUrl: msg.senderPicture || chrome.runtime.getURL('icon-128.png'),
      title: msg.senderName,
      message: msg.body || 'New message',
    });
  })().catch((err) => {
    debugLog('warn', `[RT] Failed to show notification: ${err}`);
  });
}

/** Enrich a single profile if it's missing company data. Non-blocking, fire-and-forget. */
function enrichProfileIfNeeded(ctx: RealtimeContext, urn: string): void {
  if (!ENABLE_PROFILE_ENRICHMENT) return;
  const database = ctx.database;
  database.profiles.get(urn).then(async (p) => {
    if (isStaleContext(ctx)) return;
    if (!p || p.company) return;
    const data = await fetchProfileByUrn(urn);
    if (isStaleContext(ctx)) return;
    if (!data) return;
    const updates: Record<string, string> = {};
    if (data.company) updates.company = data.company;
    if (data.title) updates.title = data.title;
    if (data.companyLogoUrl) updates.companyLogoUrl = data.companyLogoUrl;
    if (data.locationName && !p.location) updates.location = data.locationName;
    if (Object.keys(updates).length > 0) {
      await database.profiles.update(urn, updates);
    }
  }).catch((err) => {
    debugLog('warn', `[RT] Failed to enrich profile ${urn}: ${err}`);
  });
}

/**
 * Fetch participant data for a conversation and update it in IndexedDB.
 * Used when a minimal conversation is created from an outbound-only SSE message
 * and we don't have the other party's profile data from the event itself.
 * Fire-and-forget — called async, errors are swallowed.
 */
function backfillConversationParticipants(ctx: RealtimeContext, conversationId: string, memberUrn: string): void {
  fetchMessages(conversationId, 1, 0, { skipJitter: true })
    .then((raw) => {
      if (isStaleContext(ctx)) return;
      return repairConversationParticipants(conversationId, raw.included || [], memberUrn);
    })
    .catch((err) => {
      debugLog('warn', `[RT] Failed to backfill participants for ${conversationId}: ${err}`);
    });
}

/**
 * Delete the local copies of a message the server reports as recalled/unsent.
 * Matches by the event's SSE ids and — for the canonical copy fetched via REST
 * under a different id — by sender + server timestamp. Rewinds the
 * conversation preview when the recalled message was the latest activity.
 * Never touches optimistic temps and never creates a conversation.
 */
async function removeRecalledMessage(
  ctx: RealtimeContext,
  conversationId: string,
  target: { ids: string[]; createdAt?: number; senderUrn?: string },
): Promise<void> {
  if (isStaleContext(ctx)) return;
  const database = ctx.database;

  let deleted = 0;
  await database.transaction('rw', database.messages, async () => {
    const all = await database.messages
      .where('conversationId')
      .equals(conversationId)
      .toArray();
    const toDelete = all.filter((m) => {
      if (m.id.startsWith('temp-')) return false;
      if (target.ids.includes(m.id)) return true;
      if (typeof target.createdAt !== 'number' || m.createdAt !== target.createdAt) return false;
      // Timestamp match alone could hit a coincidentally-simultaneous message
      // from someone else — require the sender when the event resolved one.
      return !target.senderUrn || m.senderUrn === target.senderUrn;
    });
    if (toDelete.length > 0) {
      await database.messages.bulkDelete(toDelete.map((m) => m.id));
      deleted = toDelete.length;
    }
  });
  if (deleted === 0) return;

  debugLog(
    'info',
    `[RT] Recall: removed ${deleted} message(s) from ${conversationId.substring(0, 20)}...`
  );

  // If the recalled message was the newest activity, rewind the preview text to
  // the newest remaining message (lastActivityAt is left alone — merges only
  // ever raise it, and lowering it would fight the freshness checks).
  await database.transaction('rw', [database.conversations, database.messages], async () => {
    if (isStaleContext(ctx)) return;
    const conv = await database.conversations.get(conversationId);
    if (!conv) return;
    if (typeof target.createdAt === 'number' && conv.lastActivityAt !== target.createdAt) return;
    const remaining = await database.messages
      .where('conversationId')
      .equals(conversationId)
      .toArray();
    let newest: Message | null = null;
    for (const m of remaining) {
      if (m.id.startsWith('temp-')) continue;
      if (!newest || m.createdAt > newest.createdAt) newest = m;
    }
    if (newest) {
      await database.conversations.update(conversationId, { lastMessage: newest.body || '' });
    }
  });
}

// ---------------------------------------------------------------------------
// Main entry point — called by sse-client for every parsed SSE event
// ---------------------------------------------------------------------------

export async function handleRealtimeEvent(
  eventType: string,
  data: any
): Promise<void> {
  const ctx = createRealtimeContext();
  try {
    // LinkedIn's server heartbeat — just a keep-alive, ignore silently
    if (data['com.linkedin.realtimefrontend.Heartbeat']) {
      return;
    }

    // LinkedIn wraps all real events in DecoratedEvent. Unwrap it.
    const decorated = data['com.linkedin.realtimefrontend.DecoratedEvent'];
    if (decorated) {
      const topic = decorated.topic || '';
      const payload = decorated.payload;
      const included = payload?.data?.included || payload?.included || [];

      debugLog(
        'info',
        `[RT] DecoratedEvent: topic=${topic.substring(0, 80)} included=${included.length} types=${[...new Set(included.map((e: any) => e.$type))].join(',')}`
      );

      if (included.length > 0) {
        // New Messenger API types
        const hasMessages = included.some(
          (e: any) => e.$type === 'com.linkedin.messenger.Message'
        );
        // Old Voyager API types (used in SSE events)
        const hasVoyagerEvents = included.some(
          (e: any) => e.$type === 'com.linkedin.voyager.messaging.Event'
        );
        const hasReceipts = included.some(
          (e: any) =>
            e.$type === 'com.linkedin.messenger.SeenReceipt' ||
            e.$type === 'com.linkedin.voyager.messaging.SeenReceipt'
        );

        if (hasMessages) {
          await handleIncludedMessage(ctx, included, await getMemberUrn());
          return;
        }
        if (hasVoyagerEvents) {
          await handleVoyagerEvent(ctx, included, decorated.payload?.data?.value, await getMemberUrn());
          return;
        }
        if (hasReceipts) {
          await handleReadReceipt(ctx, { included });
          return;
        }

        const hasTyping = included.some(
          (e: any) =>
            e.$type === 'com.linkedin.messenger.TypingIndicator' ||
            e.$type === 'com.linkedin.messenger.RealtimeTypingIndicator'
        );
        if (hasTyping) {
          const indicator = included.find(
            (e: any) =>
              e.$type === 'com.linkedin.messenger.TypingIndicator' ||
              e.$type === 'com.linkedin.messenger.RealtimeTypingIndicator'
          );
          debugLog(
            'info',
            `[RT] Typing indicator: ${JSON.stringify(indicator).substring(0, 300)}`
          );
          return;
        }

        // Conversation update events (new message arrived, read status changed, etc.)
        const realtimeConv = included.find(
          (e: any) => e.$type === 'com.linkedin.voyager.messaging.realtime.RealtimeConversation'
        );
        if (realtimeConv) {
          await handleConversationUpdate(ctx, realtimeConv, included, await getMemberUrn());
          return;
        }
      }

      // Dash-format conversation update (new Messenger API).
      // Unlike old Voyager events, these have empty included[] and carry
      // a full com.linkedin.messenger.Conversation entity as the ActionResponse result.
      // This is how per-conversation read/unread status is communicated via SSE.
      if (topic.includes('conversationsTopic')) {
        const convEntity = extractDashConversationResult(payload);
        if (convEntity) {
          await handleDashConversationUpdate(ctx, convEntity);
          return;
        }
      }

      // Unrecognised DecoratedEvent — log for discovery
      debugLog(
        'info',
        `[RT] Unhandled DecoratedEvent: topic=${topic.substring(0, 60)} payload=${JSON.stringify(decorated.payload || decorated)}`
      );
      return;
    }

    // Non-decorated events (legacy shapes)
    if (isNewMessageEvent(data)) {
      await handleNewMessage(ctx, data);
    } else if (isReadReceiptEvent(data)) {
      await handleReadReceipt(ctx, data);
    } else if (isTypingEvent(data)) {
      const typingData = data.data || data.typingIndicator || extractIncluded(data)?.[0] || {};
      debugLog('info', `[RT] Typing indicator (legacy): ${JSON.stringify(typingData).substring(0, 300)}`);
    } else {
      debugLog(
        'info',
        `[RT] Unhandled event: type=${eventType} topKeys=${Object.keys(data).slice(0, 10).join(',')}`
      );
    }
  } catch (err: any) {
    debugLog('error', `[RT] Error handling event: ${err}`);
    if (err?.stack) {
      debugLog('error', `[RT] Stack: ${err.stack}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Event type detection
// ---------------------------------------------------------------------------

/**
 * Detect whether this SSE payload contains a new message.
 *
 * LinkedIn's realtime events come in several possible shapes:
 * 1. { topic: "...", payload: { data: { included: [...] } } }
 *    — Voyager-style with included entities
 * 2. { "com.linkedin.messenger.Message": { ... } }
 *    — Flat entity with $type
 * 3. { data: { $type: "com.linkedin.messenger.Message", ... } }
 *    — Nested with $type
 * 4. { included: [...] }
 *    — Direct included array (like a Voyager response)
 *
 * We check all of these.
 */
function isNewMessageEvent(data: any): boolean {
  // Shape 1: topic-based with included array
  const included = extractIncluded(data);
  if (included) {
    return included.some(
      (e: any) => e.$type === 'com.linkedin.messenger.Message'
    );
  }

  // Shape 2: flat entity
  if (data['com.linkedin.messenger.Message']) return true;

  // Shape 3: nested data with $type
  if (data.data?.$type === 'com.linkedin.messenger.Message') return true;

  // Shape 4: event has a messageUrn or message field
  if (data.messageUrn || data.message?.entityUrn) return true;

  return false;
}

function isReadReceiptEvent(data: any): boolean {
  const included = extractIncluded(data);
  if (included) {
    return (
      included.some(
        (e: any) => e.$type === 'com.linkedin.messenger.SeenReceipt'
      ) && !included.some(
        (e: any) => e.$type === 'com.linkedin.messenger.Message'
      )
    );
  }
  if (data['com.linkedin.messenger.SeenReceipt']) return true;
  if (data.data?.$type === 'com.linkedin.messenger.SeenReceipt') return true;
  return false;
}

function isTypingEvent(data: any): boolean {
  const included = extractIncluded(data);
  if (included) {
    return included.some(
      (e: any) =>
        e.$type === 'com.linkedin.messenger.TypingIndicator' ||
        e.$type === 'com.linkedin.messenger.RealtimeTypingIndicator'
    );
  }
  return (
    data.data?.$type === 'com.linkedin.messenger.TypingIndicator' ||
    data.data?.$type === 'com.linkedin.messenger.RealtimeTypingIndicator' ||
    !!data.typingIndicator
  );
}

// ---------------------------------------------------------------------------
// Extract helpers
// ---------------------------------------------------------------------------

/**
 * Try to find a Voyager-style `included` array in the event payload.
 */
function extractIncluded(data: any): any[] | null {
  if (Array.isArray(data.included)) return data.included;
  if (Array.isArray(data.payload?.data?.included)) return data.payload.data.included;
  if (Array.isArray(data.payload?.included)) return data.payload.included;
  if (Array.isArray(data.data?.included)) return data.data.included;
  return null;
}

/**
 * Extract conversation ID from an entityUrn.
 * "urn:li:msg_conversation:(urn:li:fsd_profile:XXX,2-abc123)" -> "2-abc123"
 */
// extractConversationId is shared from '@/lib/conversation-urn' (imported above).

/**
 * Extract profile member ID from URN.
 * "urn:li:fsd_profile:ABC" -> "ABC"
 */
// extractProfileId is shared from '@/lib/voyager-normalizer' (imported above).

// ---------------------------------------------------------------------------
// New message handler
// ---------------------------------------------------------------------------

async function handleNewMessage(ctx: RealtimeContext, data: any): Promise<void> {
  const memberUrn = await getMemberUrn();
  const included = extractIncluded(data);

  if (included) {
    await handleIncludedMessage(ctx, included, memberUrn);
    return;
  }

  // Flat entity shape
  const msgEntity =
    data['com.linkedin.messenger.Message'] || data.data || data.message;
  if (msgEntity?.entityUrn) {
    await handleSingleMessageEntity(ctx, msgEntity, memberUrn);
  }
}

// ---------------------------------------------------------------------------
// Voyager-format message handler (old API, used by SSE events)
// ---------------------------------------------------------------------------

async function handleVoyagerEvent(
  ctx: RealtimeContext,
  included: any[],
  value: any,
  memberUrn: string
): Promise<void> {
  // Build profile lookup from MiniProfile entities
  const profileMap = new Map<string, any>();
  for (const entity of included) {
    if (entity.$type === 'com.linkedin.voyager.identity.shared.MiniProfile') {
      profileMap.set(entity.entityUrn, entity);
    }
  }

  // Build member lookup from MessagingMember entities
  const memberMap = new Map<string, any>();
  for (const entity of included) {
    if (entity.$type === 'com.linkedin.voyager.messaging.MessagingMember') {
      memberMap.set(entity.entityUrn, entity);
    }
  }

  const messages: Message[] = [];
  const conversationIds = new Set<string>();

  for (const entity of included) {
    if (entity.$type !== 'com.linkedin.voyager.messaging.Event') continue;

    // Extract conversation ID from entityUrn
    // "urn:li:fs_event:(2-CONVID,2-MSGID)" -> "2-CONVID"
    const urnMatch = entity.entityUrn?.match(/fs_event:\(([^,]+)/);
    const conversationId = urnMatch?.[1] || '';
    if (!conversationId) {
      debugLog('warn', `[RT] No conversation ID in entityUrn: ${entity.entityUrn}`);
      continue;
    }

    conversationIds.add(conversationId);

    // Get message body from eventContent.
    // eventContent IS the MessageEvent directly — body and attributedBody are
    // top-level fields, NOT nested under a "messageEvent" sub-property.
    const ec = entity.eventContent || {};
    const body = ec.attributedBody?.text || ec.body || '';

    // Recall/unsend events arrive as MessageEvents with recalledAt set and an
    // empty body — previously misclassified as typing indicators and dropped,
    // so the recalled message only vanished on the next fetch reconcile.
    if (ec.recalledAt || ec.messageBodyRenderFormat === 'RECALLED') {
      const fromMember = memberMap.get(entity['*from'] || '');
      const recallProfileId = (fromMember?.['*miniProfile'] || '').split(':').pop() || '';
      await removeRecalledMessage(ctx, conversationId, {
        ids: [entity.dashEntityUrn, entity.entityUrn].filter(Boolean),
        createdAt: typeof entity.createdAt === 'number' ? entity.createdAt : undefined,
        senderUrn: recallProfileId ? `urn:li:fsd_profile:${recallProfileId}` : undefined,
      });
      continue;
    }

    // Typing indicators arrive as Voyager Events with empty body.
    // Skip them — don't store as messages.
    if (!body && !ec.attachments?.length) {
      debugLog('info', `[RT] Typing indicator (Voyager): conv=${conversationId.substring(0, 20)}... ecType=${ec.$type || 'none'} keys=${Object.keys(ec).join(',')}`);
      continue;
    }

    // Get sender via *from → MessagingMember → *miniProfile → MiniProfile
    const fromRef = entity['*from'] || '';
    const fromMember = memberMap.get(fromRef);
    const miniProfileUrn = fromMember?.['*miniProfile'] || '';
    const profileId = miniProfileUrn.split(':').pop() || '';
    const senderUrn = profileId ? `urn:li:fsd_profile:${profileId}` : '';

    const senderProfile = profileMap.get(miniProfileUrn);
    const senderName = senderProfile
      ? `${senderProfile.firstName || ''} ${senderProfile.lastName || ''}`.trim()
      : 'Unknown';

    // Get sender picture
    let senderPicture = '';
    if (senderProfile?.picture) {
      const pic = senderProfile.picture;
      const rootUrl = pic['com.linkedin.common.VectorImage']?.rootUrl || pic.rootUrl || '';
      const artifacts = pic['com.linkedin.common.VectorImage']?.artifacts || pic.artifacts || [];
      if (rootUrl && artifacts.length > 0) {
        const artifact = artifacts
          .sort((a: any, b: any) => (a.width || 0) - (b.width || 0))
          .find((a: any) => (a.width || 0) >= 100) || artifacts[0];
        if (artifact?.fileIdentifyingUrlPathSegment) {
          senderPicture = `${rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
        }
      }
    }

    const self = await resolveSelfSender(ctx, conversationId, senderUrn, memberUrn, !!senderProfile);

    // Extract editedAt — Voyager events carry it inside eventContent, not on the entity
    const editedAt = ec.editedAt || ec.lastEditedAt || entity.editedAt || entity.lastEditedAt || undefined;

    // Use dashEntityUrn (urn:li:fsd_message:...) as the ID so it matches
    // the poller's Messenger API format and avoids duplicate entries.
    const messageId = entity.dashEntityUrn || entity.entityUrn;

    messages.push({
      id: messageId,
      conversationId,
      senderUrn: self.senderUrn,
      senderName: self.isFromMe ? 'You' : senderName,
      senderPicture,
      body,
      createdAt: entity.createdAt || Date.now(),
      isFromMe: self.isFromMe,
      ...(editedAt ? { editedAt } : {}),
    });
  }

  if (messages.length === 0) {
    debugLog('warn', '[RT] No messages extracted from Voyager event');
    return;
  }

  // Write all messages to DB immediately for instant display — including
  // messages sent by the user from another client (isFromMe=true).
  // Their IDs use a non-canonical format (urn:li:fsd_message / urn:li:fs_event)
  // that differs from the Messenger API (urn:li:msg_message). The duplicates
  // are cleaned up when the canonical version is fetched.

  // Log a concise summary for each message
  for (const m of messages) {
    debugLog(
      'info',
      `[RT] SSE message: bodyLength=${m.body.length} from ${m.senderName} (isFromMe=${m.isFromMe}) in conv ${m.conversationId.substring(0, 20)}...`
    );
  }

  if (isStaleContext(ctx)) return;

  // Detect genuinely new inbound messages BEFORE writing the batch — edit
  // echoes of old messages must not mark the thread unread or notify.
  const newInboundByConv = new Map<string, Message[]>();
  for (const convId of conversationIds) {
    const convMessages = messages.filter((m) => m.conversationId === convId);
    newInboundByConv.set(convId, await findNewInboundMessages(ctx, convId, convMessages));
  }

  if (isStaleContext(ctx)) return;
  await ctx.database.messages.bulkPut(messages);
  await cleanupOptimisticMessages(ctx, messages);

  // Update parent conversations
  for (const convId of conversationIds) {
    const convMessages = messages.filter((m) => m.conversationId === convId);
    const hasNewInbound = (newInboundByConv.get(convId)?.length ?? 0) > 0;
    await applyInboundMessageToConversation(ctx, convId, convMessages, memberUrn, undefined, hasNewInbound);
  }

  // Notify UI of genuinely NEW inbound messages for toast notifications
  const newInbound = [...newInboundByConv.values()].flat();
  if (newInbound.length > 0) {
    const latest = newInbound.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    chrome.runtime.sendMessage({
      type: 'INCOMING_MESSAGE',
      id: latest.id,
      senderName: latest.senderName,
      senderPicture: latest.senderPicture,
      body: latest.body,
      conversationId: latest.conversationId,
    }).catch(() => {});
    showNativeNotification(latest);
  }

  // Enrich sender profiles for inbound messages (non-blocking)
  const senderUrns = new Set(messages.filter((m) => !m.isFromMe).map((m) => m.senderUrn));
  for (const urn of senderUrns) {
    enrichProfileIfNeeded(ctx, urn);
  }
}

// ---------------------------------------------------------------------------
// Conversation update handler (RealtimeConversation events)
// ---------------------------------------------------------------------------
// Dash-format conversation update handler (new Messenger API)
// ---------------------------------------------------------------------------

/**
 * Extract a com.linkedin.messenger.Conversation entity from a Dash-format
 * SSE payload. The Dash format wraps the entity in an ActionResponse under
 * a dynamic key (often base64-encoded), not in `included[]`.
 */
function extractDashConversationResult(payload: any): any | null {
  const data = payload?.data;
  if (!data) return null;
  for (const key of Object.keys(data)) {
    if (key.startsWith('_')) continue;
    const val = data[key];
    if (val?.result?._type === 'com.linkedin.messenger.Conversation') {
      return val.result;
    }
  }
  return null;
}

/**
 * Handle a Dash-format conversation update with per-conversation read status.
 * These events carry a full Conversation entity with `read`, `unreadCount`,
 * and `lastReadAt` fields — unlike the old Voyager RealtimeConversation events
 * which only have the inbox-wide `unreadConversationsCount`.
 */
async function handleDashConversationUpdate(ctx: RealtimeContext, convEntity: any): Promise<void> {
  const convId = extractConversationId(convEntity.entityUrn || '');
  if (!convId) return;

  const isRead = convEntity.read === true;
  // Honor BOTH suppression windows: mark-read (recordMarkRead) AND mutation
  // (recordMutation, e.g. MARK_UNREAD) — otherwise a stale read=true Dash echo
  // reverts a just-applied optimistic Mark-Unread.
  const suppressed = shouldSuppressConversationUpdate(convId) || isMutationSuppressed(convId);

  // DIAGNOSTIC (star/unstar sync): log the full category overlay + field list.
  // Cross-device star changes update LinkedIn's web UI live, so the echo very
  // likely arrives here with a `categories` array (± STARRED) — capture it to
  // confirm the shape before wiring star reconciliation.
  debugLog(
    'info',
    `[RT] Dash conversation update: ${convId.substring(0, 20)}... read=${convEntity.read} unreadCount=${convEntity.unreadCount} lastReadAt=${convEntity.lastReadAt} lastActivityAt=${convEntity.lastActivityAt} categories=${JSON.stringify(convEntity.categories)} keys=${Object.keys(convEntity).join(',')}${suppressed ? ' (suppressed)' : ''}`
  );

  if (suppressed) return;

  if (isStaleContext(ctx)) return;
  const existing = await ctx.database.conversations.get(convId);
  if (!existing) return;

  // Staleness guard (same rule as mergeConversation): an entity describing the
  // conversation BEFORE its newest local activity is a delayed echo — its read
  // flag predates the newest message and must not hide the unread indicator.
  // Entities without lastActivityAt apply as before (freshness unknown).
  if (
    typeof convEntity.lastActivityAt === 'number' &&
    convEntity.lastActivityAt < existing.lastActivityAt
  ) {
    debugLog('info', `[RT] Ignoring stale Dash update for ${convId.substring(0, 20)}... (entity older than local state)`);
    return;
  }

  const newRead = isRead ? 1 : 0;
  if (existing.read !== newRead) {
    await ctx.database.conversations.update(convId, { read: newRead });
    debugLog('info', `[RT] Updated conversation ${convId.substring(0, 20)}... read=${newRead} (from another client)`);
  }
}

// ---------------------------------------------------------------------------
// Conversation update handler (RealtimeConversation events — old Voyager format)
// ---------------------------------------------------------------------------

/**
 * Handle a RealtimeConversation event — triggered when a conversation is
 * updated (new message, read status change, etc.).
 *
 * Extracts the conversation ID, updates metadata from the included
 * MiniProfile/MessagingMember entities, and fetches the latest messages
 * so the UI picks up the new content immediately.
 */
async function handleConversationUpdate(
  ctx: RealtimeContext,
  realtimeConv: any,
  included: any[],
  memberUrn: string
): Promise<void> {
  const convEntityUrn = realtimeConv['*conversation'] || realtimeConv.entityUrn || '';
  const conversationId =
    extractConversationId(convEntityUrn) ||
    convEntityUrn.match(/fs_conversation:([\w\-+=/]+)\)?$/)?.[1] ||
    '';

  if (!conversationId) {
    debugLog('warn', `[RT] RealtimeConversation: no conversation ID from ${convEntityUrn}`);
    return;
  }

  // Cross-device star/unstar arrives as a top-level boolean on this entity
  // (captured live — see regression 80). Unlike category-page overlays (which
  // unreliably omit STARRED, hence the merge's never-downgrade rule), this is
  // authoritative per-conversation state, so BOTH directions apply. Runs
  // before the suppression/archived early-returns: a star change must land
  // even for archived threads and during the mark-read echo window.
  if (typeof realtimeConv.starred === 'boolean') {
    const starGuarded =
      (await hasPendingAction(conversationId)) || isMutationSuppressed(conversationId);
    if (!starGuarded && !isStaleContext(ctx)) {
      const newStarred = realtimeConv.starred ? 1 : 0;
      const existing = await ctx.database.conversations.get(conversationId);
      if (existing && (existing.starred ?? 0) !== newStarred) {
        await ctx.database.conversations.update(conversationId, { starred: newStarred });
        debugLog(
          'info',
          `[RT] Star sync: ${conversationId.substring(0, 20)}... starred=${newStarred} (from another client)`
        );
      }
    }
  }

  // unreadConversationsCount is an inbox-wide count, NOT per-conversation.
  // Don't use it to mark individual conversations as read — that's handled
  // by the Dash-format handleDashConversationUpdate and handleReadReceipt.
  const suppressed = shouldSuppressConversationUpdate(conversationId);
  if (suppressed) {
    debugLog('info', `[RT] Suppressed echo for ${conversationId.substring(0, 20)}... (recently marked read)`);
    return;
  }

  // Skip fetching for archived conversations — these are echoes from our own
  // archive actions and would starve on-demand message loads for the conversation
  // the user is actually viewing.
  if (isStaleContext(ctx)) return;
  const conv = await ctx.database.conversations.get(conversationId);
  if (conv?.archived === 1) {
    debugLog('info', `[RT] Skipping fetch for archived conv ${conversationId.substring(0, 20)}...`);
    return;
  }

  debugLog(
    'info',
    `[RT] Conversation update: ${conversationId.substring(0, 20)}... starred=${realtimeConv.starred} action=${realtimeConv.action}`
  );

  // Fetch latest messages to detect genuinely new messages.
  // _doFetchLatest has correct per-conversation read/unread logic.
  fetchLatestForConversation(ctx, conversationId, memberUrn, false).catch((err) => {
    debugLog('error', `[RT] Failed to fetch messages for ${conversationId.substring(0, 20)}...: ${err}`);
  });
}

/** In-flight fetches — deduplicates concurrent fetchLatestForConversation calls for the same conversation. */
const _inflightConvFetches = new Map<string, { promise: Promise<void>; suppressed: boolean }>();

/**
 * Fetch the latest page of messages for a conversation and store them.
 * Used by the RealtimeConversation handler to pick up new messages
 * that the SSE event itself doesn't include.
 *
 * Deduplicated: if a fetch is already in-flight for this conversation,
 * the existing promise is returned instead of starting a new one.
 * Exception: if the new call has a stronger intent (suppress=false) but
 * the in-flight call uses suppress=true, a follow-up is scheduled.
 */
async function fetchLatestForConversation(
  ctx: RealtimeContext,
  conversationId: string,
  memberUrn: string,
  suppressReadChange = false
): Promise<void> {
  const key = `${ctx.dbGeneration}:${conversationId}`;
  const existing = _inflightConvFetches.get(key);
  if (existing) {
    // If we need suppress=false but the in-flight request uses true,
    // schedule a follow-up instead of reusing
    if (!suppressReadChange && existing.suppressed) {
      return existing.promise.then(() =>
        fetchLatestForConversation(ctx, conversationId, memberUrn, false)
      );
    }
    debugLog('info', `[RT] Dedup: reusing in-flight fetch for conv ${conversationId.substring(0, 20)}...`);
    return existing.promise;
  }

  const promise = _doFetchLatest(ctx, conversationId, memberUrn, suppressReadChange).finally(() => {
    _inflightConvFetches.delete(key);
  });
  _inflightConvFetches.set(key, { promise, suppressed: suppressReadChange });
  return promise;
}

async function _doFetchLatest(
  ctx: RealtimeContext,
  conversationId: string,
  memberUrn: string,
  suppressReadChange = false
): Promise<void> {
  if (isStaleContext(ctx)) return;
  const rawPage = await fetchMessages(conversationId, 20, 0, { skipJitter: true });
  if (isStaleContext(ctx)) return;
  const allFetched = normalizeMessages(rawPage, conversationId);

  for (const m of allFetched) {
    if (m.senderUrn === memberUrn) m.isFromMe = true;
  }

  if (allFetched.length === 0) return;

  // Recalled tombstones are never stored; they only feed the reconcile below.
  const messages = withoutRecalled(allFetched);

  // Newness computed BEFORE the write, against stored server timestamps rather
  // than conversation.lastActivityAt — an optimistic send stamps lastActivityAt
  // with the local wall clock, and a fast local clock would otherwise mask a
  // genuine reply arriving right after our own send.
  const newInbound = await findNewInboundMessages(ctx, conversationId, messages);
  if (isStaleContext(ctx)) return;

  await ctx.database.messages.bulkPut(messages);

  // Remove stored copies of messages this fetch no longer returned live within
  // its time range — messages recalled/unsent on LinkedIn disappear live.
  await reconcileRecalledMessages(conversationId, allFetched);

  if (messages.length === 0) return;

  // Update conversation preview text, timestamp, and read status.
  //
  // This fetch runs detached from the SSE event-serialization chain, so the
  // read-modify-write is wrapped in a transaction and re-reads the row inside it.
  // That keeps it atomic against a concurrent message/conversation handler
  // writing the same fields (read/category/lastActivityAt).
  const latest = messages.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  const hasNewInbound = newInbound.length > 0;
  await ctx.database.transaction('rw', ctx.database.conversations, async () => {
    if (isStaleContext(ctx)) return;
    const existing = await ctx.database.conversations.get(conversationId);
    if (!existing) return;
    const updates: Record<string, any> = {
      lastActivityAt: Math.max(latest.createdAt, existing.lastActivityAt),
    };
    if (hasNewInbound || latest.createdAt >= existing.lastActivityAt) {
      updates.lastMessage = latest.body || 'New message';
    }
    if (hasNewInbound && !isMutationSuppressed(conversationId) && existing.category !== 'SPAM') {
      // Always mark as unread for genuinely new messages, even during
      // suppression window — suppression is for read-echoes, not new messages.
      updates.read = 0;
      // Move to Focused and un-archive when someone replies
      if (existing.category !== 'PRIMARY_INBOX') {
        updates.category = 'PRIMARY_INBOX';
      }
      if (existing.archived === 1) {
        updates.archived = 0;
      }
    }
    await ctx.database.conversations.update(conversationId, updates);
  });

  debugLog('info', `[RT] Fetched ${messages.length} messages for conv ${conversationId.substring(0, 20)}...`);
}

// ---------------------------------------------------------------------------
// Included message handler (new Messenger API format)
// ---------------------------------------------------------------------------

/**
 * Decide whether an SSE message is the viewer's own outbound echo.
 *
 * LinkedIn reliably includes the *sender* participant for inbound messages, but
 * frequently OMITS the viewer's own participant from outbound echo events. Even
 * then, the sender REFERENCE usually embeds the sender's fsd_profile URN — a
 * valid profile URN that isn't ours identifies a real other sender (e.g. a
 * group member we haven't stored yet) and MUST stay inbound: claiming it as
 * self would hide the unread flag/notification and rewrite senderUrn to the
 * member URN, breaking dedup against the canonical copy (permanent duplicate).
 *
 * Only a sender we truly cannot identify (no parseable profile URN anywhere,
 * and not a known participant) is treated as our own omitted-self echo —
 * including the very first message to a brand-new contact, where the
 * conversation has no stored participants yet.
 *
 * Returns the corrected isFromMe and a senderUrn aligned to the member URN when
 * self (so the SSE entry dedups against the REST-fetched canonical copy).
 */
async function resolveSelfSender(
  ctx: RealtimeContext,
  conversationId: string,
  senderUrn: string,
  memberUrn: string,
  resolvedFromPayload: boolean,
): Promise<{ isFromMe: boolean; senderUrn: string }> {
  if (senderUrn === memberUrn) return { isFromMe: true, senderUrn: memberUrn };
  // A sender we successfully resolved from the payload that isn't us is genuinely
  // someone else — trust it.
  if (resolvedFromPayload) return { isFromMe: false, senderUrn };
  // The reference itself carries a well-formed profile URN that isn't ours —
  // a real other sender even if their participant entity was omitted.
  if (isValidProfileUrn(senderUrn)) return { isFromMe: false, senderUrn };
  // Garbage/unparseable sender: if it matches a known other participant
  // (legacy rows store such URNs), keep it inbound; otherwise treat it as our
  // own omitted-self echo.
  const conv = await ctx.database.conversations.get(conversationId);
  if (conv?.participantUrns?.includes(senderUrn)) return { isFromMe: false, senderUrn };
  debugLog('info', `[RT] Unresolved sender treated as self for conv ${conversationId.substring(0, 20)}...`);
  return { isFromMe: true, senderUrn: memberUrn };
}

async function handleIncludedMessage(
  ctx: RealtimeContext,
  included: any[],
  memberUrn: string
): Promise<void> {
  // Build participant lookup
  const participantMap = new Map<string, any>();
  for (const entity of included) {
    if (entity.$type === 'com.linkedin.messenger.MessagingParticipant') {
      participantMap.set(entity.entityUrn, entity);
    }
  }

  const messages: Message[] = [];
  const conversationIds = new Set<string>();

  for (const entity of included) {
    if (entity.$type !== 'com.linkedin.messenger.Message') continue;

    const convRef = entity['*conversation'] || '';
    const conversationId = extractConversationId(
      convRef || entity.conversationUrn || ''
    );
    if (!conversationId) continue;

    // Recall/unsend delivered in the new Messenger format — delete local
    // copies instead of storing a tombstone (mirrors the Voyager recall path).
    if (entity.recalledAt || entity.messageBodyRenderFormat === 'RECALLED') {
      const recallSenderRef = entity['*sender'] || entity['*actor'] || '';
      const recallSender = participantMap.get(recallSenderRef);
      const recallProfileId = extractProfileId(recallSender?.hostIdentityUrn || recallSenderRef);
      await removeRecalledMessage(ctx, conversationId, {
        ids: [entity.entityUrn].filter(Boolean),
        createdAt: typeof entity.deliveredAt === 'number' ? entity.deliveredAt : undefined,
        senderUrn:
          recallProfileId && isValidProfileUrn(`urn:li:fsd_profile:${recallProfileId}`)
            ? `urn:li:fsd_profile:${recallProfileId}`
            : undefined,
      });
      continue;
    }

    conversationIds.add(conversationId);

    const senderRef = entity['*sender'] || entity['*actor'] || '';
    const sender = participantMap.get(senderRef);
    const member = sender?.participantType?.member;
    const senderProfileId = extractProfileId(
      sender?.hostIdentityUrn || senderRef
    );
    const self = await resolveSelfSender(
      ctx,
      conversationId,
      `urn:li:fsd_profile:${senderProfileId}`,
      memberUrn,
      !!member,
    );

    const attachments = extractAttachments(entity.renderContent, included);
    const repliedMessage = extractRepliedMessage(entity.renderContent);
    const reactions = extractReactions(entity.reactionSummaries);

    const resolvedName = member
      ? `${member.firstName?.text || ''} ${member.lastName?.text || ''}`.trim()
      : '';

    messages.push({
      id: entity.entityUrn,
      conversationId,
      senderUrn: self.senderUrn,
      senderName: self.isFromMe ? 'You' : (resolvedName || 'Unknown'),
      senderPicture: sender ? getParticipantPicture(sender) : '',
      body: entity.body?.text || '',
      createdAt: entity.deliveredAt || Date.now(),
      isFromMe: self.isFromMe,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(repliedMessage ? { repliedMessage } : {}),
      ...(entity.editedAt ? { editedAt: entity.editedAt } : {}),
      ...(reactions.length > 0 ? { reactions } : {}),
    });
  }

  if (messages.length === 0) return;

  debugLog(
    'info',
    `[RT] New message(s): ${messages.length} in ${conversationIds.size} conversation(s)`
  );

  if (isStaleContext(ctx)) return;

  // Detect genuinely new inbound messages BEFORE writing the batch — LinkedIn
  // re-delivers Message entities for edits/reactions, and those echoes of old
  // messages must not mark the thread unread, un-archive it, or notify.
  const newInboundByConv = new Map<string, Message[]>();
  for (const convId of conversationIds) {
    const convMessages = messages.filter((m) => m.conversationId === convId);
    newInboundByConv.set(convId, await findNewInboundMessages(ctx, convId, convMessages));
  }

  // Write messages to DB
  if (isStaleContext(ctx)) return;
  await ctx.database.messages.bulkPut(messages);
  await cleanupOptimisticMessages(ctx, messages);

  // The event's MessagingParticipant entities include the other party even when
  // the only message is outbound (e.g. sent from another device), so seeding from
  // them avoids a "Unknown" conversation that would otherwise need an API backfill.
  const eventParticipants = extractParticipantsFromIncluded(included, memberUrn);

  // Update parent conversations
  for (const convId of conversationIds) {
    const convMessages = messages.filter((m) => m.conversationId === convId);
    const hasNewInbound = (newInboundByConv.get(convId)?.length ?? 0) > 0;
    await applyInboundMessageToConversation(ctx, convId, convMessages, memberUrn, eventParticipants, hasNewInbound);
  }

  // Update hasAttachments flag if any messages have attachments
  for (const convId of conversationIds) {
    const hasAttach = messages.some(
      (m) => m.conversationId === convId && m.attachments?.length
    );
    if (hasAttach) {
      await ctx.database.conversations.update(convId, { hasAttachments: 1 });
    }
  }

  // Notify UI of genuinely NEW inbound messages for toast notifications
  const newInbound = [...newInboundByConv.values()].flat();
  if (newInbound.length > 0) {
    const latestInbound = newInbound.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    chrome.runtime.sendMessage({
      type: 'INCOMING_MESSAGE',
      id: latestInbound.id,
      senderName: latestInbound.senderName,
      senderPicture: latestInbound.senderPicture,
      body: latestInbound.body,
      conversationId: latestInbound.conversationId,
    }).catch(() => {});
    showNativeNotification(latestInbound);
  }

  // Enrich sender profiles for inbound messages (non-blocking)
  const senderUrns = new Set(messages.filter((m) => !m.isFromMe).map((m) => m.senderUrn));
  for (const urn of senderUrns) {
    enrichProfileIfNeeded(ctx, urn);
  }
}

async function handleSingleMessageEntity(
  ctx: RealtimeContext,
  entity: any,
  memberUrn: string
): Promise<void> {
  const convRef = entity['*conversation'] || entity.conversationUrn || '';
  const conversationId = extractConversationId(convRef);
  if (!conversationId) {
    debugLog('warn', '[RT] Message entity has no conversation reference');
    return;
  }

  const senderRef = entity['*sender'] || entity['*actor'] || '';
  const senderProfileId = extractProfileId(senderRef);
  // Flat events carry no participant data, so the sender is never resolvable here.
  const self = await resolveSelfSender(
    ctx,
    conversationId,
    `urn:li:fsd_profile:${senderProfileId}`,
    memberUrn,
    false,
  );

  const attachments = extractAttachments(entity.renderContent);
  const repliedMessage = extractRepliedMessage(entity.renderContent);
  const reactions = extractReactions(entity.reactionSummaries);

  // DEBUG: log edit/reaction fields from raw entity
  if (entity.editedAt || entity.lastEditedAt || entity.reactionSummaries) {
    debugLog('info', `[RT][EDIT-DEBUG] urn=${entity.entityUrn} editedAt=${entity.editedAt} lastEditedAt=${entity.lastEditedAt} reactionSummaries=${JSON.stringify(entity.reactionSummaries)}`);
  }

  const message: Message = {
    id: entity.entityUrn,
    conversationId,
    senderUrn: self.senderUrn,
    senderName: self.isFromMe ? 'You' : 'Unknown', // no participant data in flat events
    senderPicture: '',
    body: entity.body?.text || '',
    createdAt: entity.deliveredAt || Date.now(),
    isFromMe: self.isFromMe,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(repliedMessage ? { repliedMessage } : {}),
    ...(entity.editedAt ? { editedAt: entity.editedAt } : {}),
    ...(reactions.length > 0 ? { reactions } : {}),
  };

  debugLog(
    'info',
    `[RT] New message in ${conversationId}: ${message.body.substring(0, 60)}`
  );

  if (isStaleContext(ctx)) return;
  // Newness check before the write, then reuse the shared (transactional)
  // conversation-update path — this legacy shape previously did its own
  // non-transactional read-modify-write with no re-delivery guard.
  const newInbound = await findNewInboundMessages(ctx, conversationId, [message]);
  if (isStaleContext(ctx)) return;
  await ctx.database.messages.put(message);
  await cleanupOptimisticMessages(ctx, [message]);
  await applyInboundMessageToConversation(
    ctx,
    conversationId,
    [message],
    memberUrn,
    undefined,
    newInbound.length > 0,
  );
}

// ---------------------------------------------------------------------------
// Optimistic message cleanup
// ---------------------------------------------------------------------------

/**
 * When SSE delivers a message the user sent (isFromMe), delete any matching
 * optimistic temp-* messages so the user doesn't see a brief duplicate.
 */
async function cleanupOptimisticMessages(ctx: RealtimeContext, messages: Message[]): Promise<void> {
  const myMessages = messages.filter((m) => m.isFromMe);
  if (myMessages.length === 0) return;

  // Group by conversation, counting how many SSE messages have each body.
  // This prevents sending "ok" twice → first SSE "ok" deleting both temp messages.
  const byConv = new Map<string, Map<string, number>>();
  for (const m of myMessages) {
    let bodyCounts = byConv.get(m.conversationId);
    if (!bodyCounts) {
      bodyCounts = new Map();
      byConv.set(m.conversationId, bodyCounts);
    }
    bodyCounts.set(m.body, (bodyCounts.get(m.body) || 0) + 1);
  }

  for (const [convId, bodyCounts] of byConv) {
    if (isStaleContext(ctx)) return;
    const all = await ctx.database.messages
      .where('conversationId')
      .equals(convId)
      .toArray();

    // Exclude failed/queued temps — those have no server echo, so a body match
    // here would wrongly drop a send the user still needs to see or retry.
    const tempMessages = all.filter(
      (m) => m.id.startsWith('temp-') && m.status !== 'failed' && m.status !== 'queued'
    );
    const toDelete: string[] = [];
    // Track remaining count per body to limit deletions
    const remaining = new Map(bodyCounts);

    for (const temp of tempMessages) {
      const count = remaining.get(temp.body);
      if (count && count > 0) {
        toDelete.push(temp.id);
        remaining.set(temp.body, count - 1);
      }
    }

    if (toDelete.length > 0) {
      // Preserve repliedMessage from temp messages onto the SSE replacements
      // (SSE events often lack renderContent, so the reply quote would vanish)
      const sseMessages = myMessages.filter((m) => m.conversationId === convId);
      const tempsToDelete = tempMessages.filter((m) => toDelete.includes(m.id));
      for (const temp of tempsToDelete) {
        if (temp.repliedMessage) {
          const sseMatch = sseMessages.find((s) => s.body === temp.body && !s.repliedMessage);
          if (sseMatch) {
            await ctx.database.messages.update(sseMatch.id, { repliedMessage: temp.repliedMessage });
          }
        }
      }

      await ctx.database.messages.bulkDelete(toDelete);
      debugLog('info', `[RT] Replaced ${toDelete.length} optimistic temp message(s) in ${convId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Read receipt handler
// ---------------------------------------------------------------------------

async function handleReadReceipt(ctx: RealtimeContext, data: any): Promise<void> {
  const included = extractIncluded(data);
  const receipts =
    included?.filter(
      (e: any) => e.$type === 'com.linkedin.messenger.SeenReceipt'
    ) || [];

  const entity = data['com.linkedin.messenger.SeenReceipt'] || data.data;
  if (!included && entity) {
    receipts.push(entity);
  }

  for (const receipt of receipts) {
    const msgRef = receipt['*message'] || receipt.messageUrn || '';
    const seenAt = receipt.seenAt;
    if (!msgRef || !seenAt) continue;

    if (isStaleContext(ctx)) return;
    const existing = await ctx.database.messages.get(msgRef);
    if (existing && (!existing.seenAt || seenAt > existing.seenAt)) {
      await ctx.database.messages.update(msgRef, { seenAt });
      debugLog('info', `[RT] Read receipt: ${msgRef} seen at ${seenAt}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Attachment extraction (mirrors voyager-normalizer.ts)
// ---------------------------------------------------------------------------

function extractAttachments(
  renderContent: any[] | undefined,
  included?: any[]
): MessageAttachment[] {
  if (!renderContent || !Array.isArray(renderContent)) return [];

  // Build lookup for referenced entities (ExternalMedia for GIFs)
  const entityMap = new Map<string, any>();
  if (included) {
    for (const e of included) {
      if (e.entityUrn) entityMap.set(e.entityUrn, e);
    }
  }

  const attachments: MessageAttachment[] = [];

  for (const item of renderContent) {
    if (item['*externalMedia']) {
      // GIF (Tenor/Giphy) — stored as a separate ExternalMedia entity
      const ref = item['*externalMedia'];
      const ext = entityMap.get(ref);
      if (ext?.media?.url) {
        attachments.push({
          type: 'gif',
          imageUrl: ext.media.url,
          fallbackText: ext.title || 'GIF',
          width: ext.media.originalWidth || undefined,
          height: ext.media.originalHeight || undefined,
        });
      } else {
        attachments.push({ type: 'gif', fallbackText: 'GIF' });
      }
    } else if (item.vectorImage) {
      const img = item.vectorImage;
      let imageUrl = img.rootUrl || '';
      if (!imageUrl && img.artifacts?.length) {
        imageUrl = img.artifacts[0]?.fileUrl || '';
      }
      if (imageUrl) attachments.push({ type: 'image', imageUrl });
    } else if (item.file) {
      const f = item.file;
      attachments.push({
        type: 'file',
        fileName: f.name || f.fileName || 'File',
        fileUrl: f.url || f.downloadUrl || '',
        fileSize: f.byteSize || f.size || undefined,
        mimeType: f.mediaType || f.mimeType || undefined,
      });
    } else if (item.video) {
      const v = item.video;
      attachments.push({
        type: 'video',
        externalUrl:
          v.progressiveStreams?.[0]?.streamingLocations?.[0]?.url ||
          v.url ||
          '',
        fallbackText: 'Video',
      });
    } else if (item.audio) {
      attachments.push(extractAudioAttachment(item.audio));
    } else if (item.hostUrnData) {
      const h = item.hostUrnData;
      if (h.type === 'PREMIUM_INMAIL' || h.hostUrn?.includes('dummyId'))
        continue;
      const activityMatch = h.hostUrn?.match(/urn:li:activity:(\d+)/);
      const activityId = activityMatch?.[1];
      attachments.push({
        type: 'sharedPost',
        postUrn: h.hostUrn || '',
        externalUrl: activityId
          ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
          : undefined,
        fallbackText:
          h.type === 'FEED_UPDATE' ? 'Shared a post' : h.type || 'Shared content',
      });
    } else if (item.externalMedia) {
      const ext = item.externalMedia;
      attachments.push({
        type: 'externalMedia',
        externalUrl: ext.url || '',
        fallbackText: ext.title || 'External link',
      });
    } else if (item.unavailableContent) {
      attachments.push({
        type: 'unknown',
        fallbackText: 'Content no longer available',
      });
    }
  }

  return attachments;
}

function extractRepliedMessage(
  renderContent: any[] | undefined
): import('@/types/message').RepliedMessage | undefined {
  if (!renderContent || !Array.isArray(renderContent)) return undefined;

  for (const item of renderContent) {
    if (!item.repliedMessageContent) continue;
    const replied = item.repliedMessageContent;
    const body = replied.messageBody?.text || '';
    // SSE events don't include participant entities, so we can't resolve sender name here.
    // The full fetch will fill it in later.
    const messageId = replied.originalMessageUrn || replied['*originalMessage'] || undefined;
    const senderUrn = replied.originalSenderUrn || undefined;
    const sentAt = replied.originalSendAt || undefined;
    return { senderName: '', body, messageId, senderUrn, sentAt };
  }

  return undefined;
}

// extractReactions + getParticipantPicture are shared from '@/lib/voyager-normalizer'
// (imported above). (extractAttachments/extractRepliedMessage intentionally stay
// local — the SSE variants differ: no participantMap, no included[] resolution.)
