import { fetchPost } from '../api/posts';
import { db } from '@/db/database';
import { debugLog } from '@/lib/debug-log';
import type { Message } from '@/types/message';

const POST_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/** In-flight post fetches — deduplicates concurrent prefetch calls for the same URN. */
const _inflightPostFetches = new Map<string, Promise<void>>();

/**
 * Scan messages for sharedPost attachments and pre-fetch + cache the post data.
 * Skips posts that are already cached and not stale.
 * Deduplicates in-flight fetches so the same post is only fetched once even
 * when multiple concurrent prefetch passes reference it.
 * Runs in background (non-blocking) — call with .catch() to avoid unhandled rejections.
 */
export async function prefetchSharedPosts(messages: Message[]): Promise<void> {
  // Collect unique post URNs
  const postUrns = new Set<string>();
  for (const msg of messages) {
    if (!msg.attachments) continue;
    for (const att of msg.attachments) {
      if (att.type === 'sharedPost' && att.postUrn) {
        postUrns.add(att.postUrn);
      }
    }
  }

  if (postUrns.size === 0) return;

  // Check which are already cached and fresh (read-only — safe to interleave).
  const now = Date.now();
  const candidates: string[] = [];
  for (const urn of postUrns) {
    if (_inflightPostFetches.has(urn)) continue;
    const cached = await db.postCache.get(urn);
    if (cached && (now - cached.cachedAt) < POST_CACHE_TTL) {
      continue; // still fresh
    }
    candidates.push(urn);
  }

  if (candidates.length === 0) return;

  debugLog('info', `[PREFETCH] Fetching up to ${candidates.length} shared post(s)...`);

  for (const urn of candidates) {
    // Re-check + claim with no await in between, so a concurrent caller that
    // already started this URN isn't fetched a second time.
    if (_inflightPostFetches.has(urn)) continue;
    const promise = _fetchAndCachePost(urn, now);
    _inflightPostFetches.set(urn, promise);
    // Await sequentially to avoid flooding the API
    await promise;
  }
}

async function _fetchAndCachePost(urn: string, now: number): Promise<void> {
  try {
    const post = await fetchPost(urn);
    if (post) {
      await db.postCache.put({
        urn,
        authorName: post.authorName,
        authorHeadline: post.authorHeadline,
        authorPicture: post.authorPicture,
        text: post.text,
        imageUrl: post.imageUrl,
        activityUrl: post.activityUrl,
        cachedAt: Date.now(),
      });
      debugLog('info', `[PREFETCH] Cached post: ${post.authorName} — ${post.text.substring(0, 60)}`);
    } else {
      // Cache "not found" so we don't retry invalid/unfetchable URNs every cycle
      await db.postCache.put({
        urn,
        authorName: '', authorHeadline: '', authorPicture: '',
        text: '', imageUrl: '', activityUrl: '',
        cachedAt: Date.now(),
      }).catch(() => {});
      debugLog('info', `[PREFETCH] Cached not-found sentinel for: ${urn}`);
    }
  } catch (err) {
    debugLog('warn', `[PREFETCH] Failed for ${urn}: ${err}`);
  } finally {
    _inflightPostFetches.delete(urn);
  }
}
