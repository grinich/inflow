// Pure functions: raw Voyager normalized+json → typed records.
// Defensive by design — these endpoints are undocumented and shapes drift.
import { pickArtifact } from '@/lib/voyager-image';
import type { Invitation, Connection, InvitationInsight } from '@/types/network';
import type { Profile } from '@/types/profile';

function included(raw: any): any[] {
  return Array.isArray(raw?.included) ? raw.included : [];
}

/**
 * Index every included entity by `entityUrn` so `*foo` pointers can be
 * followed. Normalized+json hoists shared sub-objects (pictures, the profiles
 * behind a shared-connections insight) out of their parent and leaves a urn
 * string behind, so anything that reads a nested object has to be able to
 * resolve one.
 */
function indexByUrn(entities: any[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const e of entities) {
    if (e?.entityUrn) m.set(String(e.entityUrn), e);
  }
  return m;
}

type Resolve = (urn: string) => any;

/** Read a normalized-JSON reference key, tolerating both `*foo` and `foo`. */
function ref(entity: any, key: string): string {
  const v = entity?.[`*${key}`] ?? entity?.[key];
  return typeof v === 'string' ? v : '';
}

/** Unwrap the vectorImage out of whichever envelope this payload happens to use. */
function vectorImageFrom(picture: any, resolve?: Resolve): any {
  const p = typeof picture === 'string' ? resolve?.(picture) : picture;
  if (!p || typeof p !== 'object') return null;
  const vi =
    p.displayImageReferenceResolutionResult?.vectorImage ??
    p.displayImageReference?.vectorImage ??
    p['com.linkedin.common.VectorImage'] ??
    p.vectorImage;
  if (vi) return vi;
  // `displayImageReference` can itself be a urn pointer to a hoisted entity.
  const pointer = p['*displayImageReference'];
  if (typeof pointer === 'string' && resolve) {
    const target = resolve(pointer);
    if (target) return vectorImageFrom(target, resolve);
  }
  // Some shapes put rootUrl/artifacts directly on the object.
  return Array.isArray(p.artifacts) && p.rootUrl ? p : null;
}

/** Extract a picture URL from any of the vectorImage envelope variants. */
function pictureFrom(picture: any, size = 200, resolve?: Resolve): string {
  const vi = vectorImageFrom(picture, resolve);
  if (vi?.rootUrl && Array.isArray(vi.artifacts) && vi.artifacts.length) {
    const artifact = pickArtifact(vi.artifacts, size);
    if (artifact?.fileIdentifyingUrlPathSegment) {
      return `${vi.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
    }
  }
  return '';
}

/**
 * A profile's picture, trying every field name and both the inline and
 * by-reference forms. Returns '' when none of them resolve.
 */
function profilePictureUrl(p: any, size: number, resolve: Resolve): string {
  const candidates = [
    p?.picture,
    p?.['*picture'],
    p?.profilePicture,
    p?.['*profilePicture'],
    p?.profilePicture?.displayImage,
    p?.profilePicture?.['*displayImage'],
  ];
  for (const c of candidates) {
    if (!c) continue;
    const url = pictureFrom(c, size, resolve);
    if (url) return url;
  }
  return '';
}

/** urn:li:fs_miniProfile:X / urn:li:fsd_profile:X / urn:li:member:X → urn:li:fsd_profile:X */
function toFsdProfileUrn(urn: string): string {
  const match = String(urn || '').match(/(?:fs_miniProfile|fsd_profile|member):([^,:)]+)/);
  return match ? `urn:li:fsd_profile:${match[1]}` : '';
}

function displayName(p: any): string {
  return `${p?.firstName || ''} ${p?.lastName || ''}`.trim();
}

/**
 * The shared-connections insight behind LinkedIn's "X and N others" line —
 * only present when the request passes `includeInsights=true`.
 *
 * It hangs off the InvitationView, not the Invitation, which is why an earlier
 * guess at this shape found nothing:
 *
 *   InvitationView
 *     *invitation  -> urn of the Invitation this describes
 *     insights[]   -> { sharedInsight: { totalCount, *connections: [urn] } }
 *
 * `totalCount` is the real number of mutuals; `*connections` names only one of
 * them, resolving to a MiniProfile with a picture.
 */
function insightFrom(view: any, resolve: Resolve): InvitationInsight {
  const none: InvitationInsight = { mutualCount: 0, mutualNames: [], mutualPictures: [] };
  const insights = Array.isArray(view?.insights) ? view.insights : [];
  const shared = insights
    .map((i: any) => i?.sharedInsight ?? i?.sharedConnectionsInsight)
    .find(Boolean);
  if (!shared) return none;

  const refs = shared['*connections'] ?? shared.connections ?? [];
  const profiles = (Array.isArray(refs) ? refs : [])
    .map((r: any) => (typeof r === 'string' ? resolve(r) : r))
    .filter(Boolean);

  const mutualNames = profiles.map(displayName).filter(Boolean);
  const mutualPictures = profiles
    .map((p: any) => profilePictureUrl(p, 100, resolve))
    .filter(Boolean);

  const declared = Number(shared.totalCount ?? shared.numSharedConnections ?? NaN);
  const mutualCount = Number.isFinite(declared) ? declared : mutualNames.length;
  if (!mutualCount && !mutualNames.length) return none;
  return { mutualCount, mutualNames, mutualPictures };
}

export interface NormalizedInvitations {
  invitations: Invitation[];
  /** Sender profiles, for the shared `profiles` table. */
  profiles: Profile[];
  /**
   * How many invitation entities the server actually sent, before any of them
   * were dropped for being unreadable. The pagination walk keys off this —
   * comparing the *normalized* count against the page size would read a
   * partially-parsed full page as "end of list" and stop early.
   */
  rawCount: number;
}

export function normalizeInvitations(raw: any): NormalizedInvitations {
  const entities = included(raw);
  const byUrn = indexByUrn(entities);
  const resolve: Resolve = (urn) => byUrn.get(String(urn));

  const profilesById = new Map<string, any>();
  for (const e of entities) {
    const t = String(e?.$type || '');
    if (t.endsWith('shared.MiniProfile') || t.endsWith('profile.Profile')) {
      const id = String(e.entityUrn || '').split(':').pop();
      if (id) profilesById.set(id, e);
    }
  }

  // The insight lives on the InvitationView, which points back at its
  // Invitation — so index the views by the invitation they describe.
  const viewByInvitation = new Map<string, any>();
  for (const e of entities) {
    if (!String(e?.$type || '').endsWith('InvitationView')) continue;
    const target = ref(e, 'invitation');
    if (target) viewByInvitation.set(target, e);
  }

  const invitations: Invitation[] = [];
  const profiles: Profile[] = [];
  let rawCount = 0;
  for (const e of entities) {
    if (!String(e?.$type || '').endsWith('invitation.Invitation')) continue;
    rawCount++;
    const id = String(e.entityUrn || '').split(':').pop() || '';
    if (!id) continue;
    const fromRef = ref(e, 'fromMember') || ref(e, 'inviter');
    const memberId = fromRef.split(':').pop() || '';
    const p = profilesById.get(memberId) ?? resolve(fromRef);
    const name = displayName(p) || 'LinkedIn Member';
    const headline = String(p?.occupation || p?.headline || '');
    const pictureUrl = profilePictureUrl(p, 100, resolve);
    const publicId = String(p?.publicIdentifier || '');
    const fromUrn = toFsdProfileUrn(fromRef);
    const msg = e.message;
    invitations.push({
      id,
      sharedSecret: String(e.sharedSecret || ''),
      fromUrn,
      name,
      headline,
      pictureUrl,
      publicId,
      message: typeof msg === 'string' ? msg : String(msg?.text || ''),
      sentAt: Number(e.sentTime || e.sentAt || 0),
      status: 'pending',
      ...insightFrom(viewByInvitation.get(String(e.entityUrn)), resolve),
    });
    // Feed the shared profile cache: these are often richer than the sparse
    // profiles the Messenger API returns, and merging them means an invitation
    // row can fall back to a cached picture when this payload omits one.
    if (fromUrn) {
      profiles.push({
        urn: fromUrn,
        publicId,
        firstName: String(p?.firstName || ''),
        lastName: String(p?.lastName || ''),
        fullName: name,
        occupation: headline,
        location: '',
        pictureUrl,
      });
    }
  }
  return { invitations, profiles, rawCount };
}

/**
 * Server-side paging metadata, when the response carries it. `total` is the
 * authoritative stop condition for the invitation walk; everything else is a
 * heuristic.
 */
export function invitationPaging(raw: any): { total: number } | null {
  const p = raw?.data?.paging ?? raw?.paging;
  const total = Number(p?.total ?? NaN);
  return Number.isFinite(total) && total >= 0 ? { total } : null;
}

export function normalizeConnections(raw: any): { connections: Connection[]; profiles: Profile[] } {
  const entities = included(raw);
  const byUrn = indexByUrn(entities);
  const resolve: Resolve = (urn) => byUrn.get(String(urn));
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
    const pictureUrl = profilePictureUrl(p, 200, resolve);
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
