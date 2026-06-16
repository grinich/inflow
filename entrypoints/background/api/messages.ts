import { voyagerFetch } from './client';
import { getMemberUrn } from '../auth/session';
import { linkedInVariables } from './encode';
import { debugLog } from '@/lib/debug-log';
import { findConversationByRecipients } from './conversations';
import { extractConversationId } from '@/lib/conversation-urn';
import type { VoyagerResponse } from './types';
import type { BridgeAttachment } from '@/types/bridge';

const MESSAGE_PAGE_SIZE = 20;

/** Try to extract a user-visible error message from LinkedIn's JSON error response. */
function tryParseLinkedInError(body: string, status: number): string | null {
  try {
    const data = JSON.parse(body);
    if (data.message) return data.message;
  } catch {}
  if (status === 400) {
    return 'Unable to send — you may not be connected to this person';
  }
  return null;
}

// In-flight deduplication: concurrent callers for the same conversation share one fetch chain
const inflightFetches = new Map<string, Promise<VoyagerResponse[]>>();

/**
 * Fetch a single page of messages for a conversation.
 * Supports pagination via count/start parameters.
 * Pass skipJitter=true for user-initiated fetches to avoid the jitter delay.
 */
export async function fetchMessages(
  conversationId: string,
  count = MESSAGE_PAGE_SIZE,
  start = 0,
  { skipJitter = false } = {}
): Promise<VoyagerResponse> {
  const memberUrn = await getMemberUrn();
  const conversationUrn = `urn:li:msg_conversation:(${memberUrn},${conversationId})`;
  const variables = linkedInVariables({
    conversationUrn,
    count,
    start,
  });
  const res = await voyagerFetch(
    `/voyagerMessagingGraphQL/graphql?queryId=messengerMessages.5846eeb71c981f11e0134cb6626cc314&variables=${variables}`,
    { skipJitter }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch messages: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch all messages for a conversation by paginating through results.
 * Stops when we get fewer results than requested or hit maxPages.
 * Deduplicates concurrent calls for the same conversation — if a fetch is
 * already in flight, callers share the same promise.
 */
export async function fetchAllMessages(
  conversationId: string,
  maxPages = 10,
  { skipJitter = false } = {}
): Promise<VoyagerResponse[]> {
  const existing = inflightFetches.get(conversationId);
  if (existing) {
    debugLog('info', `fetchAllMessages: dedup hit for ${conversationId.substring(0, 20)}...`);
    return existing;
  }

  const promise = (async () => {
    const pages: VoyagerResponse[] = [];
    for (let page = 0; page < maxPages; page++) {
      const res = await fetchMessages(conversationId, MESSAGE_PAGE_SIZE, page * MESSAGE_PAGE_SIZE, { skipJitter });
      pages.push(res);

      // LinkedIn often returns fewer items than requested even when more exist.
      // Only stop when we get 0 messages.
      const messageCount = (res.included || []).filter(
        (e: any) => e.$type === 'com.linkedin.messenger.Message'
      ).length;
      if (messageCount === 0) break;
    }
    return pages;
  })();

  inflightFetches.set(conversationId, promise);
  // Not .finally(): that returns a new promise that rejects alongside the
  // original with no handler, surfacing an unhandledRejection on every failed
  // fetch even though the caller handles `promise` itself.
  const cleanup = () => inflightFetches.delete(conversationId);
  promise.then(cleanup, cleanup);

  return promise;
}

/**
 * Upload a file to LinkedIn's messaging media upload service.
 * Returns the asset URN to reference in a message's renderContentUnions.
 *
 * Flow:
 * 1. Register via voyagerVideoDashMediaUploadMetadata to get upload URL + asset URN
 * 2. PUT the raw bytes to the singleUploadUrl with any required headers
 */
async function uploadFile(attachment: BridgeAttachment): Promise<string> {
  const isImage = attachment.type.startsWith('image/');
  const mediaUploadType = isImage ? 'MESSAGING_PHOTO_ATTACHMENT' : 'MESSAGING_FILE_ATTACHMENT';

  debugLog('info', `uploadFile: registering ${attachment.name} (${attachment.type}, ${attachment.size} bytes)`);

  // Step 1: Register the upload
  const registerRes = await voyagerFetch(
    '/voyagerVideoDashMediaUploadMetadata?action=upload',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        mediaUploadType,
        fileSize: attachment.size,
        filename: attachment.name,
      }),
    }
  );

  if (!registerRes.ok) {
    const errBody = await registerRes.clone().text().catch(() => '');
    debugLog('error', `uploadFile register failed ${registerRes.status}: ${errBody.substring(0, 300)}`);
    throw new Error(`Upload registration failed: ${registerRes.status}`);
  }

  const registerData = await registerRes.json();
  const value = registerData.data?.value || registerData.value || registerData;

  const uploadUrl = value.singleUploadUrl;
  const assetUrn = value.urn;
  const extraHeaders: Record<string, string> = value.singleUploadHeaders || {};

  if (!uploadUrl || !assetUrn) {
    debugLog('error', `uploadFile: missing uploadUrl or urn in: ${JSON.stringify(registerData).substring(0, 800)}`);
    throw new Error('Upload registration did not return upload URL');
  }

  debugLog('info', `uploadFile: uploading to ${uploadUrl.substring(0, 100)}...`);

  // Step 2: Decode base64 and PUT raw bytes
  const binaryStr = atob(attachment.dataBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      ...extraHeaders,
    },
    body: bytes,
  });

  if (!uploadRes.ok) {
    const errBody = await uploadRes.clone().text().catch(() => '');
    debugLog('error', `uploadFile PUT failed ${uploadRes.status}: ${errBody.substring(0, 300)}`);
    throw new Error(`File upload failed: ${uploadRes.status}`);
  }

  debugLog('info', `uploadFile: success, assetUrn=${assetUrn}`);
  return assetUrn;
}

export async function sendMessage(
  conversationId: string,
  body: string,
  attachments?: BridgeAttachment[],
  replyTo?: { messageUrn: string; senderUrn: string; sentAt: number; body: string }
): Promise<void> {
  const memberUrn = await getMemberUrn();
  const conversationUrn = `urn:li:msg_conversation:(${memberUrn},${conversationId})`;

  const originToken = crypto.randomUUID();

  // trackingId must be 16 random bytes encoded as a string
  const trackingBytes = new Uint8Array(16);
  crypto.getRandomValues(trackingBytes);
  const trackingId = String.fromCharCode(...trackingBytes);

  // Upload any attachments and build renderContentUnions
  const renderContentUnions: any[] = [];
  if (replyTo) {
    // LinkedIn expects the sender URN in msg_messagingParticipant format
    const senderParticipantUrn = replyTo.senderUrn.startsWith('urn:li:msg_messagingParticipant:')
      ? replyTo.senderUrn
      : `urn:li:msg_messagingParticipant:${replyTo.senderUrn}`;
    renderContentUnions.push({
      repliedMessageContent: {
        originalSenderUrn: senderParticipantUrn,
        originalSendAt: replyTo.sentAt,
        originalMessageUrn: replyTo.messageUrn,
        messageBody: {
          _type: 'com.linkedin.pemberly.text.AttributedText',
          _recipeType: 'com.linkedin.1ea7e24db829a1347b841f2dd496da36',
          attributes: [],
          text: replyTo.body,
        },
      },
    });
  }
  if (attachments?.length) {
    for (const att of attachments) {
      const assetUrn = await uploadFile(att);
      renderContentUnions.push({
        file: {
          assetUrn,
          byteSize: att.size,
          mediaType: att.type,
          name: att.name,
        },
      });
    }
  }

  const payload = {
    message: {
      body: {
        attributes: [],
        text: body,
      },
      renderContentUnions,
      conversationUrn,
      originToken,
    },
    mailboxUrn: memberUrn,
    trackingId,
    dedupeByClientGeneratedToken: false,
  };

  debugLog('info', `sendMessage: conv=${conversationId.substring(0, 20)}... (${renderContentUnions.length} content unions, replyTo=${!!replyTo})`);

  const res = await voyagerFetch(
    `/voyagerMessagingDashMessengerMessages?action=createMessage`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const errBody = await res.clone().text().catch(() => '');
    debugLog('error', `sendMessage failed ${res.status}: ${errBody.substring(0, 300)}`);
    const parsed = tryParseLinkedInError(errBody, res.status);
    throw new Error(parsed || `Failed to send message: ${res.status}`);
  }

  debugLog('info', 'sendMessage: success');
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  newBody: string
): Promise<void> {
  debugLog('info', `editMessage: conv=${conversationId.substring(0, 20)}... msg=${messageId.substring(0, 40)}...`);

  const encodedUrn = encodeURIComponent(messageId);

  const res = await voyagerFetch(
    `/voyagerMessagingDashMessengerMessages/${encodedUrn}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        patch: {
          $set: {
            body: {
              text: newBody,
              attributes: [],
            },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.clone().text().catch(() => '');
    debugLog('error', `editMessage failed ${res.status}: ${errBody.substring(0, 300)}`);
    throw new Error(`Failed to edit message: ${res.status}`);
  }

  debugLog('info', 'editMessage: success');
}

export async function reactWithEmoji(
  messageId: string,
  emoji: string
): Promise<void> {
  debugLog('info', `reactWithEmoji: msg=${messageId.substring(0, 40)}... emoji=${emoji}`);

  const res = await voyagerFetch(
    `/voyagerMessagingDashMessengerMessages?action=reactWithEmoji`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        messageUrn: messageId,
        emoji,
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.clone().text().catch(() => '');
    debugLog('error', `reactWithEmoji failed ${res.status}: ${errBody.substring(0, 300)}`);
    throw new Error(`Failed to react: ${res.status}`);
  }

  debugLog('info', 'reactWithEmoji: success');
}

export async function recallMessage(
  messageId: string
): Promise<void> {
  debugLog('info', `recallMessage: msg=${messageId.substring(0, 40)}...`);

  const res = await voyagerFetch(
    `/voyagerMessagingDashMessengerMessages?action=recall`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        messageUrn: messageId,
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.clone().text().catch(() => '');
    debugLog('error', `recallMessage failed ${res.status}: ${errBody.substring(0, 300)}`);
    throw new Error(`Failed to unsend message: ${res.status}`);
  }

  debugLog('info', 'recallMessage: success');
}

export async function createConversation(
  recipientUrns: string[],
  body: string,
  attachments?: BridgeAttachment[]
): Promise<{ conversationId: string }> {
  // LinkedIn's UI always checks for an existing conversation first.
  // If one exists, send to it instead of trying to create (which may 400).
  const existingConvId = await findConversationByRecipients(recipientUrns);
  if (existingConvId) {
    debugLog('info', `createConversation: found existing conv ${existingConvId.substring(0, 20)}..., sending there`);
    await sendMessage(existingConvId, body, attachments);
    return { conversationId: existingConvId };
  }

  const memberUrn = await getMemberUrn();
  const originToken = crypto.randomUUID();

  const trackingBytes = new Uint8Array(16);
  crypto.getRandomValues(trackingBytes);
  const trackingId = String.fromCharCode(...trackingBytes);

  // Upload attachments
  const renderContentUnions: any[] = [];
  if (attachments?.length) {
    for (const att of attachments) {
      const assetUrn = await uploadFile(att);
      renderContentUnions.push({
        file: {
          assetUrn,
          byteSize: att.size,
          mediaType: att.type,
          name: att.name,
        },
      });
    }
  }

  const payload = {
    message: {
      body: {
        attributes: [],
        text: body,
      },
      renderContentUnions,
      originToken,
    },
    mailboxUrn: memberUrn,
    recipients: recipientUrns,
    trackingId,
    dedupeByClientGeneratedToken: false,
  };

  debugLog('info', `createConversation: to=${recipientUrns.length} recipient(s)`);

  const res = await voyagerFetch(
    `/voyagerMessagingDashMessengerMessages?action=createMessage`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const errBody = await res.clone().text().catch(() => '');
    debugLog('error', `createConversation failed ${res.status}: ${errBody.substring(0, 300)}`);
    const parsed = tryParseLinkedInError(errBody, res.status);
    throw new Error(parsed || `Failed to create conversation: ${res.status}`);
  }

  // Try to extract conversation ID from response
  const data = await res.json().catch(() => null);
  const convUrn = data?.value?.conversationUrn || data?.data?.value?.conversationUrn || '';
  let conversationId = extractConversationId(convUrn);
  if (!conversationId) {
    conversationId = await findConversationByRecipients(recipientUrns).catch(() => '') || '';
  }
  if (!conversationId) {
    throw new Error('Conversation created but LinkedIn did not return a conversation ID');
  }

  debugLog('info', `createConversation: success, convId=${conversationId.substring(0, 20)}`);
  return { conversationId };
}
