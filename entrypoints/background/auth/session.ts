import { voyagerFetch } from '../api/client';
import { getLinkedInCookies } from './cookies';
import { switchDatabase, memberIdFromUrn } from '@/db/database';
import { debugLog } from '@/lib/debug-log';

export interface Session {
  authenticated: boolean;
  displayName?: string;
  publicId?: string;
  profilePicture?: string;
  memberUrn?: string;
}

// Cached member URN so we don't re-fetch /me on every API call
let cachedMemberUrn: string | null = null;

// TTL cache for getSession() — avoids hammering /me on rapid focus events
const SESSION_TTL_MS = 30_000;
let cachedSession: Session | null = null;
let cachedSessionAt = 0;

// Track the li_at cookie to detect account switches between /me calls
let lastLiAtValue: string | null = null;

export async function getMemberUrn(): Promise<string> {
  // Check if the LinkedIn session cookie changed (account switch)
  // before returning a cached URN — prevents querying with stale identity
  if (cachedMemberUrn) {
    const cookieChanged = await hasSessionCookieChanged();
    if (cookieChanged) {
      debugLog('info', '[SESSION] li_at cookie changed — forcing /me re-check');
      invalidateSessionCache();
      cachedMemberUrn = null;
    } else {
      return cachedMemberUrn;
    }
  }
  const session = await getSession();
  if (!session.memberUrn) throw new Error('Not authenticated');
  return session.memberUrn;
}

export function clearCachedMemberUrn(): void {
  cachedMemberUrn = null;
}

/** Invalidate the session cache so the next getSession() hits /me. */
export function invalidateSessionCache(): void {
  cachedSession = null;
  cachedSessionAt = 0;
}

/** Check if the li_at cookie value has changed since we last saw it. */
async function hasSessionCookieChanged(): Promise<boolean> {
  try {
    const cookies = await getLinkedInCookies();
    if (!cookies) return true; // no cookies = definitely changed
    if (lastLiAtValue === null) {
      // First check — record it, don't treat as changed
      lastLiAtValue = cookies.liAt;
      return false;
    }
    if (cookies.liAt !== lastLiAtValue) {
      lastLiAtValue = cookies.liAt;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function getSession(): Promise<Session> {
  if (cachedSession && Date.now() - cachedSessionAt < SESSION_TTL_MS) {
    return cachedSession;
  }

  try {
    const res = await voyagerFetch('/me');
    if (!res.ok) {
      return { authenticated: false };
    }

    const data = await res.json();
    const miniProfile = data.included?.find(
      (item: any) => item.$type === 'com.linkedin.voyager.identity.shared.MiniProfile'
    );

    // Extract the member ID from the miniProfile URN
    // e.g. "urn:li:fs_miniProfile:ACoAAAUhqQcB..." -> "ACoAAAUhqQcB..."
    const memberId = miniProfile?.entityUrn?.split(':').pop() || '';
    const memberUrn = memberId ? `urn:li:fsd_profile:${memberId}` : '';

    // Detect account change
    const previousUrn = cachedMemberUrn;
    cachedMemberUrn = memberUrn || null;

    // Record the current cookie so future getMemberUrn() checks can detect changes
    try {
      const cookies = await getLinkedInCookies();
      if (cookies) lastLiAtValue = cookies.liAt;
    } catch {}

    if (previousUrn && memberUrn && previousUrn !== memberUrn) {
      debugLog('info', `Account changed: ${previousUrn} → ${memberUrn}`);
      const newMemberId = memberIdFromUrn(memberUrn);
      if (newMemberId) {
        await switchDatabase(newMemberId);
      }
      // Broadcast to all UI tabs
      chrome.runtime.sendMessage({ type: 'ACCOUNT_CHANGED', memberUrn }).catch(() => {});
    }

    // Extract profile picture from MiniProfile
    const pictureArtifact = miniProfile?.picture?.['com.linkedin.common.VectorImage']
      ?.artifacts?.find((a: any) => a.width === 200 || a.width === 100)
      ?? miniProfile?.picture?.['com.linkedin.common.VectorImage']?.artifacts?.[0];
    const rootUrl = miniProfile?.picture?.['com.linkedin.common.VectorImage']?.rootUrl || '';
    const profilePicture = pictureArtifact
      ? `${rootUrl}${pictureArtifact.fileIdentifyingUrlPathSegment}`
      : undefined;

    const session: Session = {
      authenticated: true,
      memberUrn,
      displayName: `${miniProfile?.firstName || ''} ${miniProfile?.lastName || ''}`.trim(),
      publicId: miniProfile?.publicIdentifier,
      profilePicture,
    };
    cachedSession = session;
    cachedSessionAt = Date.now();
    return session;
  } catch (err: any) {
    // Network errors (fetch failed, DNS, timeout) should NOT be treated as
    // "unauthenticated" — that would cause AuthGate to flash a login screen
    // on every transient network blip. Only return unauthenticated for errors
    // that indicate a genuine auth problem (HTTP 401/403 are handled above
    // via res.ok check). Rethrow network errors so callers can handle them.
    if (err?.name === 'TypeError' || err?.message?.includes('fetch')) {
      debugLog('warn', `[SESSION] Network error during /me check: ${err}`);
      // If we have a cached session, return it rather than losing auth state
      if (cachedSession) return cachedSession;
    }
    return { authenticated: false };
  }
}
