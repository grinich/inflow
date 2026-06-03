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
import { normalizeMessages } from '@/lib/voyager-normalizer';
import { debugLog } from '@/lib/debug-log';
import { db } from '@/db/database';
import { ENABLE_PROFILE_ENRICHMENT } from '@/lib/feature-flags';
import { shouldSuppressConversationUpdate, isMutationSuppressed } from './mark-read-suppression';
import { hasPendingAction } from '../sync/pending-guard';
import { extractConversationId } from '@/lib/conversation-urn';

/**
 * Apply an inbound SSE message batch to its parent conversation: bump
 * lastMessage/lastActivityAt and (unless suppressed or a pending optimistic
 * action exists) mark unread + move to Focused + un-archive on a reply. Creates
 * a minimal conversation if none exists yet. Shared by handleNewMessage and
 * handleIncludedMessage (previously copy-pasted in both).
 */
async function applyInboundMessageToConversation(
  convId: string,
  convMessages: any[],
  memberUrn: string,
): Promise<void> {
  const latest = convMessages.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  const existing = await db.conversations.get(convId);
  if (existing) {
    const updates: Record<string, any> = {
      lastMessage: latest.body || 'New message',
      lastActivityAt: Math.max(latest.createdAt, existing.lastActivityAt),
    };
    if (!isMutationSuppressed(convId) && !(await hasPendingAction(convId)) && existing.category !== 'SPAM' && convMessages.some((m) => !m.isFromMe)) {
      updates.read = 0;
      // Move to Focused and un-archive when someone replies
      if (existing.category !== 'PRIMARY_INBOX') updates.category = 'PRIMARY_INBOX';
      if (existing.archived === 1) updates.archived = 0;
    }
    await db.conversations.update(convId, updates);
  } else {
    // Create a minimal conversation so it appears in the list immediately. Use
    // the other party's info (non-self messages). If all messages are from us,
    // backfill participant data from the messages API.
    const senders = convMessages.filter((m) => !m.isFromMe);
    const sender = senders[0];
    await db.conversations.put({
      id: convId,
      participantUrns: sender ? [sender.senderUrn] : [],
      participantNames: sender ? [sender.senderName] : [],
      participantPictures: sender ? [sender.senderPicture] : [],
      lastMessage: latest.body || 'New message',
      lastActivityAt: latest.createdAt,
      read: senders.length > 0 ? 0 : 1,
      archived: 0,
      category: 'PRIMARY_INBOX',
      hasAttachments: convMessages.some((m) => m.attachments?.length) ? 1 : 0,
      starred: 0,
    });
    debugLog('info', `[RT] Created minimal conversation ${convId} from SSE message`);
    // If we don't have participant data (outbound-only), fetch it immediately
    if (!sender) backfillConversationParticipants(convId, memberUrn);
  }
}
import type { Message, MessageAttachment, ReactionSummary } from '@/types/message';

/** Enrich a single profile if it's missing company data. Non-blocking, fire-and-forget. */
function enrichProfileIfNeeded(urn: string): void {
  if (!ENABLE_PROFILE_ENRICHMENT) return;
  db.profiles.get(urn).then(async (p) => {
    if (!p || p.company) return;
    const data = await fetchProfileByUrn(urn);
    if (!data) return;
    const updates: Record<string, string> = {};
    if (data.company) updates.company = data.company;
    if (data.title) updates.title = data.title;
    if (data.companyLogoUrl) updates.companyLogoUrl = data.companyLogoUrl;
    if (data.locationName && !p.location) updates.location = data.locationName;
    if (Object.keys(updates).length > 0) {
      await db.profiles.update(urn, updates);
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
function backfillConversationParticipants(conversationId: string, memberUrn: string): void {
  fetchMessages(conversationId, 1, 0, { skipJitter: true }).then(async (raw) => {
    const included = raw.included || [];
    const participantUrns: string[] = [];
    const participantNames: string[] = [];
    const participantPictures: string[] = [];

    for (const entity of included) {
      if (entity.$type !== 'com.linkedin.messenger.MessagingParticipant') continue;
      const member = entity.participantType?.member;
      if (!member) continue;
      const profileId = extractProfileId(entity.hostIdentityUrn || entity.entityUrn);
      const urn = `urn:li:fsd_profile:${profileId}`;

      // Skip the current user
      if (urn === memberUrn) continue;

      participantUrns.push(urn);
      participantNames.push(
        `${member.firstName?.text || ''} ${member.lastName?.text || ''}`.trim() || 'Unknown'
      );
      participantPictures.push(getParticipantPicture(entity));
    }

    if (participantUrns.length === 0) return;

    // Only update if the conversation still has empty participants
    const conv = await db.conversations.get(conversationId);
    if (conv && conv.participantUrns.length === 0) {
      await db.conversations.update(conversationId, {
        participantUrns,
        participantNames,
        participantPictures,
      });
      debugLog('info', `[RT] Backfilled participants for ${conversationId.substring(0, 20)}...: ${participantNames.join(', ')}`);
    }
  }).catch((err) => {
    debugLog('warn', `[RT] Failed to backfill participants for ${conversationId}: ${err}`);
  });
}

// ---------------------------------------------------------------------------
// Main entry point — called by sse-client for every parsed SSE event
// ---------------------------------------------------------------------------

export async function handleRealtimeEvent(
  eventType: string,
  data: any
): Promise<void> {
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
          await handleIncludedMessage(included, await getMemberUrn());
          return;
        }
        if (hasVoyagerEvents) {
          await handleVoyagerEvent(included, decorated.payload?.data?.value, await getMemberUrn());
          return;
        }
        if (hasReceipts) {
          await handleReadReceipt({ included });
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
          await handleConversationUpdate(realtimeConv, included, await getMemberUrn());
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
          await handleDashConversationUpdate(convEntity);
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
      await handleNewMessage(data);
    } else if (isReadReceiptEvent(data)) {
      await handleReadReceipt(data);
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
function extractProfileId(urn: string): string {
  const match = urn.match(/fsd_profile:([^,)]+)/);
  return match ? match[1] : urn;
}

// ---------------------------------------------------------------------------
// New message handler
// ---------------------------------------------------------------------------

async function handleNewMessage(data: any): Promise<void> {
  const memberUrn = await getMemberUrn();
  const included = extractIncluded(data);

  if (included) {
    await handleIncludedMessage(included, memberUrn);
    return;
  }

  // Flat entity shape
  const msgEntity =
    data['com.linkedin.messenger.Message'] || data.data || data.message;
  if (msgEntity?.entityUrn) {
    await handleSingleMessageEntity(msgEntity, memberUrn);
  }
}

// ---------------------------------------------------------------------------
// Voyager-format message handler (old API, used by SSE events)
// ---------------------------------------------------------------------------

async function handleVoyagerEvent(
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

    const isFromMe = senderUrn === memberUrn;

    // Extract editedAt — Voyager events carry it inside eventContent, not on the entity
    const editedAt = ec.editedAt || ec.lastEditedAt || entity.editedAt || entity.lastEditedAt || undefined;

    // Use dashEntityUrn (urn:li:fsd_message:...) as the ID so it matches
    // the poller's Messenger API format and avoids duplicate entries.
    const messageId = entity.dashEntityUrn || entity.entityUrn;

    messages.push({
      id: messageId,
      conversationId,
      senderUrn,
      senderName,
      senderPicture,
      body,
      createdAt: entity.createdAt || Date.now(),
      isFromMe,
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
      `[RT] SSE message: "${m.body.substring(0, 60)}" from ${m.senderName} (isFromMe=${m.isFromMe}) in conv ${m.conversationId.substring(0, 20)}...`
    );
  }

  if (messages.length > 0) {
    await db.messages.bulkPut(messages);
    await cleanupOptimisticMessages(messages);
  }

  // Update parent conversations
  for (const convId of conversationIds) {
    const convMessages = messages.filter((m) => m.conversationId === convId);
    await applyInboundMessageToConversation(convId, convMessages, memberUrn);
  }

  // Notify UI of inbound messages for toast notifications
  const inbound = messages.filter((m) => !m.isFromMe);
  if (inbound.length > 0) {
    const latest = inbound.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    chrome.runtime.sendMessage({
      type: 'INCOMING_MESSAGE',
      id: latest.id,
      senderName: latest.senderName,
      senderPicture: latest.senderPicture,
      body: latest.body,
      conversationId: latest.conversationId,
    }).catch(() => {});
  }

  // Enrich sender profiles for inbound messages (non-blocking)
  const senderUrns = new Set(inbound.map((m) => m.senderUrn));
  for (const urn of senderUrns) {
    enrichProfileIfNeeded(urn);
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
async function handleDashConversationUpdate(convEntity: any): Promise<void> {
  const convId = extractConversationId(convEntity.entityUrn || '');
  if (!convId) return;

  const isRead = convEntity.read === true;
  // Honor BOTH suppression windows: mark-read (recordMarkRead) AND mutation
  // (recordMutation, e.g. MARK_UNREAD) — otherwise a stale read=true Dash echo
  // reverts a just-applied optimistic Mark-Unread.
  const suppressed = shouldSuppressConversationUpdate(convId) || isMutationSuppressed(convId);

  debugLog(
    'info',
    `[RT] Dash conversation update: ${convId.substring(0, 20)}... read=${convEntity.read} unreadCount=${convEntity.unreadCount} lastReadAt=${convEntity.lastReadAt}${suppressed ? ' (suppressed)' : ''}`
  );

  if (suppressed) return;

  const existing = await db.conversations.get(convId);
  if (!existing) return;

  const newRead = isRead ? 1 : 0;
  if (existing.read !== newRead) {
    await db.conversations.update(convId, { read: newRead });
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
  realtimeConv: any,
  included: any[],
  memberUrn: string
): Promise<void> {
  const convEntityUrn = realtimeConv['*conversation'] || realtimeConv.entityUrn || '';
  const convIdMatch = convEntityUrn.match(/(?:fs_conversation:|msg_conversation:.*,)([\w\-+=]+)\)?$/);
  const conversationId = convIdMatch ? convIdMatch[1] : '';

  if (!conversationId) {
    debugLog('warn', `[RT] RealtimeConversation: no conversation ID from ${convEntityUrn}`);
    return;
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
  const conv = await db.conversations.get(conversationId);
  if (conv?.archived === 1) {
    debugLog('info', `[RT] Skipping fetch for archived conv ${conversationId.substring(0, 20)}...`);
    return;
  }

  debugLog('info', `[RT] Conversation update: ${conversationId.substring(0, 20)}...`);

  // Fetch latest messages to detect genuinely new messages.
  // _doFetchLatest has correct per-conversation read/unread logic.
  fetchLatestForConversation(conversationId, memberUrn, false).catch((err) => {
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
  conversationId: string,
  memberUrn: string,
  suppressReadChange = false
): Promise<void> {
  const existing = _inflightConvFetches.get(conversationId);
  if (existing) {
    // If we need suppress=false but the in-flight request uses true,
    // schedule a follow-up instead of reusing
    if (!suppressReadChange && existing.suppressed) {
      return existing.promise.then(() =>
        fetchLatestForConversation(conversationId, memberUrn, false)
      );
    }
    debugLog('info', `[RT] Dedup: reusing in-flight fetch for conv ${conversationId.substring(0, 20)}...`);
    return existing.promise;
  }

  const promise = _doFetchLatest(conversationId, memberUrn, suppressReadChange).finally(() => {
    _inflightConvFetches.delete(conversationId);
  });
  _inflightConvFetches.set(conversationId, { promise, suppressed: suppressReadChange });
  return promise;
}

async function _doFetchLatest(
  conversationId: string,
  memberUrn: string,
  suppressReadChange = false
): Promise<void> {
  const rawPage = await fetchMessages(conversationId, 20, 0, { skipJitter: true });
  const messages = normalizeMessages(rawPage, conversationId);

  for (const m of messages) {
    if (m.senderUrn === memberUrn) m.isFromMe = true;
  }

  if (messages.length === 0) return;

  await db.messages.bulkPut(messages);

  // Update conversation preview text, timestamp, and read status.
  // Only mark as unread if there is a genuinely new inbound message
  // (createdAt newer than what we had, and not from us).
  const latest = messages.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
  const existing = await db.conversations.get(conversationId);
  if (existing) {
    const updates: Record<string, any> = {
      lastMessage: latest.body || 'New message',
      lastActivityAt: Math.max(latest.createdAt, existing.lastActivityAt),
    };
    // Check if any fetched message is newer than what the conversation had
    // and is from someone else — only then mark as unread.
    const hasNewInbound = messages.some(
      (m) => !m.isFromMe && m.createdAt > existing.lastActivityAt
    );
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
    await db.conversations.update(conversationId, updates);
  }

  debugLog('info', `[RT] Fetched ${messages.length} messages for conv ${conversationId.substring(0, 20)}...`);
}

// ---------------------------------------------------------------------------
// Included message handler (new Messenger API format)
// ---------------------------------------------------------------------------

async function handleIncludedMessage(
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

    conversationIds.add(conversationId);

    const senderRef = entity['*sender'] || entity['*actor'] || '';
    const sender = participantMap.get(senderRef);
    const member = sender?.participantType?.member;
    const senderProfileId = extractProfileId(
      sender?.hostIdentityUrn || senderRef
    );
    const senderUrn = `urn:li:fsd_profile:${senderProfileId}`;

    const attachments = extractAttachments(entity.renderContent, included);
    const repliedMessage = extractRepliedMessage(entity.renderContent);
    const reactions = extractReactionSummaries(entity.reactionSummaries);



    messages.push({
      id: entity.entityUrn,
      conversationId,
      senderUrn,
      senderName: member
        ? `${member.firstName?.text || ''} ${member.lastName?.text || ''}`.trim()
        : 'Unknown',
      senderPicture: sender ? getParticipantPicture(sender) : '',
      body: entity.body?.text || '',
      createdAt: entity.deliveredAt || Date.now(),
      isFromMe: senderUrn === memberUrn,
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

  // Write messages to DB
  await db.messages.bulkPut(messages);
  await cleanupOptimisticMessages(messages);

  // Update parent conversations
  for (const convId of conversationIds) {
    const convMessages = messages.filter((m) => m.conversationId === convId);
    await applyInboundMessageToConversation(convId, convMessages, memberUrn);
  }

  // Update hasAttachments flag if any messages have attachments
  for (const convId of conversationIds) {
    const hasAttach = messages.some(
      (m) => m.conversationId === convId && m.attachments?.length
    );
    if (hasAttach) {
      await db.conversations.update(convId, { hasAttachments: 1 });
    }
  }

  // Notify UI of inbound messages for toast notifications
  const inboundMsgs = messages.filter((m) => !m.isFromMe);
  if (inboundMsgs.length > 0) {
    const latestInbound = inboundMsgs.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    chrome.runtime.sendMessage({
      type: 'INCOMING_MESSAGE',
      id: latestInbound.id,
      senderName: latestInbound.senderName,
      senderPicture: latestInbound.senderPicture,
      body: latestInbound.body,
      conversationId: latestInbound.conversationId,
    }).catch(() => {});
  }

  // Enrich sender profiles for inbound messages (non-blocking)
  const senderUrns = new Set(inboundMsgs.map((m) => m.senderUrn));
  for (const urn of senderUrns) {
    enrichProfileIfNeeded(urn);
  }
}

async function handleSingleMessageEntity(
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
  const senderUrn = `urn:li:fsd_profile:${senderProfileId}`;

  const attachments = extractAttachments(entity.renderContent);
  const repliedMessage = extractRepliedMessage(entity.renderContent);
  const reactions = extractReactionSummaries(entity.reactionSummaries);

  // DEBUG: log edit/reaction fields from raw entity
  if (entity.editedAt || entity.lastEditedAt || entity.reactionSummaries) {
    debugLog('info', `[RT][EDIT-DEBUG] urn=${entity.entityUrn} editedAt=${entity.editedAt} lastEditedAt=${entity.lastEditedAt} reactionSummaries=${JSON.stringify(entity.reactionSummaries)}`);
  }

  const message: Message = {
    id: entity.entityUrn,
    conversationId,
    senderUrn,
    senderName: 'Unknown', // no participant data in flat events
    senderPicture: '',
    body: entity.body?.text || '',
    createdAt: entity.deliveredAt || Date.now(),
    isFromMe: senderUrn === memberUrn,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(repliedMessage ? { repliedMessage } : {}),
    ...(entity.editedAt ? { editedAt: entity.editedAt } : {}),
    ...(reactions.length > 0 ? { reactions } : {}),
  };

  debugLog(
    'info',
    `[RT] New message in ${conversationId}: ${message.body.substring(0, 60)}`
  );

  await db.messages.put(message);
  await cleanupOptimisticMessages([message]);

  // Update conversation
  const existing = await db.conversations.get(conversationId);
  if (existing) {
    const updates: Record<string, any> = {
      lastMessage: message.body || 'New message',
      lastActivityAt: Math.max(message.createdAt, existing.lastActivityAt),
    };
    if (!message.isFromMe && !isMutationSuppressed(conversationId)) {
      updates.read = 0;
      // Move to Focused and un-archive when someone replies
      if (existing.category !== 'PRIMARY_INBOX') {
        updates.category = 'PRIMARY_INBOX';
      }
      if (existing.archived === 1) {
        updates.archived = 0;
      }
    }
    await db.conversations.update(conversationId, updates);
  }
}

// ---------------------------------------------------------------------------
// Optimistic message cleanup
// ---------------------------------------------------------------------------

/**
 * When SSE delivers a message the user sent (isFromMe), delete any matching
 * optimistic temp-* messages so the user doesn't see a brief duplicate.
 */
async function cleanupOptimisticMessages(messages: Message[]): Promise<void> {
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
    const all = await db.messages
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
            await db.messages.update(sseMatch.id, { repliedMessage: temp.repliedMessage });
          }
        }
      }

      await db.messages.bulkDelete(toDelete);
      debugLog('info', `[RT] Replaced ${toDelete.length} optimistic temp message(s) in ${convId}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Read receipt handler
// ---------------------------------------------------------------------------

async function handleReadReceipt(data: any): Promise<void> {
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

    const existing = await db.messages.get(msgRef);
    if (existing && (!existing.seenAt || seenAt > existing.seenAt)) {
      await db.messages.update(msgRef, { seenAt });
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
      attachments.push({
        type: 'audio',
        externalUrl: item.audio.url || '',
        fallbackText: 'Audio message',
      });
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

// ---------------------------------------------------------------------------
// Reaction summary extraction
// ---------------------------------------------------------------------------

function extractReactionSummaries(reactionSummaries: any[] | undefined): ReactionSummary[] {
  if (!reactionSummaries || !Array.isArray(reactionSummaries)) return [];
  return reactionSummaries
    .filter((r: any) => r.emoji)
    .map((r: any) => ({
      emoji: r.emoji,
      count: r.count || 1,
      firstReactedAt: r.firstReactedAt || 0,
      viewerReacted: !!r.viewerReacted,
    }));
}

// ---------------------------------------------------------------------------
// Participant picture extraction (mirrors voyager-normalizer.ts)
// ---------------------------------------------------------------------------

function getParticipantPicture(participant: any): string {
  const member = participant.participantType?.member;
  if (!member?.profilePicture) return '';

  const pic = member.profilePicture;

  if (pic.artifacts?.length) {
    const artifacts = pic.artifacts;
    const artifact =
      artifacts
        .sort((a: any, b: any) => (a.width || 0) - (b.width || 0))
        .find((a: any) => (a.width || 0) >= 100) || artifacts[0];
    if (artifact?.fileUrl) return artifact.fileUrl;
    if (pic.rootUrl && artifact?.fileIdentifyingUrlPathSegment) {
      return `${pic.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
    }
  }

  const vectorImage =
    pic.displayImageReference?.vectorImage || pic.vectorImage;
  if (vectorImage?.rootUrl && vectorImage?.artifacts?.length) {
    const artifact =
      vectorImage.artifacts
        .sort((a: any, b: any) => (a.width || 0) - (b.width || 0))
        .find((a: any) => (a.width || 0) >= 100) ||
      vectorImage.artifacts[0];
    if (artifact?.fileIdentifyingUrlPathSegment) {
      return `${vectorImage.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
    }
  }

  return '';
}
