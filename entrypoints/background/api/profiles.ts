import { voyagerFetch } from './client';
import { debugLog } from '@/lib/debug-log';

export interface FetchedProfile {
  company?: string;
  title?: string;
  companyLogoUrl?: string;
  locationName?: string;
  vanitySlug?: string;
}

// In-flight dedup: if a fetch for the same URN is already pending, reuse it
const inFlight = new Map<string, Promise<FetchedProfile | null>>();

/**
 * Fetch enriched profile data by URN via the Voyager API.
 * Returns current position (company, title, logo).
 * Deduplicates concurrent requests for the same URN.
 */
export async function fetchProfileByUrn(urn: string): Promise<FetchedProfile | null> {
  const existing = inFlight.get(urn);
  if (existing) return existing;

  const promise = fetchCurrentPosition(urn).finally(() => {
    inFlight.delete(urn);
  });
  inFlight.set(urn, promise);
  return promise;
}

/**
 * Fetch current position (company, title, logo) via the Voyager API.
 * Uses the profilePositionGroups endpoint with full decoration.
 */
async function fetchCurrentPosition(
  profileUrn: string
): Promise<FetchedProfile | null> {
  try {
    const encoded = encodeURIComponent(profileUrn);
    const res = await voyagerFetch(
      `/identity/dash/profilePositionGroups?q=viewee&profileUrn=${encoded}&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfilePositionGroup-47`
    );
    if (!res.ok) {
      debugLog('info', `fetchCurrentPosition(${profileUrn}): ${res.status}`);
      return null;
    }

    const data = await res.json();
    const included: any[] = data.included || [];

    // Find current positions: has a title, no end date, sorted by most recent start
    const currentPositions = included
      .filter(
        (e: any) =>
          (e.$type || '').includes('.Position') &&
          e.title &&
          !e.dateRange?.end
      )
      .sort((a: any, b: any) => {
        const aD = (a.dateRange?.start?.year || 0) * 12 + (a.dateRange?.start?.month || 0);
        const bD = (b.dateRange?.start?.year || 0) * 12 + (b.dateRange?.start?.month || 0);
        return bD - aD;
      });

    const pos = currentPositions[0];
    if (!pos) return null;

    // Find matching Company entity for the logo
    let companyLogoUrl = '';
    const companyEntity = included.find(
      (e: any) => (e.$type || '').includes('Company') && e.entityUrn === pos.companyUrn
    );
    if (companyEntity?.logo?.vectorImage) {
      const vi = companyEntity.logo.vectorImage;
      if (vi.rootUrl && vi.artifacts?.length) {
        const artifact =
          vi.artifacts
            .sort((a: any, b: any) => (a.width || 0) - (b.width || 0))
            .find((a: any) => (a.width || 0) >= 50) || vi.artifacts[0];
        if (artifact?.fileIdentifyingUrlPathSegment) {
          companyLogoUrl = vi.rootUrl + artifact.fileIdentifyingUrlPathSegment;
        }
      }
    }

    // Extract location from the position if available
    const locationName = pos.locationName || pos.geoLocationName || '';

    debugLog(
      'info',
      `fetchCurrentPosition(${profileUrn}): "${pos.companyName}" / "${pos.title}", logo=${!!companyLogoUrl}`
    );

    return {
      company: pos.companyName || '',
      title: pos.title || '',
      companyLogoUrl: companyLogoUrl || undefined,
      locationName: locationName || undefined,
    };
  } catch (err) {
    debugLog('warn', `fetchCurrentPosition(${profileUrn}): ${err}`);
    return null;
  }
}
