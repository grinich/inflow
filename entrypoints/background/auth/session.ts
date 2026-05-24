import { voyagerFetch } from '../api/client';

export interface Session {
  authenticated: boolean;
  displayName?: string;
  publicId?: string;
  profilePicture?: string;
  memberUrn?: string;
}

// Cached member URN so we don't re-fetch /me on every API call
let cachedMemberUrn: string | null = null;

export async function getMemberUrn(): Promise<string> {
  if (cachedMemberUrn) return cachedMemberUrn;
  const session = await getSession();
  if (!session.memberUrn) throw new Error('Not authenticated');
  return session.memberUrn;
}

export async function getSession(): Promise<Session> {
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
    cachedMemberUrn = memberUrn || null;

    return {
      authenticated: true,
      memberUrn,
      displayName: `${miniProfile?.firstName || ''} ${miniProfile?.lastName || ''}`.trim(),
      publicId: miniProfile?.publicIdentifier,
    };
  } catch {
    return { authenticated: false };
  }
}
