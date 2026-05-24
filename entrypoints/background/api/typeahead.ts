import { voyagerFetch } from './client';
import { getMemberUrn } from '../auth/session';
import { debugLog } from '@/lib/debug-log';

export interface TypeaheadResult {
  name: string;
  headline: string;
  pictureUrl: string;
  profileUrn: string;
}

export async function searchTypeahead(query: string): Promise<TypeaheadResult[]> {
  const memberUrn = await getMemberUrn();

  const variables = `(keyword:${query},types:List(CONNECTIONS,GROUP_THREADS,PEOPLE,COWORKERS))`;
  const queryId = 'voyagerMessagingDashMessagingTypeahead.7f566173ac0c94b510b3dc2b2a6763d4';
  const res = await voyagerFetch(
    `/graphql?includeWebMetadata=true&variables=${variables}&queryId=${queryId}`
  );

  if (!res.ok) {
    debugLog('error', `typeahead failed: ${res.status}`);
    throw new Error(`Typeahead search failed: ${res.status}`);
  }

  const data = await res.json();
  const included = data.included || [];
  const results: TypeaheadResult[] = [];

  for (const entity of included) {
    if (entity.$type !== 'com.linkedin.voyager.dash.identity.profile.Profile') continue;

    const profileUrn = entity.entityUrn;
    if (!profileUrn) continue;

    // Skip self
    if (profileUrn === memberUrn) continue;

    const firstName = entity.firstName || '';
    const lastName = entity.lastName || '';
    const name = `${firstName} ${lastName}`.trim() || 'Unknown';
    const headline = entity.headline || '';

    let pictureUrl = '';
    const vectorImage = entity.profilePicture?.displayImageReferenceResolutionResult?.vectorImage;
    if (vectorImage?.rootUrl && vectorImage?.artifacts?.length) {
      const artifact = vectorImage.artifacts.sort((a: any, b: any) => (a.width || 0) - (b.width || 0))
        .find((a: any) => (a.width || 0) >= 100) || vectorImage.artifacts[0];
      if (artifact?.fileIdentifyingUrlPathSegment) {
        pictureUrl = `${vectorImage.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
      }
    }

    results.push({ name, headline, pictureUrl, profileUrn });
  }

  debugLog('info', `typeahead: "${query}" → ${results.length} results`);
  return results;
}
