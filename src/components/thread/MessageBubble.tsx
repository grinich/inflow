import { memo, useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback, type ReactNode } from 'react';
import { format } from 'date-fns';
import { useCachedImage } from '@/hooks/useCachedImage';
import { useUIStore } from '@/store/ui-store';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { searchEmoji, EMOJI_SHORTCODE_RE, type EmojiResult } from '@/lib/emoji-search';
import { edgeShift } from '@/lib/edge-clamp';
import { EmojiAutocomplete } from './EmojiAutocomplete';

import { sanitizeUrl } from '@/lib/sanitize-url';
import { SharedPostCard } from './SharedPostCard';
import type { Message, MessageAttachment, MessageMention } from '@/types/message';

/** Icon button inside the floating hover-action card. */
const ACTION_BUTTON =
  'flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-strong';

/**
 * Keeps an overlay inside the thread's scroll container, which clips
 * horizontally. Measure on the interaction that reveals the overlay (hover,
 * open) rather than on mount — every bubble carries one, and a layout read per
 * bubble on every render would be wasted work.
 */
function useEdgeClamp<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shift, setShift] = useState(0);
  // The shift currently baked into the element's transform, so a re-measure
  // describes the overlay's natural position rather than the corrected one.
  const applied = useRef(0);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const container = el.closest('[data-scroll-container]');
    const bounds = container
      ? container.getBoundingClientRect()
      : { left: 0, right: window.innerWidth };
    const next = edgeShift(
      { left: rect.left - applied.current, right: rect.right - applied.current },
      bounds,
    );
    if (next !== applied.current) {
      applied.current = next;
      setShift(next);
    }
  }, []);

  return {
    ref,
    measure,
    style: shift ? { transform: `translateX(${shift}px)` } : undefined,
  };
}

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
  const unsendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const actionsClamp = useEdgeClamp<HTMLDivElement>();
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
    if (unsendTimerRef.current) clearTimeout(unsendTimerRef.current);
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
  useEffect(() => () => {
    if (unsendTimerRef.current) clearTimeout(unsendTimerRef.current);
  }, []);

  // Pop-in animation for reactions that newly appear in real time. The set of
  // emojis present at first render is seeded as "already seen" so reactions
  // that exist on thread open / scroll don't animate — only ones added after
  // the bubble is on screen do.
  const reactionEmojis = (message.reactions ?? []).map((r) => r.emoji);
  const seenReactionsRef = useRef<Set<string> | null>(null);
  if (seenReactionsRef.current === null) seenReactionsRef.current = new Set(reactionEmojis);
  const newlyAddedReactions = reactionEmojis.filter((e) => !seenReactionsRef.current!.has(e));
  useEffect(() => {
    seenReactionsRef.current = new Set(reactionEmojis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactionEmojis.join('\u0000')]);

  // Animate only the optimistic message while it's being sent
  const isNew = message.status === 'sending' || message.status === 'queued';

  // Skip rendering recalled/empty messages (no body, no attachments, no reply
  // context). Must come AFTER all hooks so hook order stays stable when a
  // message is emptied in place (e.g. unsend/recall) — see Rules of Hooks.
  if (!hasBody && !hasAttachments && !message.repliedMessage && message.status !== 'sending' && message.status !== 'failed' && message.status !== 'queued') {
    return null;
  }

  return (
    <div
      data-message-id={message.id}
      onMouseEnter={actionsClamp.measure}
      className={`group/msg flex items-center gap-2 ${isMe ? 'flex-row-reverse' : ''} ${isNew ? 'animate-message-in' : ''}`}
    >
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
      <div className={`relative max-w-[min(75%,42rem)] ${isMe ? 'items-end' : 'items-start'}`}>
        {/* Hover timestamp — overlaid beside the bubble instead of in the flex
            flow, so the (invisible) label doesn't reserve row width and squeeze
            bubbles when the thread pane is narrow. */}
        <span
          data-hover-time
          className={`pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center whitespace-nowrap text-[10px] leading-normal text-fg-faint opacity-0 transition-opacity group-hover/msg:opacity-100 ${isMe ? 'right-full mr-2' : 'left-full ml-2'}`}
        >
          {formatHoverTime(message.createdAt)}
        </span>
        {showAvatar && (
          <p className="mb-0.5 text-xs font-medium text-fg-secondary">{message.senderName}</p>
        )}
        <div className="relative">
        {/* Hover actions — a floating card straddling the bubble's top right
            corner, on sent and received messages alike. Anchoring it to the
            bubble instead of the gutter beside it means the pane never has to
            find ~230px of free space next to a wide bubble, which it often
            can't: the strip used to clip at the pane edge, taking the picker
            button with it. */}
        {!editing && (canReact || canReply || canEdit || canUnsend) && (
          <div
            ref={actionsClamp.ref}
            data-hover-actions
            style={actionsClamp.style}
            className={`absolute -top-5 z-20 flex items-center gap-0.5 rounded-full border border-edge bg-surface px-1 py-0.5 shadow-md transition-opacity ${
              emojiPickerOpen
                ? 'opacity-100'
                : 'pointer-events-none opacity-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100'
            } right-2`}
          >
            {canReact && (
              <>
                {['👍', '😊', '😎', '👋'].map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => handleQuickReact(emoji)}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-base transition-colors hover:bg-surface-hover"
                    title={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
                <div className="relative flex" data-emoji-anchor ref={emojiPickerRef}>
                  <button
                    onClick={() => setEmojiPickerOpen(!emojiPickerOpen)}
                    className={ACTION_BUTTON}
                    title="More reactions"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                      <line x1="9" y1="9" x2="9.01" y2="9" />
                      <line x1="15" y1="9" x2="15.01" y2="9" />
                    </svg>
                  </button>
                  {emojiPickerOpen && (
                    <EmojiPickerPopover
                      onSelect={(emoji) => { handleQuickReact(emoji); setEmojiPickerOpen(false); }}
                      onClose={() => setEmojiPickerOpen(false)}
                      isMe={isMe}
                    />
                  )}
                </div>
              </>
            )}
            {canReact && (canReply || canEdit || canUnsend) && (
              <span aria-hidden className="mx-0.5 h-4 w-px bg-edge" />
            )}
            {canReply && (
              <button
                onClick={() => useUIStore.getState().setReplyingTo(message)}
                className={ACTION_BUTTON}
                title="Reply"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 17 4 12 9 7" />
                  <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                </svg>
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => { setEditBody(message.body); setEditing(true); }}
                className={ACTION_BUTTON}
                title="Edit"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            )}
            {canUnsend && (
              <button
                onClick={handleUnsend}
                className={unsendConfirm
                  ? 'flex h-7 cursor-pointer items-center rounded-full px-2 text-[11px] font-medium text-red-500 transition-colors hover:bg-surface-hover'
                  : ACTION_BUTTON}
                title={unsendConfirm ? 'Click again to unsend' : 'Unsend'}
              >
                {unsendConfirm ? 'sure?' : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                )}
              </button>
            )}
          </div>
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
                  const match = before.match(EMOJI_SHORTCODE_RE);
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
              {hasBody && <p className="whitespace-pre-wrap"><Linkify text={message.body} mentions={message.mentions} isMe={isMe} /></p>}
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
        </div>
        {/* Reaction pills */}
        {message.reactions && message.reactions.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${isMe ? 'justify-end' : ''}`}>
            {message.reactions.map(r => (
              <button
                key={r.emoji}
                data-reaction-pill={r.emoji}
                onClick={() => handleQuickReact(r.emoji)}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm cursor-pointer transition-colors ${
                  newlyAddedReactions.includes(r.emoji) ? 'animate-reaction-pop' : ''
                } ${
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
    JSON.stringify(m.repliedMessage) === JSON.stringify(n.repliedMessage) &&
    JSON.stringify(m.mentions) === JSON.stringify(n.mentions)
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
      return <VideoAttachment attachment={attachment} isMe={isMe} />;

    case 'audio':
      return <AudioAttachment attachment={attachment} isMe={isMe} />;

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

function VideoAttachment({ attachment, isMe }: { attachment: MessageAttachment; isMe: boolean }) {
  const thumbUrl = useCachedImage(attachment.imageUrl);
  const videoUrl = sanitizeUrl(attachment.externalUrl);
  const playable = videoUrl !== '#';
  const durationLabel = attachment.durationMs ? formatDuration(attachment.durationMs) : '';
  const play = () => {
    if (playable) useUIStore.getState().openVideoLightbox(videoUrl);
  };

  // No thumbnail → compact chip, like file/link attachments.
  if (!attachment.imageUrl) {
    return (
      <button
        type="button"
        onClick={play}
        disabled={!playable}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${playable ? 'cursor-pointer' : 'cursor-default'} ${
          isMe
            ? 'bg-blue-700/50 text-blue-100 hover:bg-blue-700/70'
            : 'bg-surface-hover text-fg-secondary hover:bg-surface-muted'
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        <span>Video{durationLabel ? ` · ${durationLabel}` : ''}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={play}
      disabled={!playable}
      className={`relative block max-w-full overflow-hidden rounded-lg text-left ${
        playable ? 'cursor-pointer transition-transform hover:scale-[1.02]' : 'cursor-default'
      }`}
      title={playable ? 'Play video' : 'Video'}
    >
      <img
        src={thumbUrl}
        alt="Video"
        className="max-h-96 max-w-full rounded-lg object-contain"
        style={attachment.width && attachment.height
          ? { aspectRatio: `${attachment.width}/${attachment.height}` }
          : undefined}
      />
      {playable && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="8 5 19 12 8 19 8 5" />
            </svg>
          </span>
        </span>
      )}
      {durationLabel && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
          {durationLabel}
        </span>
      )}
    </button>
  );
}

/** Format a duration in ms as m:ss (e.g. 34775 → "0:35"). */
function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function AudioAttachment({ attachment, isMe }: { attachment: MessageAttachment; isMe: boolean }) {
  const audioUrl = sanitizeUrl(attachment.externalUrl);
  const hasPlayableUrl = audioUrl !== '#';
  const label = attachment.fallbackText || 'Voice message';

  return (
    <div className={`flex min-w-56 max-w-full items-center gap-2 rounded-lg px-3 py-2 text-xs ${
      isMe ? 'bg-blue-700/50 text-blue-100' : 'bg-surface-hover text-fg-secondary'
    }`}>
      <svg className="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </svg>
      {hasPlayableUrl ? (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-medium">{label}</span>
          <audio
            aria-label={label}
            controls
            preload="metadata"
            src={audioUrl}
            className="h-8 w-56 max-w-full"
          />
        </div>
      ) : (
        <span className="font-medium">{label} unavailable</span>
      )}
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

/** LinkedIn URL for a mention's entity URN, or null for unrecognized kinds.
 *  Profile links use the member id directly — linkedin.com/in/<id> resolves
 *  hashed member ids the same way the publicId fallback elsewhere relies on. */
function mentionHref(urn: string): string | null {
  const profile = urn.match(/^urn:li:fsd_profile:([A-Za-z0-9_-]+)$/);
  if (profile) return `https://www.linkedin.com/in/${profile[1]}`;
  const company = urn.match(/^urn:li:(?:fsd_company|company|organization):([A-Za-z0-9_-]+)$/);
  if (company) return `https://www.linkedin.com/company/${company[1]}`;
  return null;
}

function Linkify({ text, mentions, isMe }: { text: string; mentions?: MessageMention[]; isMe: boolean }) {
  const linkClass = `underline break-words ${isMe ? 'text-blue-100 hover:text-white' : 'text-blue-500 hover:text-blue-600'}`;

  // Collect all matches (mentions + emails + URLs) with their positions
  const matches: { index: number; length: number; href: string; display: string }[] = [];
  const overlapsExisting = (start: number, end: number) =>
    matches.some((em) => start < em.index + em.length && end > em.index);

  // Mentions first — they carry the authoritative link for their range, so
  // email/URL matches inside a mentioned name must not shadow them.
  for (const mention of mentions ?? []) {
    const href = mentionHref(mention.urn);
    if (!href) continue;
    const display = text.slice(mention.start, mention.start + mention.length);
    if (!display) continue;
    matches.push({ index: mention.start, length: mention.length, href, display });
  }

  // Find emails — they take priority over URL matches
  EMAIL_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMAIL_REGEX.exec(text)) !== null) {
    if (overlapsExisting(m.index, m.index + m[0].length)) continue;
    matches.push({ index: m.index, length: m[0].length, href: `mailto:${m[0]}`, display: m[0] });
  }

  // Find URLs, skipping any that overlap with mention/email matches
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    const raw = m[0];
    const cleaned = raw.replace(/[.,;:!?]+$/, '');
    const start = m.index;
    const end = start + raw.length;

    // Skip overlaps (e.g. "gmail.com" inside "user@gmail.com")
    if (overlapsExisting(start, end)) continue;

    const href = sanitizeUrl(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    // Advance only past the cleaned URL so stripped trailing punctuation
    // (".,;:!?") is emitted as plain text instead of silently dropped.
    matches.push({ index: start, length: cleaned.length, href, display: cleaned });
  }

  // Sort by position
  matches.sort((a, b) => a.index - b.index);

  // Build parts
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    if (match.index < lastIndex) continue; // overlapping match — keep the earlier one
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

/** Shown before anything is typed — a curated starting point, not a limit. */
const QUICK_PICKS: EmojiResult[] = [
  { emoji: '👍', name: 'thumbsup' }, { emoji: '👎', name: 'thumbsdown' },
  { emoji: '❤️', name: 'heart' }, { emoji: '😊', name: 'blush' },
  { emoji: '😂', name: 'joy' }, { emoji: '😎', name: 'sunglasses' },
  { emoji: '🙏', name: 'pray' }, { emoji: '🔥', name: 'fire' },
  { emoji: '👏', name: 'clap' }, { emoji: '💯', name: '100' },
  { emoji: '😍', name: 'heart_eyes' }, { emoji: '🎉', name: 'tada' },
  { emoji: '👋', name: 'wave' }, { emoji: '🤔', name: 'thinking_face' },
  { emoji: '😮', name: 'open_mouth' }, { emoji: '😢', name: 'cry' },
  { emoji: '✅', name: 'white_check_mark' }, { emoji: '⭐', name: 'star' },
  { emoji: '🚀', name: 'rocket' }, { emoji: '💪', name: 'muscle' },
];

/** Columns in the picker grid — also the stride for up/down arrow keys. */
const PICKER_COLUMNS = 6;
/** Enough matches to scroll through without rendering the whole dataset. */
const PICKER_RESULT_LIMIT = 60;
/** Breathing room between the picker and the edge of the scroll container. */
const PICKER_GAP = 8;
/** Search field plus about two rows of emoji. */
const PICKER_MIN_HEIGHT = 140;

/**
 * Reaction picker. LinkedIn's `reactWithEmoji` takes any emoji, so this
 * searches the whole gemoji set (the same data behind `:shortcode`
 * autocomplete) rather than offering a fixed tray; the quick picks are just
 * what shows before you type.
 */
function EmojiPickerPopover({
  onSelect,
  onClose,
  isMe,
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  isMe: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [placement, setPlacement] = useState<'above' | 'below' | null>(null);
  const [shift, setShift] = useState(0);
  const [maxHeight, setMaxHeight] = useState<number>();

  const results = useMemo(() => {
    const q = query.trim();
    return q ? searchEmoji(q, PICKER_RESULT_LIMIT) : QUICK_PICKS;
  }, [query]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The scroll container is the usable area: its top sits below the thread
    // header, and it clips on every side, so a grid that runs past one is cut
    // off rather than merely overhanging.
    const scrollContainer = el.closest('[data-scroll-container]');
    const bounds = scrollContainer
      ? scrollContainer.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    // Measure the button the picker hangs off, not the picker itself: the
    // space left over on each side of it is what decides the placement.
    const anchor = (el.parentElement ?? el).getBoundingClientRect();
    const above = anchor.top - bounds.top - PICKER_GAP;
    const below = bounds.bottom - anchor.bottom - PICKER_GAP;
    setPlacement(below > above ? 'below' : 'above');
    // Cap to the room on that side, but never squeeze below a couple of usable
    // rows — a sliver of a picker is worse than one that overhangs slightly.
    setMaxHeight(Math.max(PICKER_MIN_HEIGHT, Math.max(above, below)));
    setShift(edgeShift(el.getBoundingClientRect(), bounds));
  }, []);

  // Typing drives the picker, so the field takes focus on open. Global
  // single-key shortcuts skip events aimed at an input (see useKeyboard).
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Follow keyboard selection through a scrolled grid.
  useEffect(() => {
    ref.current?.querySelector('[data-emoji-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  function handleKeyDown(e: React.KeyboardEvent) {
    const move = (delta: number) => {
      e.preventDefault();
      setSelected((i) => Math.max(0, Math.min(results.length - 1, i + delta)));
    };
    if (e.key === 'ArrowRight') return move(1);
    if (e.key === 'ArrowLeft') return move(-1);
    if (e.key === 'ArrowDown') return move(PICKER_COLUMNS);
    if (e.key === 'ArrowUp') return move(-PICKER_COLUMNS);
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selected]) onSelect(results[selected].emoji);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      ref={ref}
      data-emoji-picker
      style={{
        ...(shift ? { transform: `translateX(${shift}px)` } : null),
        ...(maxHeight ? { maxHeight } : null),
      }}
      className={`absolute z-50 flex w-60 flex-col gap-1 rounded-lg border border-edge bg-surface p-1.5 shadow-lg ${
        placement === null ? 'bottom-full mb-1 invisible' : placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
      } ${isMe ? 'right-0' : 'left-0'}`}
    >
      <input
        ref={inputRef}
        data-emoji-search
        value={query}
        onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
        onKeyDown={handleKeyDown}
        placeholder="Search emoji"
        aria-label="Search emoji"
        className="w-full shrink-0 rounded bg-surface-input px-2 py-1 text-xs text-fg outline-none placeholder:text-fg-faint"
      />
      {results.length === 0 ? (
        <p className="px-1 py-3 text-center text-xs text-fg-faint">No emoji for “{query.trim()}”</p>
      ) : (
        <div className="grid min-h-0 grid-cols-6 gap-0.5 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={`${r.emoji}-${r.name}`}
              onClick={() => onSelect(r.emoji)}
              onMouseEnter={() => setSelected(i)}
              data-emoji-selected={i === selected ? '' : undefined}
              title={`:${r.name}:`}
              className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded text-lg transition-colors hover:bg-surface-hover ${
                i === selected ? 'bg-surface-hover' : ''
              }`}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
