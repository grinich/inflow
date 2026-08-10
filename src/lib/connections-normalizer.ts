import type { Connection } from '@/types/connection';
import type { Profile } from '@/types/profile';
import { pickArtifact } from './voyager-image';

const PROFILE_TYPE = 'com.linkedin.voyager.dash.identity.profile.Profile';
const CONNECTION_TYPE = 'com.linkedin.voyager.dash.relationships.Connection';

/** Build a usable picture URL from a Voyager Profile `profilePicture` blob. */
function buildPictureUrl(profilePicture: any): string {
  const vectorImage = profilePicture?.displayImageReference?.vectorImage;
  if (vectorImage?.rootUrl && vectorImage?.artifacts?.length) {
    const artifact = pickArtifact(vectorImage.artifacts, 100);
    if (artifact?.fileIdentifyingUrlPathSegment) {
      return `${vectorImage.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
    }
  }
  return '';
}

/**
 * Normalize a `/relationships/dash/connections` response (accept:
 * normalized+json) into Connection rows plus the underlying Profile records.
 *
 * The response splits into `data['*elements']` (an ordered list of connection
 * URNs, RECENTLY_ADDED first) and a flat `included` array holding both
 * Connection and Profile entities. Each Connection references its person via
 * `*connectedMemberResolutionResult` (a ref to the Profile's entityUrn).
 *
 * `now` is injectable for deterministic tests.
 */
export function normalizeConnections(
  raw: any,
  now: number = Date.now(),
): { connections: Connection[]; profiles: Profile[] } {
  const included: any[] = raw?.included || [];

  const profileByUrn = new Map<string, any>();
  const connByUrn = new Map<string, any>();
  for (const e of included) {
    if (!e || !e.$type) continue;
    if (e.$type === PROFILE_TYPE && e.entityUrn) profileByUrn.set(e.entityUrn, e);
    else if (e.$type === CONNECTION_TYPE && e.entityUrn) connByUrn.set(e.entityUrn, e);
  }

  // Preserve the server's RECENTLY_ADDED order via `*elements`; fall back to
  // the `included` order if the ref list is missing.
  const order: string[] = raw?.data?.['*elements'] || [];
  const orderedConns = order.length
    ? order.map((u) => connByUrn.get(u)).filter(Boolean)
    : included.filter((e) => e?.$type === CONNECTION_TYPE);

  const connections: Connection[] = [];
  const profiles: Profile[] = [];

  for (const conn of orderedConns) {
    const profileUrn: string =
      conn['*connectedMemberResolutionResult'] || conn.connectedMember || '';
    if (!profileUrn) continue;

    const p = profileByUrn.get(profileUrn);
    const firstName = p?.firstName || '';
    const lastName = p?.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const headline = p?.headline || '';
    const publicId = p?.publicIdentifier || '';
    const pictureUrl = buildPictureUrl(p?.profilePicture);

    connections.push({
      profileUrn,
      connectionUrn: conn.entityUrn || '',
      connectedAt: typeof conn.createdAt === 'number' ? conn.createdAt : 0,
      publicId,
      firstName,
      lastName,
      fullName,
      headline,
      pictureUrl,
      syncedAt: now,
    });

    if (p) {
      profiles.push({
        urn: profileUrn,
        publicId,
        firstName,
        lastName,
        fullName,
        occupation: headline,
        location: '',
        pictureUrl,
      });
    }
  }

  return { connections, profiles };
}
