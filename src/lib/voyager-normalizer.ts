import type { Conversation } from '@/types/conversation';
import type { Message, MessageAttachment, RepliedMessage, ReactionSummary } from '@/types/message';
import type { Profile } from '@/types/profile';
import type { VoyagerResponse, VoyagerEntity } from '@/types/voyager';

/**
 * Extract conversation thread ID from a full entityUrn.
 * "urn:li:msg_conversation:(urn:li:fsd_profile:XXX,2-abc123)" -> "2-abc123"
 */
function extractConversationId(entityUrn: string): string {
  const match = entityUrn.match(/,([\w+-]+=*)[\)]*$/);
  return match ? match[1] : entityUrn;
}

/**
 * Extract profile member ID from various URN formats.
 * "urn:li:fsd_profile:ABC" -> "ABC"
 * "urn:li:msg_messagingParticipant:urn:li:fsd_profile:ABC" -> "ABC"
 */
function extractProfileId(urn: string): string {
  const match = urn.match(/fsd_profile:([^,)]+)/);
  return match ? match[1] : urn;
}

function getParticipantPicture(participant: VoyagerEntity): string {
  const member = participant.participantType?.member;
  if (!member?.profilePicture) return '';

  const pic = member.profilePicture;

  // Format 1: artifacts with fileUrl
  if (pic.artifacts?.length) {
    const artifacts = pic.artifacts;
    const artifact = artifacts.sort((a: any, b: any) => (a.width || 0) - (b.width || 0)).find((a: any) => (a.width || 0) >= 100) || artifacts[0];
    if (artifact?.fileUrl) return artifact.fileUrl;
    // Format 2: rootUrl + fileIdentifyingUrlPathSegment
    if (pic.rootUrl && artifact?.fileIdentifyingUrlPathSegment) {
      return `${pic.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
    }
  }

  // Format 3: displayImageReference or displayImageUrn with vectorImage
  const vectorImage = pic.displayImageReference?.vectorImage || pic.vectorImage;
  if (vectorImage?.rootUrl && vectorImage?.artifacts?.length) {
    const artifact = vectorImage.artifacts.sort((a: any, b: any) => (a.width || 0) - (b.width || 0)).find((a: any) => (a.width || 0) >= 100) || vectorImage.artifacts[0];
    if (artifact?.fileIdentifyingUrlPathSegment) {
      return `${vectorImage.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
    }
  }

  return '';
}

export function normalizeConversations(raw: VoyagerResponse, myMemberUrn?: string): {
  conversations: Conversation[];
  profiles: Profile[];
} {
  const profiles: Profile[] = [];
  const participantMap = new Map<string, VoyagerEntity>();
  const messageMap = new Map<string, VoyagerEntity>(); // conversationUrn -> latest message

  for (const entity of raw.included || []) {
    if (entity.$type === 'com.linkedin.messenger.MessagingParticipant') {
      participantMap.set(entity.entityUrn, entity);
      // Build profile from participant data
      const member = entity.participantType?.member;
      if (member) {
        const profileId = extractProfileId(entity.hostIdentityUrn || entity.entityUrn);
        profiles.push({
          urn: `urn:li:fsd_profile:${profileId}`,
          publicId: member.profileUrl?.split('/in/')?.[1] || profileId,
          firstName: member.firstName?.text || '',
          lastName: member.lastName?.text || '',
          fullName: `${member.firstName?.text || ''} ${member.lastName?.text || ''}`.trim(),
          occupation: member.headline?.text || '',
          location: member.location?.text || member.geoLocation?.text || '',
          pictureUrl: getParticipantPicture(entity),
        });
      }
    } else if (entity.$type === 'com.linkedin.messenger.Message') {
      const convUrn = entity['*conversation'];
      if (convUrn) {
        const existing = messageMap.get(convUrn);
        if (!existing || (entity.deliveredAt || 0) > (existing.deliveredAt || 0)) {
          messageMap.set(convUrn, entity);
        }
      }
    }
  }

  const conversationEntities = (raw.included || []).filter(
    (e) => e.$type === 'com.linkedin.messenger.Conversation'
  );

  const conversations: Conversation[] = conversationEntities.map((conv) => {
    const participantRefs: string[] = conv['*conversationParticipants'] || [];
    const participantUrns: string[] = [];
    const participantNames: string[] = [];
    const participantPictures: string[] = [];

    for (const ref of participantRefs) {
      const participant = participantMap.get(ref);
      if (participant) {
        const member = participant.participantType?.member;
        const profileId = extractProfileId(participant.hostIdentityUrn || ref);
        const urn = `urn:li:fsd_profile:${profileId}`;

        // Skip the current user — only show other participants
        if (myMemberUrn && urn === myMemberUrn) continue;

        participantUrns.push(urn);
        participantNames.push(
          `${member?.firstName?.text || ''} ${member?.lastName?.text || ''}`.trim() || 'Unknown'
        );
        participantPictures.push(getParticipantPicture(participant));
      }
    }

    // Get last message preview — fall back to attachment description if no text
    const latestMsg = messageMap.get(conv.entityUrn);
    const lastMessage = latestMsg?.body?.text || lastMessageFallback(latestMsg);

    const convId = extractConversationId(conv.entityUrn);

    return {
      id: convId,
      participantUrns,
      participantNames,
      participantPictures,
      lastMessage,
      lastActivityAt: conv.lastActivityAt || 0,
      read: (conv.unreadCount || 0) === 0 ? 1 : 0,
      archived: conv.categories?.includes('ARCHIVE') ? 1 : 0,
      // Only assign a category the inbox tabs can route to. INMAIL/OTHER-only
      // threads would otherwise match no tab and silently vanish from the UI, so
      // fold them into the "Other" (SECONDARY_INBOX) tab. ARCHIVE is surfaced via
      // the `archived` flag, so its category value is not tab-queried.
      category:
        conv.categories?.find(
          (c: string) => c === 'PRIMARY_INBOX' || c === 'SECONDARY_INBOX' || c === 'SPAM' || c === 'ARCHIVE',
        ) ?? (conv.categories?.some((c: string) => c === 'INMAIL' || c === 'OTHER') ? 'SECONDARY_INBOX' : 'PRIMARY_INBOX'),
      starred: conv.categories ? (conv.categories.includes('STARRED') ? 1 : 0) : undefined,
    };
  });

  return { conversations, profiles };
}

export function normalizeMessages(raw: VoyagerResponse, conversationId: string): Message[] {
  const messages: Message[] = [];

  // Build participant lookup
  const participantMap = new Map<string, VoyagerEntity>();
  for (const entity of raw.included || []) {
    if (entity.$type === 'com.linkedin.messenger.MessagingParticipant') {
      participantMap.set(entity.entityUrn, entity);
    }
  }

  for (const entity of raw.included || []) {
    if (entity.$type !== 'com.linkedin.messenger.Message') continue;

    const senderRef = entity['*sender'] || entity['*actor'] || '';
    const sender = participantMap.get(senderRef);
    const member = sender?.participantType?.member;
    const senderProfileId = extractProfileId(sender?.hostIdentityUrn || senderRef);

    const attachments = extractAttachments(entity.renderContent, raw.included);
    const repliedMessage = extractRepliedMessage(entity.renderContent, participantMap);

    const editedAt = entity.editedAt || entity.lastEditedAt || undefined;

    // Extract seen receipts — LinkedIn may include seenReceipts on the message entity
    let seenAt: number | undefined;
    if (entity.seenReceipts?.length) {
      // Use the latest receipt, not the first — in group threads receipts aren't ordered.
      seenAt = entity.seenReceipts.reduce(
        (mx: number, r: any) => Math.max(mx, r?.seenAt || 0),
        0,
      ) || undefined;
    } else if (entity['*seenReceipts']?.length) {
      // References to separate SeenReceipt entities — resolve below
    }

    // Extract reaction summaries
    const reactions = extractReactions(entity.reactionSummaries);

    messages.push({
      id: entity.entityUrn,
      conversationId,
      senderUrn: `urn:li:fsd_profile:${senderProfileId}`,
      senderName: member
        ? `${member.firstName?.text || ''} ${member.lastName?.text || ''}`.trim()
        : 'Unknown',
      senderPicture: sender ? getParticipantPicture(sender) : '',
      body: entity.body?.text || '',
      createdAt: entity.deliveredAt || 0,
      isFromMe: false, // Set by sync-engine based on memberUrn
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(repliedMessage ? { repliedMessage } : {}),
      ...(editedAt ? { editedAt } : {}),
      ...(seenAt ? { seenAt } : {}),
      ...(reactions.length > 0 ? { reactions } : {}),
    });
  }

  // Resolve SeenReceipt entities from included data
  const receiptMap = new Map<string, number>();
  for (const entity of raw.included || []) {
    if (entity.$type === 'com.linkedin.messenger.SeenReceipt') {
      const msgRef = entity['*message'] || entity.messageUrn || '';
      if (msgRef && entity.seenAt) {
        const existing = receiptMap.get(msgRef);
        if (!existing || entity.seenAt > existing) {
          receiptMap.set(msgRef, entity.seenAt);
        }
      }
    }
  }
  if (receiptMap.size > 0) {
    for (const msg of messages) {
      if (!msg.seenAt) {
        const seen = receiptMap.get(msg.id);
        if (seen) msg.seenAt = seen;
      }
    }
  }

  return messages.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Generate a fallback preview string when a message has no body text.
 * Inspects renderContent to describe the attachment type.
 */
function lastMessageFallback(msg: VoyagerEntity | undefined): string {
  if (!msg) return '';
  const rc = msg.renderContent;
  if (!Array.isArray(rc) || rc.length === 0) return '';

  const item = rc[0];
  if (item.vectorImage) return 'Sent an image';
  if (item.file) return `Sent a file: ${item.file.name || item.file.fileName || 'File'}`;
  if (item.video) return 'Sent a video';
  if (item.audio) return 'Sent an audio message';
  if (item.hostUrnData) return 'Shared a post';
  if (item.externalMedia) return item.externalMedia.title || 'Shared a link';
  if (item['*externalMedia']) return 'Sent a GIF';
  if (item.repliedMessageContent) return msg.body?.text || 'Replied to a message';
  if (item.unavailableContent) return 'Content no longer available';
  return '';
}

/**
 * Extract structured attachments from a message's renderContent array.
 * Each renderContent item has multiple nullable fields — exactly one is non-null.
 * `included` is the full response included array, used to resolve entity references.
 */
function extractAttachments(renderContent: any[] | undefined, included?: any[]): MessageAttachment[] {
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
      // Inline image
      const img = item.vectorImage;
      let imageUrl = img.rootUrl || '';
      // If rootUrl has artifacts, build full URL (but LinkedIn usually gives complete rootUrl for messaging images)
      if (!imageUrl && img.artifacts?.length) {
        const artifact = img.artifacts[0];
        if (artifact?.fileUrl) imageUrl = artifact.fileUrl;
      }
      if (imageUrl) {
        attachments.push({ type: 'image', imageUrl });
      }
    } else if (item.file) {
      // File attachment
      const f = item.file;
      attachments.push({
        type: 'file',
        fileName: f.name || f.fileName || 'File',
        fileUrl: f.url || f.downloadUrl || '',
        fileSize: f.byteSize || f.size || undefined,
        mimeType: f.mediaType || f.mimeType || undefined,
      });
    } else if (item.video) {
      // Video attachment
      const v = item.video;
      attachments.push({
        type: 'video',
        externalUrl: v.progressiveStreams?.[0]?.streamingLocations?.[0]?.url || v.url || '',
        fallbackText: 'Video',
      });
    } else if (item.audio) {
      // Audio message
      attachments.push({
        type: 'audio',
        externalUrl: item.audio.url || '',
        fallbackText: 'Audio message',
      });
    } else if (item.hostUrnData) {
      const h = item.hostUrnData;
      // Skip non-post metadata like PREMIUM_INMAIL — these are delivery indicators, not real attachments
      if (h.type === 'PREMIUM_INMAIL' || h.hostUrn?.includes('dummyId')) {
        continue;
      }
      // Shared LinkedIn post — extract the activity ID from the hostUrn for linking
      const activityMatch = h.hostUrn?.match(/urn:li:activity:(\d+)/);
      const activityId = activityMatch?.[1];
      attachments.push({
        type: 'sharedPost',
        postUrn: h.hostUrn || '',
        externalUrl: activityId
          ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
          : undefined,
        fallbackText: h.type === 'FEED_UPDATE' ? 'Shared a post' : h.type || 'Shared content',
      });
    } else if (item.externalMedia) {
      // External link/media (inline, not a reference)
      const ext = item.externalMedia;
      attachments.push({
        type: 'externalMedia',
        externalUrl: ext.url || '',
        fallbackText: ext.title || 'External link',
      });
    } else if (item.unavailableContent) {
      // Deleted/unavailable
      attachments.push({
        type: 'unknown',
        fallbackText: 'Content no longer available',
      });
    }
    // Skip: videoMeeting, conversationAdsMessageContent, callMessageContent,
    // forwardedMessageContent, awayMessage, messageAdRenderContent
    // repliedMessageContent is handled separately by extractRepliedMessage()
  }

  return attachments;
}

/**
 * Extract reaction summaries from a message entity's reactionSummaries field.
 */
function extractReactions(reactionSummaries: any[] | undefined): ReactionSummary[] {
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

/**
 * Extract replied/quoted message data from renderContent.
 */
function extractRepliedMessage(
  renderContent: any[] | undefined,
  participantMap: Map<string, VoyagerEntity>
): RepliedMessage | undefined {
  if (!renderContent || !Array.isArray(renderContent)) return undefined;

  for (const item of renderContent) {
    if (!item.repliedMessageContent) continue;
    const replied = item.repliedMessageContent;
    const body = replied.messageBody?.text || '';

    // Resolve sender name from participant reference
    let senderName = 'Unknown';
    let senderUrn: string | undefined;
    const senderRef = replied['*originalSender'];
    if (senderRef) {
      const sender = participantMap.get(senderRef);
      const member = sender?.participantType?.member;
      if (member) {
        senderName = `${member.firstName?.text || ''} ${member.lastName?.text || ''}`.trim() || 'Unknown';
      }
      // Extract sender URN from participant's hostIdentityUrn
      const profileId = extractProfileId(sender?.hostIdentityUrn || senderRef);
      senderUrn = `urn:li:fsd_profile:${profileId}`;
    }
    // Also check for direct sender URN field
    if (!senderUrn && replied.originalSenderUrn) {
      senderUrn = replied.originalSenderUrn;
    }

    // Extract original message URN
    const messageId = replied.originalMessageUrn || replied['*originalMessage'] || undefined;

    // Extract original sent timestamp
    const sentAt = replied.originalSendAt || undefined;

    return { senderName, body, messageId, senderUrn, sentAt };
  }

  return undefined;
}
