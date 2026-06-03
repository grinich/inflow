import { voyagerFetch } from './client';
import { debugLog } from '@/lib/debug-log';
import { pickArtifact } from '@/lib/voyager-image';

export interface LinkedInPost {
  authorName: string;
  authorHeadline: string;
  authorPicture: string;
  text: string;
  imageUrl: string;
  activityUrl: string;
}

/**
 * Fetch a LinkedIn post by its URN.
 * Handles multiple URN formats: fsd_update, activity, ugcPost, share.
 */
export async function fetchPost(urn: string): Promise<LinkedInPost | null> {
  debugLog('info', `[FETCH_POST] Raw URN: ${urn}`);

  // Skip invalid or placeholder URNs
  if (!urn || !urn.startsWith('urn:li:') || urn.includes('dummyId') ||
      !/(?:activity|ugcPost|share|fsd_update)/.test(urn)) {
    debugLog('warn', `[FETCH_POST] Skipping invalid URN: ${urn}`);
    return null;
  }

  // Extract the activity URN from fsd_update wrapper if present
  // e.g. "urn:li:fsd_update:(urn:li:activity:123,MESSAGING_RESHARE,...)" -> "urn:li:activity:123"
  const activityMatch = urn.match(/urn:li:activity:\d+/);
  const activityUrn = activityMatch ? activityMatch[0] : urn;

  if (activityUrn !== urn) {
    debugLog('info', `[FETCH_POST] Extracted activity URN: ${activityUrn}`);
  }

  // Try multiple strategies in order
  const strategies = [
    () => fetchViaFeedUpdate(activityUrn),
    () => fetchViaSocialDetail(activityUrn),
    () => fetchViaUgcPost(activityUrn),
  ];

  for (const strategy of strategies) {
    try {
      const result = await strategy();
      if (result) {
        debugLog('info', `[FETCH_POST] Success: author="${result.authorName}", text=${result.text.length} chars`);
        return result;
      }
    } catch (err) {
      debugLog('warn', `[FETCH_POST] Strategy failed: ${err}`);
    }
  }

  debugLog('warn', `[FETCH_POST] All strategies failed for ${urn}`);
  return null;
}

/** Strategy 1: /feed/updates/{urn} */
async function fetchViaFeedUpdate(urn: string): Promise<LinkedInPost | null> {
  const encoded = encodeURIComponent(urn);
  const res = await voyagerFetch(`/feed/updates/${encoded}`);
  if (!res.ok) {
    debugLog('info', `[FETCH_POST] /feed/updates/ returned ${res.status}`);
    return null;
  }
  const data = await res.json();
  debugLog('info', `[FETCH_POST] /feed/updates/ included: ${(data.included || []).length} entities, types: ${[...new Set((data.included || []).map((e: any) => e.$type))].join(', ')}`);
  return extractPostData(data, urn);
}

/** Strategy 2: /voyagerSocialGraphQL socialDetail */
async function fetchViaSocialDetail(urn: string): Promise<LinkedInPost | null> {
  const encoded = encodeURIComponent(urn);
  const res = await voyagerFetch(
    `/feed/updatesV2/${encoded}?moduleKey=feed_details&showLatestComments=false`
  );
  if (!res.ok) {
    debugLog('info', `[FETCH_POST] /feed/updatesV2/ returned ${res.status}`);
    return null;
  }
  const data = await res.json();
  debugLog('info', `[FETCH_POST] /feed/updatesV2/ included: ${(data.included || []).length} entities, types: ${[...new Set((data.included || []).map((e: any) => e.$type))].join(', ')}`);
  return extractPostData(data, urn);
}

/** Strategy 3: /ugcPosts/{urn} for ugcPost URNs */
async function fetchViaUgcPost(urn: string): Promise<LinkedInPost | null> {
  // Convert activity URN to ugcPost URN or vice versa
  const ugcUrn = urn.includes('ugcPost') ? urn : urn.replace('activity', 'ugcPost');
  const encoded = encodeURIComponent(ugcUrn);
  const res = await voyagerFetch(`/ugcPosts/${encoded}`);
  if (!res.ok) {
    debugLog('info', `[FETCH_POST] /ugcPosts/ returned ${res.status}`);
    return null;
  }
  const data = await res.json();
  debugLog('info', `[FETCH_POST] /ugcPosts/ keys: ${Object.keys(data).join(', ')}`);

  // ugcPosts returns a different structure — extract directly
  const text = data.specificContent?.['com.linkedin.ugc.ShareContent']?.shareCommentary?.text || '';
  const authorUrn = data.author || '';

  // Try to get author info
  let authorName = '';
  let authorHeadline = '';
  let authorPicture = '';

  if (data.included) {
    const profile = data.included.find((e: any) =>
      e.$type?.includes('MiniProfile') || e.$type?.includes('Profile')
    );
    if (profile) {
      authorName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim() ||
        profile.name?.text || '';
      authorHeadline = profile.occupation || profile.headline?.text || '';
      authorPicture = extractPictureUrl(profile.picture || profile.profilePicture);
    }
  }

  const activityId = urn.match(/(?:activity|ugcPost|share):(\d+)/)?.[1];
  const activityUrl = activityId
    ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
    : '';

  if (!text && !authorName) return null;

  return { authorName, authorHeadline, authorPicture, text, imageUrl: '', activityUrl };
}

function extractPostData(data: any, urn: string): LinkedInPost | null {
  const included = data.included || [];

  // If data itself has the update fields (non-included response)
  const topLevel = data.data || data;

  // Find the update entity
  const update = included.find((e: any) =>
    e.$type === 'com.linkedin.voyager.feed.render.UpdateV2' ||
    e.$type === 'com.linkedin.voyager.feed.Update' ||
    e.$type === 'com.linkedin.voyager.feed.render.FeedUpdate'
  ) || (topLevel.actor ? topLevel : null);

  // Find author info - try multiple sources
  let authorName = '';
  let authorHeadline = '';
  let authorPicture = '';
  let text = '';

  if (update) {
    // Actor from update
    const actor = update.actor;
    if (actor) {
      authorName = actor.name?.text || actor.title?.text || '';
      authorHeadline = actor.description?.text || actor.subtitle?.text || '';

      // Actor picture
      const imgAttrs = actor.image?.attributes || actor.navigationContext?.attributes;
      if (imgAttrs?.[0]) {
        const attr = imgAttrs[0];
        const miniProfile = attr.miniProfile || attr['*miniProfile'];
        if (miniProfile?.picture) {
          authorPicture = extractPictureUrl(miniProfile.picture);
        }
        // Also try detailData path
        if (!authorPicture && attr.detailData) {
          const profilePicRef = attr.detailData['*profilePicture'] || attr.detailData.profilePicture;
          if (profilePicRef) {
            const picEntity = included.find((e: any) => e.entityUrn === profilePicRef);
            if (picEntity) {
              authorPicture = extractPictureUrl(picEntity);
            }
          }
        }
      }
    }

    // Post text from commentary
    text = update.commentary?.text?.text ||
      update.commentary?.commentaryText?.text ||
      update.header?.text?.text || '';
  }

  // Fallback: find miniProfile entities for author info
  if (!authorName) {
    for (const e of included) {
      if (e.$type?.includes('MiniProfile')) {
        authorName = `${e.firstName || ''} ${e.lastName || ''}`.trim();
        authorHeadline = e.occupation || '';
        authorPicture = extractPictureUrl(e.picture);
        break;
      }
    }
  }

  // Fallback: find text from various entity types
  if (!text) {
    for (const e of included) {
      // TextComponent
      if (e.$type?.includes('TextComponent') && e.text?.text) {
        text = e.text.text;
        break;
      }
      // UGC share content
      if (e.specificContent?.['com.linkedin.ugc.ShareContent']) {
        text = e.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary?.text || '';
        if (text) break;
      }
      // Commentary directly on entity
      if (e.commentary?.text) {
        text = e.commentary.text;
        break;
      }
    }
  }

  // Get post image
  let imageUrl = '';
  if (update?.content) {
    const content = update.content;
    // ImageComponent
    const imgComp = content['com.linkedin.voyager.feed.render.ImageComponent'] ||
      content.imageComponent || content;
    if (imgComp?.images?.[0]) {
      imageUrl = extractImageUrl(imgComp.images[0], included);
    }
    // ArticleComponent with image
    const artComp = content['com.linkedin.voyager.feed.render.ArticleComponent'] ||
      content.articleComponent;
    if (!imageUrl && artComp?.largeImage) {
      imageUrl = extractImageUrl(artComp.largeImage, included);
    }
  }

  // Scan included for VectorImage entities
  if (!imageUrl) {
    for (const e of included) {
      if (e.$type === 'com.linkedin.common.VectorImage' && e.rootUrl && e.artifacts?.length) {
        const artifact = pickArtifact(e.artifacts, 400);
        if (artifact?.fileIdentifyingUrlPathSegment) {
          imageUrl = `${e.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
          break;
        }
      }
    }
  }

  // Build activity URL
  const activityId = urn.match(/(?:activity|ugcPost|share):(\d+)/)?.[1];
  const activityUrl = activityId
    ? `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}/`
    : '';

  if (!authorName && !text) {
    debugLog('info', `[FETCH_POST] No data extracted. Sample types: ${included.slice(0, 5).map((e: any) => e.$type).join(', ')}`);
    // Log first entity keys for debugging
    if (included[0]) {
      debugLog('info', `[FETCH_POST] First entity keys: ${Object.keys(included[0]).join(', ')}`);
    }
    return null;
  }

  return { authorName, authorHeadline, authorPicture, text, imageUrl, activityUrl };
}

function extractPictureUrl(pic: any): string {
  if (!pic) return '';

  // Direct vectorImage
  const vec = pic.displayImageReference?.vectorImage || pic.vectorImage || pic;
  if (vec?.rootUrl && vec?.artifacts?.length) {
    const artifact = pickArtifact(vec.artifacts, 100);
    if (artifact?.fileIdentifyingUrlPathSegment) {
      return `${vec.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
    }
  }

  // Artifacts with fileUrl
  if (pic.artifacts?.length) {
    const artifact = pickArtifact(pic.artifacts, 100);
    if (artifact?.fileUrl) return artifact.fileUrl;
  }

  return '';
}

function extractImageUrl(imageData: any, included: any[]): string {
  if (!imageData) return '';

  // Direct vectorImage on image data
  const attrs = imageData.attributes || [];
  for (const attr of attrs) {
    const vec = attr.vectorImage || attr.detailData?.vectorImage;
    if (vec?.rootUrl && vec?.artifacts?.length) {
      const artifact = pickArtifact(vec.artifacts, 400);
      if (artifact?.fileIdentifyingUrlPathSegment) {
        return `${vec.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
      }
    }
    // Reference to included entity
    const imgRef = attr.detailData?.['*vectorImage'] || attr['*vectorImage'];
    if (imgRef) {
      const imgEntity = included.find((e: any) => e.entityUrn === imgRef);
      if (imgEntity?.rootUrl && imgEntity?.artifacts?.length) {
        const artifact = pickArtifact(imgEntity.artifacts, 400);
        if (artifact?.fileIdentifyingUrlPathSegment) {
          return `${imgEntity.rootUrl}${artifact.fileIdentifyingUrlPathSegment}`;
        }
      }
    }
  }

  return '';
}

// pickArtifact is shared from '@/lib/voyager-image' (imported above).
