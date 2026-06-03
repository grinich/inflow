import { memo, useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useUIStore } from '@/store/ui-store';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { searchEmoji, type EmojiResult } from '@/lib/emoji-search';
import { EmojiAutocomplete } from './EmojiAutocomplete';

import { sanitizeUrl } from '@/lib/sanitize-url';
import { SharedPostCard } from './SharedPostCard';
import type { Message, MessageAttachment } from '@/types/message';

interface MessageBubbleProps {
  message: Message;
  /** Hide avatar and sender name (consecutive message from same sender). */
  grouped?: boolean;
  /** Whether this is the last message from the user in a consecutive group. */
  isLastInGroup?: boolean;
  /** Sender's LinkedIn profile URL, resolved once by the parent thread. */
  senderProfileUrl?: string | null;
  onRetry?: () => void;
  onDelete?: () => void;
}

function MessageBubbleImpl({ message, grouped, isLastInGroup, senderProfileUrl = null, onRetry, onDelete }: MessageBubbleProps) {
  const isMe = message.isFromMe;
  const avatarUrl = useCachedImage(message.senderPicture);
  const hasBody = message.body.trim().length > 0;
  const hasAttachments = message.attachments && message.attachments.length > 0;

  const showAvatar = !isMe && !grouped;

  const canEdit = isMe && message.status !== 'sending' && message.status !== 'failed' && message.status !== 'queued'
    && Date.now() - message.createdAt < 60 * 60 * 1000;
  const canUnsend = canEdit;
  const canReply = message.status !== 'sending' && message.status !== 'failed' && message.status !== 'queued';
  const canReact = message.status !== 'sending' && message.status !== 'failed' && message.status !== 'queued';

  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(message.body);
  const [unsendConfirm, setUnsendConfirm] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [editEmojiQuery, setEditEmojiQuery] = useState<string | null>(null);
  const [editEmojiIndex, setEditEmojiIndex] = useState(0);
  const editEmojiResults = useMemo(
    () => (editEmojiQuery !== null ? searchEmoji(editEmojiQuery) : []),
    [editEmojiQuery],
  );
  const editRef = useRef<HTMLTextAreaElement>(null);
  const unsendTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const { editMessage, reactToMessage, recallMessage } = useOptimisticAction();

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

  function insertEditEmoji(result: EmojiResult) {
    const ta = editRef.current;
    if (!ta) return;
    const pos = ta.selectionStart ?? editBody.length;
    const before = editBody.slice(0, pos);
    const colonIdx = before.lastIndexOf(':');
    if (colonIdx === -1) return;
    const newBody = editBody.slice(0, colonIdx) + result.emoji + editBody.slice(pos);
    setEditBody(newBody);
    setEditEmojiQuery(null);
    const newPos = colonIdx + result.emoji.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newPos, newPos);
    });
  }

  const handleUnsend = useCallback(() => {
    if (!unsendConfirm) {
      setUnsendConfirm(true);
      unsendTimerRef.current = setTimeout(() => setUnsendConfirm(false), 3000);
      return;
    }
    clearTimeout(unsendTimerRef.current);
    setUnsendConfirm(false);
    recallMessage(message.conversationId, message.id);
  }, [unsendConfirm, message.conversationId, message.id, recallMessage]);

  const handleQuickReact = useCallback((emoji: string) => {
    reactToMessage(message.conversationId, message.id, emoji);
  }, [message.conversationId, message.id, reactToMessage]);

  // Close emoji picker on click outside
  useEffect(() => {
    if (!emojiPickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [emojiPickerOpen]);

  // Cleanup unsend timer on unmount
  useEffect(() => () => clearTimeout(unsendTimerRef.current), []);

  // Animate only the optimistic message while it's being sent
  const isNew = message.status === 'sending' || message.status === 'queued';

  // Skip rendering recalled/empty messages (no body, no attachments, no reply
  // context). Must come AFTER all hooks so hook order stays stable when a
  // message is emptied in place (e.g. unsend/recall) — see Rules of Hooks.
  if (!hasBody && !hasAttachments && !message.repliedMessage && message.status !== 'sending' && message.status !== 'failed' && message.status !== 'queued') {
    return null;
  }

  return (
    <div data-message-id={message.id} className={`group/msg flex items-center gap-2 ${isMe ? 'flex-row-reverse' : ''} ${isNew ? 'animate-message-in' : ''}`}>
      {/* Hover timestamp + action buttons — appears to the side */}
      <span className={`shrink-0 text-[10px] leading-normal text-fg-faint opacity-0 transition-opacity group-hover/msg:opacity-100 order-last flex items-center gap-1.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
        {canReact && !editing && (
          <>
            {['👍', '😊', '😎', '👋'].map(emoji => (
              <button
                key={emoji}
                onClick={() => handleQuickReact(emoji)}
                className="cursor-pointer text-lg opacity-60 hover:opacity-100 transition-opacity"
                title={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <div className="relative" ref={emojiPickerRef}>
              <button
                onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                className="cursor-pointer text-fg-faint hover:text-fg-secondary"
                title="More reactions"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
              </button>
              {emojiPickerOpen && (
                <EmojiPickerPopover
                  onSelect={(emoji) => { handleQuickReact(emoji); setEmojiPickerOpen(false); }}
                  isMe={isMe}
                />
              )}
            </div>
          </>
        )}
        {canReply && !editing && (
          <button
            onClick={() => useUIStore.getState().setReplyingTo(message)}
            className="cursor-pointer text-fg-faint hover:text-fg-secondary"
            title="Reply"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        {canUnsend && !editing && (
          <button
            onClick={handleUnsend}
            className={`cursor-pointer ${unsendConfirm ? 'text-red-400 font-medium' : 'text-fg-faint hover:text-fg-secondary'}`}
          >
            {unsendConfirm ? 'sure?' : 'unsend'}
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
              <div className="relative">
              <textarea
                ref={editRef}
                value={editBody}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditBody(val);
                  const pos = e.target.selectionStart ?? val.length;
                  const before = val.slice(0, pos);
                  const match = before.match(/:([a-z0-9_+-]*)$/);
                  if (match) {
                    setEditEmojiQuery(match[1]);
                    setEditEmojiIndex(0);
                  } else {
                    setEditEmojiQuery(null);
                  }
                }}
                onKeyDown={(e) => {
                  if (editEmojiQuery !== null && editEmojiResults.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditEmojiIndex((i) => (i + 1) % editEmojiResults.length);
                      return;
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditEmojiIndex((i) => (i - 1 + editEmojiResults.length) % editEmojiResults.length);
                      return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      e.stopPropagation();
                      insertEditEmoji(editEmojiResults[editEmojiIndex]);
                      return;
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditEmojiQuery(null);
                      return;
                    }
                  }
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
                onBlur={() => setEditEmojiQuery(null)}
                data-emoji-open={editEmojiQuery !== null && editEmojiResults.length > 0 ? '' : undefined}
                className="w-full resize-none rounded-lg bg-blue-700/50 px-2 py-1 text-sm text-white outline-none placeholder:text-blue-200/50"
                rows={Math.min(6, editBody.split('\n').length + 1)}
              />
              {editEmojiQuery !== null && editEmojiResults.length > 0 && (
                <EmojiAutocomplete
                  results={editEmojiResults}
                  selectedIndex={editEmojiIndex}
                  query={editEmojiQuery}
                  onSelect={insertEditEmoji}
                  onClose={() => setEditEmojiQuery(null)}
                />
              )}
              </div>
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
        {/* Reaction pills */}
        {message.reactions && message.reactions.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${isMe ? 'justify-end' : ''}`}>
            {message.reactions.map(r => (
              <button
                key={r.emoji}
                onClick={() => handleQuickReact(r.emoji)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm cursor-pointer transition-colors ${
                  r.viewerReacted
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700'
                    : 'bg-surface-hover text-fg-secondary hover:bg-surface-muted'
                }`}
              >
                <span>{r.emoji}</span>
                {r.count > 1 && <span>{r.count}</span>}
              </button>
            ))}
          </div>
        )}
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

/**
 * Memoization comparator. useThread returns fresh message objects on every live
 * query, so the default shallow `message` reference check would never skip a
 * render. Compare the specific fields the bubble actually renders instead. The
 * onRetry/onDelete callbacks are recreated each parent render but their behavior
 * is keyed on the (compared) message, so only their presence matters.
 */
export function arePropsEqual(a: MessageBubbleProps, b: MessageBubbleProps): boolean {
  if (
    a.grouped !== b.grouped ||
    a.isLastInGroup !== b.isLastInGroup ||
    a.senderProfileUrl !== b.senderProfileUrl ||
    !!a.onRetry !== !!b.onRetry ||
    !!a.onDelete !== !!b.onDelete
  ) {
    return false;
  }
  const m = a.message;
  const n = b.message;
  return (
    m.id === n.id &&
    m.conversationId === n.conversationId &&
    m.senderUrn === n.senderUrn &&
    m.senderName === n.senderName &&
    m.senderPicture === n.senderPicture &&
    m.body === n.body &&
    m.createdAt === n.createdAt &&
    m.isFromMe === n.isFromMe &&
    m.status === n.status &&
    m.failReason === n.failReason &&
    m.editedAt === n.editedAt &&
    m.seenAt === n.seenAt &&
    JSON.stringify(m.reactions) === JSON.stringify(n.reactions) &&
    JSON.stringify(m.attachments) === JSON.stringify(n.attachments) &&
    JSON.stringify(m.repliedMessage) === JSON.stringify(n.repliedMessage)
  );
}

export const MessageBubble = memo(MessageBubbleImpl, arePropsEqual);

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

// Matches email addresses
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Matches URLs with protocol, or bare domains like dribbble.com/path
const URL_REGEX = /(?:https?:\/\/[^\s<>"')\]]+)|(?:(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|io|co|dev|app|me|info|biz|us|uk|ca|de|fr|es|it|nl|au|in|xyz|tech|design|art|studio|page|site|so|ly|to|cc|gg|fm|tv|ai|sh))\b(?:\/[^\s<>"')\],]*)?)/gi;

function Linkify({ text, isMe }: { text: string; isMe: boolean }) {
  const linkClass = `underline break-all ${isMe ? 'text-blue-100 hover:text-white' : 'text-blue-500 hover:text-blue-600'}`;

  // Collect all matches (emails + URLs) with their positions
  const matches: { index: number; length: number; href: string; display: string }[] = [];

  // Find emails first — they take priority over URL matches
  EMAIL_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMAIL_REGEX.exec(text)) !== null) {
    matches.push({ index: m.index, length: m[0].length, href: `mailto:${m[0]}`, display: m[0] });
  }

  // Find URLs, skipping any that overlap with email matches
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    const raw = m[0];
    const cleaned = raw.replace(/[.,;:!?]+$/, '');
    const start = m.index;
    const end = start + raw.length;

    // Skip if this URL overlaps with any email match (e.g. "gmail.com" inside "user@gmail.com")
    const overlapsEmail = matches.some(
      (em) => start < em.index + em.length && end > em.index
    );
    if (overlapsEmail) continue;

    const href = sanitizeUrl(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    matches.push({ index: start, length: raw.length, href, display: cleaned });
  }

  // Sort by position
  matches.sort((a, b) => a.index - b.index);

  // Build parts
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <a
        key={match.index}
        href={match.href}
        target={match.href.startsWith('mailto:') ? undefined : '_blank'}
        rel="noopener noreferrer"
        className={linkClass}
      >
        {match.display}
      </a>
    );
    lastIndex = match.index + match.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}

const EMOJI_GRID = [
  '👍', '👎', '❤️', '😊', '😂',
  '😎', '🙏', '🔥', '👏', '💯',
  '😍', '🎉', '👋', '🤔', '😮',
  '😢', '✅', '⭐', '🚀', '💪',
];

function EmojiPickerPopover({ onSelect, isMe }: { onSelect: (emoji: string) => void; isMe: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<'above' | 'below' | null>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    // Find the scroll container to get the usable top boundary (below the header)
    const scrollContainer = ref.current.closest('[data-scroll-container]');
    const topBound = scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
    setPlacement(rect.top < topBound ? 'below' : 'above');
  }, []);

  return (
    <div
      ref={ref}
      className={`absolute z-50 w-[200px] grid grid-cols-5 gap-0.5 rounded-lg border border-border bg-surface-raised p-1.5 shadow-lg ${
        placement === null ? 'bottom-full mb-1 invisible' : placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
      } ${isMe ? 'right-0' : 'left-0'}`}
    >
      {EMOJI_GRID.map(emoji => (
        <button
          key={emoji}
          onClick={() => onSelect(emoji)}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded text-lg hover:bg-surface-hover transition-colors"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
