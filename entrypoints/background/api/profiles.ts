import { voyagerFetch } from './client';
import { debugLog } from '@/lib/debug-log';
import { getLinkedInCookies } from '../auth/cookies';
import { db } from '@/db/database';

export interface FetchedProfile {
  locationName: string;
  geoLocationName: string;
  headline: string;
  firstName: string;
  lastName: string;
  vanitySlug?: string;
  company?: string;
  title?: string;
  companyLogoUrl?: string;
}

export async function fetchProfile(publicId: string): Promise<FetchedProfile | null> {
  return fetchProfileFromPage(publicId);
}

/** Fetch profile by member URN (for ACo-style internal IDs). */
export async function fetchProfileByUrn(urn: string): Promise<FetchedProfile | null> {
  const memberId = urn.replace('urn:li:fsd_profile:', '');

  // Run HTML scraping (for location/slug) and Voyager API (for position) in parallel
  const [htmlResult, positionResult] = await Promise.all([
    fetchProfileFromPage(memberId),
    fetchCurrentPosition(urn),
  ]);

  if (!htmlResult) return null;

  return {
    ...htmlResult,
    company: positionResult?.company || htmlResult.company,
    title: positionResult?.title || htmlResult.title,
    companyLogoUrl: positionResult?.companyLogoUrl || htmlResult.companyLogoUrl,
  };
}

/**
 * Fetch current position (company, title, logo) via the Voyager API.
 * Uses the profilePositionGroups endpoint with full decoration.
 */
async function fetchCurrentPosition(
  profileUrn: string
): Promise<{ company: string; title: string; companyLogoUrl: string } | null> {
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

    debugLog(
      'info',
      `fetchCurrentPosition(${profileUrn}): "${pos.companyName}" / "${pos.title}", logo=${!!companyLogoUrl}`
    );

    return {
      company: pos.companyName || '',
      title: pos.title || '',
      companyLogoUrl,
    };
  } catch (err) {
    debugLog('warn', `fetchCurrentPosition(${profileUrn}): ${err}`);
    return null;
  }
}

/**
 * Enrich profiles with company, title, logo, location, and vanity slug during sync.
 * Combines the Voyager position API and HTML page scraping into a single pass
 * so the UI never needs to fetch profile data on demand.
 * Skips profiles that are already fully enriched.
 */
export async function enrichProfiles(
  urns: string[],
  concurrency = 5
): Promise<void> {
  if (urns.length === 0) return;

  // Only enrich profiles that are missing company or location
  const profiles = await Promise.all(urns.map((urn) => db.profiles.get(urn)));
  const needsEnrichment = urns.filter(
    (_, i) => profiles[i] && (!profiles[i]!.company || !profiles[i]!.location)
  );

  if (needsEnrichment.length === 0) return;
  debugLog('info', `enrichProfiles: enriching ${needsEnrichment.length}/${urns.length} profiles`);

  // Process in batches with limited concurrency
  for (let i = 0; i < needsEnrichment.length; i += concurrency) {
    const batch = needsEnrichment.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.map(async (urn) => {
        const existing = await db.profiles.get(urn);
        if (!existing) return;

        const memberId = urn.replace('urn:li:fsd_profile:', '');
        const updates: Record<string, string> = {};

        // Fetch position data and HTML page in parallel
        const [posResult, htmlResult] = await Promise.allSettled([
          !existing.company ? fetchCurrentPosition(urn) : Promise.resolve(null),
          !existing.location ? fetchProfileFromPage(memberId) : Promise.resolve(null),
        ]);

        const pos = posResult.status === 'fulfilled' ? posResult.value : null;
        const html = htmlResult.status === 'fulfilled' ? htmlResult.value : null;

        if (pos) {
          updates.company = pos.company;
          if (pos.title) updates.title = pos.title;
          if (pos.companyLogoUrl) updates.companyLogoUrl = pos.companyLogoUrl;
        }
        if (html) {
          if (html.locationName) updates.location = html.locationName;
          if (html.vanitySlug && existing.publicId?.startsWith('ACo')) updates.publicId = html.vanitySlug;
        }

        if (Object.keys(updates).length > 0) {
          await db.profiles.update(urn, updates);
        }
      })
    );
    // Small delay between batches to avoid rate limiting
    if (i + concurrency < needsEnrichment.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * Fetch the LinkedIn profile page HTML and extract location + vanity slug.
 */
async function fetchProfileFromPage(profileId: string): Promise<FetchedProfile | null> {
  const cookies = await getLinkedInCookies();
  if (!cookies) return null;

  const csrfToken = cookies.jsessionId.replace(/"/g, '');

  try {
    const res = await fetch(`https://www.linkedin.com/in/${profileId}`, {
      headers: {
        'accept': 'text/html',
        'csrf-token': csrfToken,
      },
    });

    if (!res.ok) {
      debugLog('warn', `fetchProfileFromPage(${profileId}): ${res.status}`);
      return null;
    }

    const html = await res.text();

    const locMatch = html.match(/>([^<]{3,80})<\/p>\s*<p[^>]*>\s*[·•]\s*<\/p>/);
    const locationName = locMatch?.[1]?.trim() || '';

    const slugMatch = html.match(/linkedin\.com\/in\/([a-zA-Z][a-zA-Z0-9-]+)\//);
    const vanitySlug = slugMatch?.[1] || '';

    debugLog('info', `fetchProfileFromPage(${profileId}): location="${locationName}", slug="${vanitySlug}"`);

    return {
      locationName,
      geoLocationName: '',
      headline: '',
      firstName: '',
      lastName: '',
      vanitySlug: vanitySlug || undefined,
    };
  } catch (err) {
    debugLog('warn', `fetchProfileFromPage(${profileId}): ${err}`);
    return null;
  }
}
