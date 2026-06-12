// Pure functions: raw Voyager normalized+json → typed records.
// Defensive by design — these endpoints are undocumented and shapes drift.
import { pickArtifact } from '@/lib/voyager-image';
import type { Invitation, Connection } from '@/types/network';
import type { Profile } from '@/types/profile';

/** Extract a picture URL from any of the vectorImage envelope variants. */
function pictureFrom(picture: any, size = 200): string {
  const vi =
    picture?.displayImageReferenceResolutionResult?.vectorImage ??
    picture?.displayImageReference?.vectorImage ??
    picture?.['com.linkedin.common.VectorImage'] ??
    picture?.vectorImage;
  if (vi?.rootUrl && Array.isArray(vi.artifacts) && vi.artifacts.length) {
    const artifact = pickArtifact(vi.artifacts, size);
    if (artifact?.fileIdentifyingUrlPathSegment) {
      return `${vi.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
    }
  }
  return '';
}

/** Read a normalized-JSON reference key, tolerating both `*foo` and `foo`. */
function ref(entity: any, key: string): string {
  const v = entity?.[`*${key}`] ?? entity?.[key];
  return typeof v === 'string' ? v : '';
}

/** urn:li:fs_miniProfile:X / urn:li:fsd_profile:X → urn:li:fsd_profile:X */
function toFsdProfileUrn(urn: string): string {
  const id = urn.split(':').pop() || '';
  return id ? `urn:li:fsd_profile:${id}` : '';
}

function included(raw: any): any[] {
  return Array.isArray(raw?.included) ? raw.included : [];
}

export function normalizeInvitations(raw: any): Invitation[] {
  const entities = included(raw);
  const profilesById = new Map<string, any>();
  for (const e of entities) {
    const t = String(e?.$type || '');
    if (t.endsWith('shared.MiniProfile') || t.endsWith('profile.Profile')) {
      const id = String(e.entityUrn || '').split(':').pop();
      if (id) profilesById.set(id, e);
    }
  }

  const results: Invitation[] = [];
  for (const e of entities) {
    if (!String(e?.$type || '').endsWith('invitation.Invitation')) continue;
    const id = String(e.entityUrn || '').split(':').pop() || '';
    if (!id) continue;
    const fromRef = ref(e, 'fromMember') || ref(e, 'inviter');
    const memberId = fromRef.split(':').pop() || '';
    const p = profilesById.get(memberId);
    const name = `${p?.firstName || ''} ${p?.lastName || ''}`.trim() || 'LinkedIn Member';
    const msg = e.message;
    results.push({
      id,
      sharedSecret: String(e.sharedSecret || ''),
      fromUrn: toFsdProfileUrn(fromRef),
      name,
      headline: String(p?.occupation || p?.headline || ''),
      pictureUrl: pictureFrom(p?.picture ?? p?.profilePicture, 100),
      publicId: String(p?.publicIdentifier || ''),
      message: typeof msg === 'string' ? msg : String(msg?.text || ''),
      sentAt: Number(e.sentTime || e.sentAt || 0),
      status: 'pending',
    });
  }
  return results;
}

export function normalizeConnections(raw: any): { connections: Connection[]; profiles: Profile[] } {
  const entities = included(raw);
  const profilesByUrn = new Map<string, any>();
  for (const e of entities) {
    if (String(e?.$type || '').endsWith('profile.Profile') && e.entityUrn) {
      profilesByUrn.set(e.entityUrn, e);
    }
  }

  const connections: Connection[] = [];
  const profiles: Profile[] = [];
  for (const e of entities) {
    if (!String(e?.$type || '').endsWith('relationships.Connection')) continue;
    const memberRef = ref(e, 'connectedMember') || ref(e, 'connectedMemberResolutionResult');
    const p = profilesByUrn.get(memberRef) ?? profilesByUrn.get(toFsdProfileUrn(memberRef));
    if (!p) continue;
    const profileUrn = toFsdProfileUrn(String(p.entityUrn));
    const firstName = String(p.firstName || '');
    const lastName = String(p.lastName || '');
    const name = `${firstName} ${lastName}`.trim() || 'LinkedIn Member';
    const headline = String(p.headline || p.occupation || '');
    const pictureUrl = pictureFrom(p.profilePicture ?? p.picture, 200);
    const publicId = String(p.publicIdentifier || '');
    connections.push({
      profileUrn,
      name,
      headline,
      pictureUrl,
      publicId,
      connectedAt: Number(e.createdAt || 0),
    });
    profiles.push({
      urn: profileUrn,
      publicId,
      firstName,
      lastName,
      fullName: name,
      occupation: headline,
      location: '',
      pictureUrl,
    });
  }
  return { connections, profiles };
}
