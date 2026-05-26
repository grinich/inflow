import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { sendBridgeMessage } from '@/lib/bridge';
import { useUIStore } from '@/store/ui-store';

function sanitizeUrl(url: string | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return '#';
  return trimmed;
}
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
    () => postUrn ? db.postCache.get(postUrn) : undefined,
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
              src={post.authorPicture}
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
              src={post.imageUrl}
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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className={isMe ? 'text-blue-200' : 'text-[#0A66C2]'}>
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
          <span className={`text-xs font-medium ${isMe ? 'text-blue-100' : 'text-fg-secondary'}`}>LinkedIn Post</span>
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
