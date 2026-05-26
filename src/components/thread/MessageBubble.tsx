import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/database';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useUIStore } from '@/store/ui-store';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';

/** Block dangerous URL protocols (javascript:, data:, vbscript:, etc.) */
function sanitizeUrl(url: string | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return '#'; // block all other protocols
  return trimmed;
}
import { SharedPostCard } from './SharedPostCard';
import type { Message, MessageAttachment } from '@/types/message';

interface MessageBubbleProps {
  message: Message;
  /** Hide avatar and sender name (consecutive message from same sender). */
  grouped?: boolean;
  /** Whether this is the last message from the user in a consecutive group. */
  isLastInGroup?: boolean;
  onRetry?: () => void;
  onDelete?: () => void;
}

export function MessageBubble({ message, grouped, isLastInGroup, onRetry, onDelete }: MessageBubbleProps) {
  const isMe = message.isFromMe;
  const avatarUrl = useCachedImage(message.senderPicture);
  const hasBody = message.body.trim().length > 0;
  const hasAttachments = message.attachments && message.attachments.length > 0;
  const showAvatar = !isMe && !grouped;

  // Look up sender's publicId for profile link (only when avatar is visible)
  const senderProfile = useLiveQuery(
    () => showAvatar && message.senderUrn ? db.profiles.get(message.senderUrn) : undefined,
    [showAvatar, message.senderUrn]
  );
  const senderProfileUrl = senderProfile?.publicId
    ? `https://www.linkedin.com/in/${senderProfile.publicId}`
    : null;
  const canEdit = isMe && message.status !== 'sending' && message.status !== 'failed' && message.status !== 'queued'
    && Date.now() - message.createdAt < 60 * 60 * 1000;
  const canReply = message.status !== 'sending' && message.status !== 'failed' && message.status !== 'queued';

  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const { editMessage } = useOptimisticAction();

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [editing]);

  const handleEditSave = async () => {
    if (editBody.trim() === message.body.trim()) {
      setEditing(false);
      return;
    }
    const ok = await editMessage(message.conversationId, message.id, editBody.trim());
    if (ok) setEditing(false);
  };

  // Animate only the optimistic message while it's being sent
  const isNew = message.status === 'sending' || message.status === 'queued';

  return (
    <div data-message-id={message.id} className={`group/msg flex items-center gap-2 ${isMe ? 'flex-row-reverse' : ''} ${isNew ? 'animate-message-in' : ''}`}>
      {/* Hover timestamp + edit/reply buttons — appears to the side */}
      <span className={`shrink-0 w-24 text-[10px] text-fg-faint opacity-0 transition-opacity group-hover/msg:opacity-100 order-last flex items-center gap-1 ${isMe ? 'justify-end' : 'justify-start'}`}>
        {canReply && !editing && (
          <button
            onClick={() => useUIStore.getState().setReplyingTo(message)}
            className="cursor-pointer text-fg-faint hover:text-fg-secondary"
            title="Reply"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 17 4 12 9 7" />
              <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
            </svg>
          </button>
        )}
        {canEdit && !editing && (
          <button
            onClick={() => { setEditBody(message.body); setEditing(true); }}
            className="cursor-pointer text-fg-faint hover:text-fg-secondary"
          >
            edit
          </button>
        )}
        {formatHoverTime(message.createdAt)}
      </span>

      {/* Avatar (or spacer for grouped messages) */}
      {!isMe && (
        <div className="h-8 w-8 shrink-0">
          {showAvatar ? (
            senderProfileUrl ? (
              <a href={senderProfileUrl} target="_blank" rel="noopener noreferrer" className="block h-8 w-8 overflow-hidden rounded-full bg-surface-muted">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={message.senderName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-medium text-fg-secondary">
                    {message.senderName.charAt(0).toUpperCase()}
                  </div>
                )}
              </a>
            ) : (
              <div className="h-8 w-8 overflow-hidden rounded-full bg-surface-muted">
                {avatarUrl ? (
                  <img src={avatarUrl} alt={message.senderName} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs font-medium text-fg-secondary">
                    {message.senderName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
            )
          ) : null}
        </div>
      )}

      {/* Bubble */}
      <div className={`max-w-[70%] ${isMe ? 'items-end' : 'items-start'}`}>
        {showAvatar && (
          <p className="mb-0.5 text-xs font-medium text-fg-secondary">{message.senderName}</p>
        )}
        <div
          className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
            isMe
              ? 'bg-blue-600 text-white'
              : 'bg-surface-raised text-fg'
          }`}
        >
          {editing ? (
            <div className="flex flex-col gap-1.5">
              <textarea
                ref={editRef}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleEditSave();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(false);
                  }
                }}
                className="w-full resize-none rounded-lg bg-blue-700/50 px-2 py-1 text-sm text-white outline-none placeholder:text-blue-200/50"
                rows={Math.min(6, editBody.split('\n').length + 1)}
              />
              <div className="flex justify-end gap-1.5">
                <button
                  onClick={() => setEditing(false)}
                  className="cursor-pointer rounded px-2 py-0.5 text-xs text-blue-200 hover:bg-blue-700/50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  className="cursor-pointer rounded bg-white/20 px-2 py-0.5 text-xs text-white hover:bg-white/30"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              {message.repliedMessage && (
                <button
                  type="button"
                  onClick={() => {
                    const mid = message.repliedMessage?.messageId;
                    if (!mid) {
                      useUIStore.getState().showToast({ message: 'Original message not available' });
                      return;
                    }
                    const el = document.querySelector(`[data-message-id="${CSS.escape(mid)}"]`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.remove('animate-highlight');
                      // Force reflow to restart animation
                      void (el as HTMLElement).offsetWidth;
                      el.classList.add('animate-highlight');
                    } else {
                      useUIStore.getState().showToast({ message: 'Original message not loaded' });
                    }
                  }}
                  className={`mb-1.5 w-full cursor-pointer rounded-lg border-l-2 px-2.5 py-1.5 text-left text-xs transition-opacity hover:opacity-80 ${
                    isMe
                      ? 'border-blue-300/50 bg-blue-700/40 text-blue-100'
                      : 'border-fg-faint/30 bg-surface-hover text-fg-muted'
                  }`}
                >
                  <span className="font-medium">{message.repliedMessage.senderName || 'Unknown'}</span>
                  <p className="mt-0.5 line-clamp-2 opacity-80">{message.repliedMessage.body}</p>
                </button>
              )}
              {hasBody && <p className="whitespace-pre-wrap"><Linkify text={message.body} isMe={isMe} /></p>}
              {hasAttachments && (
                <div className={`flex flex-col gap-2 ${hasBody || message.repliedMessage ? 'mt-2' : ''}`}>
                  {message.attachments!.map((att, i) => (
                    <AttachmentView key={i} attachment={att} isMe={isMe} />
                  ))}
                </div>
              )}
              {!hasBody && !hasAttachments && !message.repliedMessage && '\u00A0'}
            </>
          )}
        </div>
        {/* Edited indicator */}
        {message.editedAt && !editing && (
          <div className={`mt-0.5 text-[10px] text-fg-faint ${isMe ? 'text-right' : ''}`}>(edited)</div>
        )}
        {/* Read receipt indicators — only show on last message in group */}
        {isMe && message.status !== 'sending' && message.status !== 'failed' && message.status !== 'queued' && isLastInGroup && !editing && (
          <div className={`mt-0.5 text-[10px] ${isMe ? 'text-right' : ''}`}>
            {message.seenAt ? (
              <span className="text-blue-400">✓✓</span>
            ) : (
              <span className="text-fg-faint">✓</span>
            )}
          </div>
        )}
        {/* Status indicators */}
        {isMe && message.status !== 'sending' && message.status !== 'failed' && message.status !== 'queued' && hasAttachments && !isLastInGroup && (
          <div className={`mt-0.5 text-xs text-fg-faint ${isMe ? 'text-right' : ''}`}>delivered</div>
        )}
        {(message.status === 'sending' || message.status === 'failed' || message.status === 'queued') && (
          <div className={`mt-0.5 flex items-center gap-1.5 text-xs text-fg-faint ${isMe ? 'justify-end' : ''}`}>
            {message.status === 'sending' && <span className="text-fg-muted">Sending...</span>}
            {message.status === 'queued' && <span className="text-yellow-400">Queued — will send when online</span>}
            {message.status === 'failed' && (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <button onClick={onRetry} className="cursor-pointer text-red-400 hover:text-red-300">
                    Failed — Click to retry
                  </button>
                  <span className="text-fg-faint">or</span>
                  <button onClick={onDelete} className="cursor-pointer text-red-400 hover:text-red-300">
                    delete
                  </button>
                </div>
                {message.failReason && (
                  <p className="text-[10px] text-red-400/80">{message.failReason}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Time gap (ms) before showing a separator between message groups. */
export const TIME_GAP_MS = 5 * 60 * 1000; // 5 minutes

function AttachmentView({ attachment, isMe }: { attachment: MessageAttachment; isMe: boolean }) {
  switch (attachment.type) {
    case 'image':
      return <ImageAttachment url={attachment.imageUrl!} />;

    case 'gif':
      return attachment.imageUrl ? (
        <GifAttachment attachment={attachment} />
      ) : (
        <div className={`rounded-lg px-3 py-2 text-xs italic ${
          isMe ? 'bg-blue-700/50 text-blue-100' : 'bg-surface-hover text-fg-muted'
        }`}>
          {attachment.fallbackText || 'GIF'}
        </div>
      );

    case 'sharedPost':
      return <SharedPostCard attachment={attachment} isMe={isMe} />;

    case 'file':
      return (
        <a
          href={sanitizeUrl(attachment.fileUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
            isMe
              ? 'bg-blue-700/50 text-blue-100 hover:bg-blue-700/70'
              : 'bg-surface-hover text-fg-secondary hover:bg-surface-muted'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="truncate">{attachment.fileName || 'File'}</span>
          {attachment.fileSize && (
            <span className="shrink-0 opacity-60">{formatFileSize(attachment.fileSize)}</span>
          )}
        </a>
      );

    case 'video':
      return (
        <a
          href={sanitizeUrl(attachment.externalUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
            isMe
              ? 'bg-blue-700/50 text-blue-100 hover:bg-blue-700/70'
              : 'bg-surface-hover text-fg-secondary hover:bg-surface-muted'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>Video</span>
        </a>
      );

    case 'audio':
      return (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          isMe ? 'bg-blue-700/50 text-blue-100' : 'bg-surface-hover text-fg-secondary'
        }`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
          </svg>
          <span>Audio message</span>
        </div>
      );

    case 'externalMedia':
      return (
        <a
          href={sanitizeUrl(attachment.externalUrl)}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
            isMe
              ? 'bg-blue-700/50 text-blue-100 hover:bg-blue-700/70'
              : 'bg-surface-hover text-fg-secondary hover:bg-surface-muted'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          <span className="truncate">{attachment.fallbackText || 'Link'}</span>
        </a>
      );

    default:
      if (attachment.fallbackText) {
        return (
          <div className={`rounded-lg px-3 py-2 text-xs italic ${
            isMe ? 'bg-blue-700/50 text-blue-100' : 'bg-surface-hover text-fg-muted'
          }`}>
            {attachment.fallbackText}
          </div>
        );
      }
      return null;
  }
}

function ImageAttachment({ url }: { url: string }) {
  const cachedUrl = useCachedImage(url);
  return (
    <button
      onClick={() => useUIStore.getState().openLightbox(cachedUrl)}
      className="block min-h-[4rem] cursor-zoom-in overflow-hidden rounded-lg transition-transform hover:scale-[1.02]"
    >
      <img
        src={cachedUrl}
        alt="Shared image"
        className="max-h-96 max-w-full rounded-lg object-contain"
      />
    </button>
  );
}

function GifAttachment({ attachment }: { attachment: MessageAttachment }) {
  const cachedUrl = useCachedImage(attachment.imageUrl);
  return (
    <div className="overflow-hidden rounded-lg">
      <img
        src={cachedUrl}
        alt={attachment.fallbackText || 'GIF'}
        className="max-h-64 max-w-full rounded-lg object-contain"
        style={attachment.width && attachment.height
          ? { aspectRatio: `${attachment.width}/${attachment.height}` }
          : undefined}
      />
    </div>
  );
}

/** Short time for hover tooltip (e.g. "2:30 PM"). */
function formatHoverTime(ts: number): string {
  if (!ts || typeof ts !== 'number' || isNaN(ts)) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return format(d, 'h:mm a');
  } catch {
    return '';
  }
}

/** Format a timestamp for a group separator. */
export function formatSeparatorTime(ts: number): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const sameYear = d.getFullYear() === now.getFullYear();

    if (isToday) return format(d, 'h:mm a');
    if (isYesterday) return `Yesterday, ${format(d, 'h:mm a')}`;
    if (sameYear) return format(d, 'MMM d, h:mm a');
    return format(d, 'MMM d, yyyy, h:mm a');
  } catch {
    return '';
  }
}

// Matches URLs with protocol, or bare domains like dribbble.com/path
const URL_REGEX = /(?:https?:\/\/[^\s<>"')\]]+)|(?:(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|co|dev|app|me|info|biz|us|uk|ca|de|fr|es|it|nl|au|in|xyz|tech|design|art|studio|page|site|so|ly|to|cc|gg|fm|tv|ai|sh))\b(?:\/[^\s<>"')\],]*)?)/gi;

function Linkify({ text, isMe }: { text: string; isMe: boolean }) {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    // Strip trailing punctuation that's likely not part of the URL
    const cleaned = raw.replace(/[.,;:!?]+$/, '');
    const href = cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;
    parts.push(
      <a
        key={match.index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`underline break-all ${isMe ? 'text-blue-100 hover:text-white' : 'text-blue-500 hover:text-blue-600'}`}
      >
        {cleaned}
      </a>
    );
    // Advance past the full match so stripped trailing chars become plain text
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
