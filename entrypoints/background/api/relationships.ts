import { voyagerFetch } from './client';
import { debugLog } from '@/lib/debug-log';

/**
 * Received connection invitations (classic relationships API — the same
 * endpoint voyager-web's My Network page uses).
 *
 * `includeInsights=true` is what carries the shared-connections insight
 * ("Sarah Chen and 11 other shared connections") that My Network shows under
 * each request. It costs nothing extra — same request, one response.
 */
export async function fetchInvitationsRaw(start = 0, count = 40): Promise<any> {
  const res = await voyagerFetch(
    `/relationships/invitationViews?q=receivedInvitation&start=${start}&count=${count}&includeInsights=true`
  );
  if (!res.ok) {
    debugLog('error', `fetchInvitationsRaw failed: ${res.status}`);
    throw new Error(`fetchInvitations failed: ${res.status}`);
  }
  return res.json();
}

/** Accept or ignore an invitation. Requires the sharedSecret from the list response. */
export async function respondToInvitation(
  invitationId: string,
  sharedSecret: string,
  action: 'accept' | 'ignore'
): Promise<void> {
  const res = await voyagerFetch(`/relationships/invitations/${invitationId}?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      invitationId,
      invitationSharedSecret: sharedSecret,
      isGenericInvitation: false,
    }),
    skipJitter: true,
  });
  if (!res.ok) {
    debugLog('error', `respondToInvitation (${action}) failed: ${res.status}`);
    throw new Error(`Invitation ${action} failed: ${res.status}`);
  }
}

/**
 * Invitations *I* sent that are still outstanding — the same endpoint as the
 * received list, flipped to `q=sentInvitation`.
 */
export async function fetchSentInvitationsRaw(start = 0, count = 40): Promise<any> {
  const res = await voyagerFetch(
    `/relationships/invitationViews?q=sentInvitation&start=${start}&count=${count}`
  );
  if (!res.ok) {
    debugLog('error', `fetchSentInvitationsRaw failed: ${res.status}`);
    throw new Error(`fetchSentInvitations failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Withdraw a sent invitation.
 *
 * `?action=withdraw` mirrors the accept/ignore calls on the same endpoint.
 * Unverified against a live account, so the caller must treat a non-OK
 * response as "still outstanding" rather than assuming it worked.
 */
export async function withdrawInvitation(
  invitationId: string,
  sharedSecret: string
): Promise<void> {
  const res = await voyagerFetch(`/relationships/invitations/${invitationId}?action=withdraw`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      invitationId,
      invitationSharedSecret: sharedSecret,
      isGenericInvitation: false,
    }),
    skipJitter: true,
  });
  if (!res.ok) {
    debugLog('error', `withdrawInvitation failed: ${res.status}`);
    throw new Error(`Invitation withdraw failed: ${res.status}`);
  }
}

const CONNECTIONS_DECORATION =
  'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16';

/** Connections list, most recent first. */
export async function fetchConnectionsRaw(start = 0, count = 40): Promise<any> {
  const res = await voyagerFetch(
    `/relationships/dash/connections?decorationId=${CONNECTIONS_DECORATION}&q=search&sortType=RECENTLY_ADDED&start=${start}&count=${count}`
  );
  if (!res.ok) {
    debugLog('error', `fetchConnectionsRaw failed: ${res.status}`);
    throw new Error(`fetchConnections failed: ${res.status}`);
  }
  return res.json();
}
