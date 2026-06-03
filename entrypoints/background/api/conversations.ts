import { voyagerFetch } from './client';
import { getMemberUrn } from '../auth/session';
import { linkedInVariables, raw, encodeConversationUrn, type RawValue } from './encode';
import { debugLog } from '@/lib/debug-log';
import { extractConversationId } from '@/lib/conversation-urn';
import type { VoyagerResponse } from './types';

/** LinkedIn inbox categories mapped to their API values. */
export type InboxCategory = 'PRIMARY_INBOX' | 'SECONDARY_INBOX' | 'ARCHIVE' | 'SPAM';

// ---------------------------------------------------------------------------
// Recipient-based conversation lookup
// ---------------------------------------------------------------------------

/**
 * Find an existing conversation with exactly the given recipients.
 * Uses LinkedIn's recipient-based conversation lookup (same as the compose UI).
 * Returns the conversation ID if found, null otherwise.
 */
export async function findConversationByRecipients(
  recipientUrns: string[]
): Promise<string | null> {
  const memberUrn = await getMemberUrn();

  // Build recipients List with encoded URNs (colons → %3A)
  const encodedRecipients = recipientUrns
    .map(u => u.replace(/:/g, '%3A'))
    .join(',');

  const variables = linkedInVariables({
    mailboxUrn: memberUrn,
    recipients: raw(`List(${encodedRecipients})`),
  });

  const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.9c3ab648b616451570c715e4a184465e&variables=${variables}`;

  const res = await voyagerFetch(path);
  if (!res.ok) {
    debugLog('error', `findConversationByRecipients failed: ${res.status}`);
    return null;
  }

  const data = await res.json();

  // Find conversation entity in included array
  const conv = (data.included || []).find(
    (e: any) => e.$type === 'com.linkedin.messenger.Conversation'
  );
  if (!conv?.entityUrn) return null;

  // Extract conversation ID from URN: urn:li:msg_conversation:(memberUrn,convId)
  return extractConversationId(conv.entityUrn) || null;
}

// ---------------------------------------------------------------------------
// Fetching conversations
// ---------------------------------------------------------------------------

/** Result from a paginated conversation fetch. */
export interface PaginatedConversationsResult {
  response: VoyagerResponse;
  nextCursor: string | null;
}

/**
 * Fetch a page of conversations using cursor-based pagination.
 * This is the only query that supports real pagination through all conversations.
 *
 * @param category - The inbox category to fetch
 * @param cursor - The cursor from a previous page's response, or null for page 1
 * @returns The raw response and the nextCursor for the following page (null if no more pages)
 */
export async function fetchConversationsPage(
  category: InboxCategory,
  cursor: string | null
): Promise<PaginatedConversationsResult> {
  const memberUrn = await getMemberUrn();
  const encodedUrn = encodeURIComponent(memberUrn);

  let variables: string;
  if (cursor) {
    const encodedCursor = encodeURIComponent(cursor);
    variables = `(query:(predicateUnions:List((conversationCategoryPredicate:(category:${category})))),count:20,mailboxUrn:${encodedUrn},nextCursor:${encodedCursor})`;
  } else {
    variables = `(query:(predicateUnions:List((conversationCategoryPredicate:(category:${category})))),count:20,mailboxUrn:${encodedUrn})`;
  }

  const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.9501074288a12f3ae9e3c7ea243bccbf&variables=${variables}`;

  const res = await voyagerFetch(path);
  if (!res.ok) {
    throw new Error(`Failed to fetch conversations page (${category}): ${res.status}`);
  }

  const data = await res.json();

  // nextCursor lives at data.data.messengerConversationsByCategoryQuery.metadata.nextCursor
  const nextCursor: string | null =
    data?.data?.data?.messengerConversationsByCategoryQuery?.metadata?.nextCursor || null;

  return { response: data, nextCursor };
}

// ---------------------------------------------------------------------------
// Search — query LinkedIn's server-side messaging search
// ---------------------------------------------------------------------------

/**
 * Search conversations on LinkedIn by keyword.
 * Uses the category-aware query endpoint with a `keywords` parameter.
 * Returns 20 results per page with cursor-based pagination.
 */
export async function searchConversations(
  keyword: string,
  cursor: string | null
): Promise<PaginatedConversationsResult> {
  const memberUrn = await getMemberUrn();

  const params: Record<string, string | number | boolean | RawValue> = {
    categories: raw('List(INBOX,SPAM,ARCHIVE)'),
    count: 20,
    firstDegreeConnections: false,
    mailboxUrn: memberUrn,
    keywords: keyword,
  };
  if (cursor) {
    params.nextCursor = cursor;
  }
  const variables = linkedInVariables(params);

  const path = `/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.737b27144cf922499202658a5345016f&variables=${variables}`;
  const res = await voyagerFetch(path);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);

  const data = await res.json();
  const nextCursor =
    data?.data?.data?.messengerConversationsBySearchCriteria?.metadata?.nextCursor || null;
  return { response: data, nextCursor };
}

// ---------------------------------------------------------------------------
// Mutations — use LinkedIn's Dash API (voyagerMessagingDashMessengerConversations)
// ---------------------------------------------------------------------------

/** Build the full conversation URN: urn:li:msg_conversation:(memberUrn,convId) */
function buildConversationUrn(memberUrn: string, conversationId: string): string {
  return `urn:li:msg_conversation:(${memberUrn},${conversationId})`;
}

/**
 * Move a conversation to a category (ARCHIVE, SECONDARY_INBOX, PRIMARY_INBOX).
 * Endpoint: POST ...?action=addCategory
 */
async function setConversationCategory(conversationId: string, category: string): Promise<void> {
  const memberUrn = await getMemberUrn();
  const convUrn = buildConversationUrn(memberUrn, conversationId);

  const res = await voyagerFetch(
    `/voyagerMessagingDashMessengerConversations?action=addCategory`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationUrns: [convUrn],
        category,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    debugLog('error', `setCategory ${category} failed ${res.status}: ${body.substring(0, 200)}`);
    throw new Error(`Failed to set category ${category}: ${res.status}`);
  }
  debugLog('info', `Set conversation ${conversationId.substring(0, 20)}... to ${category}`);
}

/**
 * Remove a category from a conversation.
 * Endpoint: POST ...?action=removeCategory
 */
async function removeConversationCategory(conversationId: string, category: string): Promise<void> {
  const memberUrn = await getMemberUrn();
  const convUrn = buildConversationUrn(memberUrn, conversationId);

  const res = await voyagerFetch(
    `/voyagerMessagingDashMessengerConversations?action=removeCategory`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationUrns: [convUrn],
        category,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    debugLog('error', `removeCategory ${category} failed ${res.status}: ${body.substring(0, 200)}`);
    throw new Error(`Failed to remove category ${category}: ${res.status}`);
  }
  debugLog('info', `Removed category ${category} from conversation ${conversationId.substring(0, 20)}...`);
}

/**
 * Patch a conversation field via the Dash entity update API.
 * Endpoint: POST ...?ids=List(encodedUrn)
 */
async function patchConversation(
  conversationId: string,
  patch: Record<string, any>
): Promise<void> {
  const memberUrn = await getMemberUrn();
  const convUrn = buildConversationUrn(memberUrn, conversationId);
  const encodedUrn = encodeConversationUrn(memberUrn, conversationId);

  const res = await voyagerFetch(
    `/voyagerMessagingDashMessengerConversations?ids=List(${encodedUrn})`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entities: {
          [convUrn]: {
            patch: { $set: patch },
          },
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    debugLog('error', `patchConversation failed ${res.status}: ${body.substring(0, 200)}`);
    throw new Error(`Failed to patch conversation: ${res.status}`);
  }
  debugLog('info', `Patched conversation ${conversationId.substring(0, 20)}... with ${JSON.stringify(patch)}`);
}

// ---------------------------------------------------------------------------
// Public mutation API
// ---------------------------------------------------------------------------

export async function archiveConversation(conversationId: string): Promise<void> {
  await setConversationCategory(conversationId, 'ARCHIVE');
}

export async function unarchiveConversation(conversationId: string): Promise<void> {
  await setConversationCategory(conversationId, 'PRIMARY_INBOX');
}

export async function moveToOther(conversationId: string): Promise<void> {
  await setConversationCategory(conversationId, 'SECONDARY_INBOX');
}

export async function moveToFocused(conversationId: string): Promise<void> {
  await setConversationCategory(conversationId, 'PRIMARY_INBOX');
}

export async function moveToSpam(conversationId: string): Promise<void> {
  await setConversationCategory(conversationId, 'SPAM');
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await patchConversation(conversationId, { read: true });
}

export async function markConversationUnread(conversationId: string): Promise<void> {
  await patchConversation(conversationId, { read: false });
}

export async function starConversation(conversationId: string): Promise<void> {
  await setConversationCategory(conversationId, 'STARRED');
}

export async function unstarConversation(conversationId: string): Promise<void> {
  await removeConversationCategory(conversationId, 'STARRED');
}

/**
 * Permanently delete a conversation.
 * Endpoint: DELETE ...?ids=List(encodedUrn)
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  const memberUrn = await getMemberUrn();
  const encodedUrn = encodeConversationUrn(memberUrn, conversationId);

  const res = await voyagerFetch(
    `/voyagerMessagingDashMessengerConversations?ids=List(${encodedUrn})`,
    { method: 'DELETE' }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    debugLog('error', `deleteConversation failed ${res.status}: ${body.substring(0, 200)}`);
    throw new Error(`Failed to delete conversation: ${res.status}`);
  }
  debugLog('info', `Deleted conversation ${conversationId.substring(0, 20)}...`);
}
