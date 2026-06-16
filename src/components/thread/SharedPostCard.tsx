import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import { useUIStore } from '@/store/ui-store';

import { sanitizeUrl } from '@/lib/sanitize-url';
import type { MessageAttachment } from '@/types/message';

interface LinkedInPost {
  authorName: string;
  authorHeadline: string;
  authorPicture: string;
  text: string;
  imageUrl: string;
  activityUrl: string;
}

interface SharedPostCardProps {
  attachment: MessageAttachment;
  isMe: boolean;
}

export function SharedPostCard({ attachment, isMe }: SharedPostCardProps) {
  const postUrn = attachment.postUrn || '';

  // Check cache first (reactive — updates when cache is populated by sync)
  const cached = useLiveQuery(
    () => (postUrn && db) ? db.postCache.get(postUrn) : undefined,
    [postUrn]
  );

  const [fetched, setFetched] = useState<LinkedInPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempted, setAttempted] = useState(false);

  // If not cached, fetch on-demand and cache the result
  useEffect(() => {
    if (!postUrn || cached || fetched || loading || attempted) return;
    setLoading(true);
    sendBridgeMessage({ type: 'FETCH_POST', activityUrn: postUrn })
      .then(async (res) => {
        if (res?.success && res.data) {
          setFetched(res.data);
          // Cache for future use
          await db.postCache.put({
            urn: postUrn,
            ...res.data,
            cachedAt: Date.now(),
          }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setAttempted(true);
      });
  }, [postUrn, cached, fetched, loading, attempted]);

  // Reset attempted state when switching to a different post
  useEffect(() => {
    setFetched(null);
    setAttempted(false);
  }, [postUrn]);

  // Use cached data or fetched data — treat empty sentinel entries as "not found"
  const post: LinkedInPost | null = cached && (cached.authorName || cached.text)
    ? { authorName: cached.authorName, authorHeadline: cached.authorHeadline, authorPicture: cached.authorPicture, text: cached.text, imageUrl: cached.imageUrl, activityUrl: cached.activityUrl }
    : fetched;

  const url = sanitizeUrl(attachment.externalUrl || post?.activityUrl);

  // Loading state — only show if not cached
  if (loading && !post) {
    return (
      <div className={`overflow-hidden rounded-lg border ${
        isMe ? 'border-blue-500/30 bg-blue-700/30' : 'border-ring-muted bg-surface-raised'
      }`}>
        <div className="flex min-h-[6rem] items-center gap-2 px-3 py-3">
          <div className={`h-3 w-3 animate-spin rounded-full border-2 border-t-transparent ${
            isMe ? 'border-blue-300' : 'border-fg-muted'
          }`} />
          <span className={`text-xs ${isMe ? 'text-blue-200' : 'text-fg-muted'}`}>Loading post...</span>
        </div>
      </div>
    );
  }

  // Fetched post with content
  if (post && (post.text || post.authorName)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`block overflow-hidden rounded-lg border ${
          isMe
            ? 'border-blue-500/30 bg-blue-700/30 hover:bg-blue-700/50'
            : 'border-ring-muted bg-surface-raised hover:bg-surface-hover'
        }`}
      >
        {/* Author header */}
        <div className={`flex items-center gap-2 px-3 py-2 ${
          isMe ? 'border-b border-blue-500/20' : 'border-b border-ring-muted'
        }`}>
          {post.authorPicture ? (
            <img
              src={sanitizeUrl(post.authorPicture)}
              alt={post.authorName}
              className="h-6 w-6 rounded-full object-cover"
            />
          ) : (
            <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium ${
              isMe ? 'bg-blue-600 text-blue-100' : 'bg-surface-muted text-fg-secondary'
            }`}>
              {post.authorName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className={`truncate text-xs font-medium ${isMe ? 'text-blue-100' : 'text-fg-strong'}`}>
              {post.authorName}
            </p>
            {post.authorHeadline && (
              <p className={`truncate text-[10px] leading-tight ${isMe ? 'text-blue-200/60' : 'text-fg-muted'}`}>
                {post.authorHeadline}
              </p>
            )}
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${isMe ? 'text-blue-200/60' : 'text-fg-faint'}`}>
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </div>

        {/* Post text */}
        {post.text && (
          <div className={`px-3 py-2 text-xs leading-relaxed ${isMe ? 'text-blue-50' : 'text-fg'}`}>
            <p className="line-clamp-4 whitespace-pre-wrap">{post.text}</p>
          </div>
        )}

        {/* Post image */}
        {post.imageUrl && (
          <div className="px-3 pb-2">
            <img
              src={sanitizeUrl(post.imageUrl)}
              alt=""
              className="max-w-full rounded object-contain"
              style={{ maxHeight: '200px' }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                useUIStore.getState().openLightbox(post.imageUrl);
              }}
            />
          </div>
        )}
      </a>
    );
  }

  // Fallback — failed or no content returned, show static card
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block overflow-hidden rounded-lg border ${
        isMe
          ? 'border-blue-500/30 bg-blue-700/30 hover:bg-blue-700/50'
          : 'border-ring-muted bg-surface-raised hover:bg-surface-hover'
      }`}
    >
      <div className={`flex items-center justify-between px-3 py-1.5 ${
        isMe ? 'border-b border-blue-500/20' : 'border-b border-ring-muted'
      }`}>
        <div className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isMe ? 'text-blue-200' : 'text-fg-muted'}>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span className={`text-xs font-medium ${isMe ? 'text-blue-100' : 'text-fg-secondary'}`}>Shared post</span>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${isMe ? 'text-blue-200/60' : 'text-fg-faint'}`}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </div>
      {attachment.fallbackText && (
        <div className={`px-3 py-2 text-xs leading-relaxed ${isMe ? 'text-blue-50' : 'text-fg'}`}>
          {attachment.fallbackText}
        </div>
      )}
    </a>
  );
}
