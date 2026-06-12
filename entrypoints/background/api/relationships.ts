import { voyagerFetch } from './client';

/**
 * Received connection invitations (classic relationships API — the same
 * endpoint voyager-web's My Network page uses).
 */
export async function fetchInvitationsRaw(start = 0, count = 40): Promise<any> {
  const res = await voyagerFetch(
    `/relationships/invitationViews?q=receivedInvitation&start=${start}&count=${count}&includeInsights=false`
  );
  if (!res.ok) throw new Error(`fetchInvitations failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Invitation ${action} failed: ${res.status}`);
}

const CONNECTIONS_DECORATION =
  'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16';

/** Connections list, most recent first. */
export async function fetchConnectionsRaw(start = 0, count = 40): Promise<any> {
  const res = await voyagerFetch(
    `/relationships/dash/connections?decorationId=${CONNECTIONS_DECORATION}&q=search&sortType=RECENTLY_ADDED&start=${start}&count=${count}`
  );
  if (!res.ok) throw new Error(`fetchConnections failed: ${res.status}`);
  return res.json();
}
