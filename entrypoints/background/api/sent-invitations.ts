// Sent invitations, which LinkedIn no longer serves over Voyager. See
// docs/linkedin-sent-invitations.md for how this was established and captured.
//
// Both calls go to www.linkedin.com paths outside /voyager/, so they rely on
// cookie rule 3 in client.ts rather than voyagerFetch.
import { ensureCookieRule } from './client';
import { getLinkedInCookies } from '../auth/cookies';
import { debugLog } from '@/lib/debug-log';
import { buildWithdrawBody, buildPaginationBody } from '@/lib/sent-invitation-scraper';
import type { SentInvitation } from '@/types/network';

const SENT_PAGE = 'https://www.linkedin.com/mynetwork/invitation-manager/sent/';
const ACTION_BASE = 'https://www.linkedin.com/flagship-web/rsc-action/actions/';
const WITHDRAW_ACTION =
  ACTION_BASE + 'server-request?sduiid=com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation';
const PAGINATION_ACTION =
  ACTION_BASE + 'pagination?sduiid=com.linkedin.sdui.pagers.mynetwork.scribeSentInvitationManagerList';

/**
 * Both POSTs need the csrf token; without it they answer 403. Of the nine
 * headers LinkedIn's own client sends, this is the only one the server
 * actually requires — the rest are tracking.
 */
async function csrfToken(): Promise<string> {
  const cookies = await getLinkedInCookies();
  return cookies?.jsessionId?.replace(/"/g, '') ?? '';
}

/**
 * The invitation-manager page, as HTML. The rows are embedded in it; there is
 * no JSON endpoint to ask instead.
 */
export async function fetchSentInvitationsPage(): Promise<string> {
  await ensureCookieRule();
  const res = await fetch(SENT_PAGE, {
    method: 'GET',
    credentials: 'omit', // the cookie comes from the declarativeNetRequest rule
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  if (!res.ok) {
    debugLog('error', `fetchSentInvitationsPage failed: ${res.status}`);
    throw new Error(`Sent invitations page failed: ${res.status}`);
  }
  const html = await res.text();
  // A logged-out fetch still returns 200, with a sign-in page instead. Treat
  // that as a failure rather than reporting zero sent invitations.
  if (!/People\s*\(|INVITATION_MANAGER_WITHDRAW/.test(html)) {
    debugLog('error', 'fetchSentInvitationsPage: no invitation markup (signed out?)');
    throw new Error('Sent invitations page did not contain the invitation list');
  }
  return html;
}

/**
 * Withdraw one sent invitation through the same server action the page's own
 * Withdraw button posts.
 */
export async function withdrawSentInvitation(invitation: SentInvitation): Promise<void> {
  await ensureCookieRule();
  const res = await fetch(WITHDRAW_ACTION, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'content-type': 'application/json',
      accept: 'text/x-component,*/*',
      'csrf-token': await csrfToken(),
    },
    body: buildWithdrawBody(invitation),
  });
  if (!res.ok) {
    debugLog('error', `withdrawSentInvitation failed: ${res.status}`);
    throw new Error(`Withdraw failed: ${res.status}`);
  }
}

/**
 * One page of sent invitations past the first, via the same pagination action
 * the page's infinite scroll uses. Comes back as an RSC component tree rather
 * than HTML — the scraper reads both.
 */
export async function fetchSentInvitationsAt(startIndex: number): Promise<string> {
  await ensureCookieRule();
  const res = await fetch(PAGINATION_ACTION, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'content-type': 'application/json',
      accept: 'text/x-component,*/*',
      'csrf-token': await csrfToken(),
    },
    body: buildPaginationBody(startIndex),
  });
  if (!res.ok) {
    debugLog('error', `fetchSentInvitationsAt(${startIndex}) failed: ${res.status}`);
    throw new Error(`Sent invitations page ${startIndex} failed: ${res.status}`);
  }
  return res.text();
}
