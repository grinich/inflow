import { useRef, useEffect, useCallback, useMemo } from 'react';
import { useThread } from '@/hooks/useThread';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { preloadImages } from '@/hooks/useCachedImage';
import { db } from '@/db/database';
import { ThreadHeader } from './ThreadHeader';
import { MessageBubble, TIME_GAP_MS, formatSeparatorTime } from './MessageBubble';
import { ComposeBox } from './ComposeBox';
import type { Conversation } from '@/types/conversation';

interface ThreadViewProps {
  conversation: Conversation;
  composeRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function ThreadView({ conversation, composeRef }: ThreadViewProps) {
  const messages = useThread(conversation.id, conversation.mergedIds);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { sendMessage, markRead } = useOptimisticAction();

  // Suppress auto mark-read when the user explicitly marks unread with 'u'.
  // Reset when navigating to a different conversation.
  const suppressAutoRead = useRef(false);
  useEffect(() => {
    suppressAutoRead.current = false;
  }, [conversation.id]);

  useEffect(() => {
    function onManualUnread(e: Event) {
      if ((e as CustomEvent).detail === conversation.id) {
        suppressAutoRead.current = true;
      }
    }
    document.addEventListener('inflow:manual-unread', onManualUnread);
    return () => document.removeEventListener('inflow:manual-unread', onManualUnread);
  }, [conversation.id]);

  // Auto mark-read when viewing an unread thread, but only after dwelling for 2s.
  // The SSE handler sets read=0 on incoming messages; this re-marks as read if the
  // user stays on the thread. Cancelled if they navigate away quickly (j/k browsing).
  const autoReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (autoReadTimer.current) clearTimeout(autoReadTimer.current);
    if (suppressAutoRead.current) return;
    if (conversation.read !== 0) return;
    if (document.visibilityState !== 'visible') return;

    autoReadTimer.current = setTimeout(() => {
      autoReadTimer.current = null;
      if (!suppressAutoRead.current) markRead(conversation.id);
    }, 2000);

    return () => {
      if (autoReadTimer.current) {
        clearTimeout(autoReadTimer.current);
        autoReadTimer.current = null;
      }
    };
  }, [conversation.read, conversation.id]);

  // Mark read when the window regains focus while viewing an unread thread (with same delay)
  useEffect(() => {
    function onVisible() {
      if (suppressAutoRead.current) return;
      if (document.visibilityState !== 'visible' || conversation.read !== 0) return;
      if (autoReadTimer.current) clearTimeout(autoReadTimer.current);
      autoReadTimer.current = setTimeout(() => {
        autoReadTimer.current = null;
        if (!suppressAutoRead.current) markRead(conversation.id);
      }, 2000);
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [conversation.id, conversation.read]);

  const handleRetry = useCallback(async (msgId: string, body: string) => {
    // Recover stashed files before deleting the failed message
    let files: File[] | undefined;
    const stashed = await db.draftAttachments.get(msgId).catch(() => null);
    if (stashed?.files?.length) {
      files = stashed.files.map((blob, i) =>
        new File([blob], stashed.names[i] || 'file', { type: stashed.types[i] || '' })
      );
    }
    // Delete the failed message + stashed files, then re-send
    await db.messages.delete(msgId);
    await db.draftAttachments.delete(msgId).catch(() => {});
    document.dispatchEvent(new CustomEvent('inflow:failed-change', { detail: conversation.id }));
    await sendMessage(conversation.id, body, files);
  }, [conversation.id, sendMessage]);

  const handleDeleteFailed = useCallback(async (msgId: string) => {
    await db.messages.delete(msgId);
    await db.draftAttachments.delete(msgId).catch(() => {});
    document.dispatchEvent(new CustomEvent('inflow:failed-change', { detail: conversation.id }));
  }, [conversation.id]);

  // Preload all images in the thread (sender avatars + image attachments)
  // so they render instantly from the in-memory cache.
  // Stabilized: only re-runs when the actual set of URLs changes, not on every
  // Dexie live query update that produces a new messages array reference.
  const imageUrls = useMemo(() => {
    const urls: string[] = [];
    for (const msg of messages) {
      if (msg.senderPicture) urls.push(msg.senderPicture);
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.imageUrl) urls.push(att.imageUrl);
        }
      }
    }
    return urls;
  }, [messages]);

  const stableUrlKey = useMemo(() => imageUrls.join('\0'), [imageUrls]);
  const stableUrls = useMemo(() => imageUrls, [stableUrlKey]);

  useEffect(() => {
    if (stableUrls.length === 0) return;
    return preloadImages(stableUrls);
  }, [stableUrls]);

  // Scroll-to-bottom logic:
  // 1. On conversation switch or new messages → snap to bottom
  // 2. On content resize (images loading) → stay at bottom only if we were already there
  //
  // We track "was at bottom" by comparing scrollTop + clientHeight against the
  // PREVIOUS scrollHeight inside the ResizeObserver. This avoids the race condition
  // where an image loading above the viewport increases scrollHeight, making a
  // scroll-event-based check falsely think the user scrolled up.
  const contentRef = useRef<HTMLDivElement>(null);
  const prevScrollHeight = useRef(0);

  // On conversation switch or new messages, snap to bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Mark that we want to be at bottom so the ResizeObserver keeps us there
    prevScrollHeight.current = 0;
    el.scrollTop = el.scrollHeight;
    prevScrollHeight.current = el.scrollHeight;
    // Re-scroll after a frame in case layout hasn't fully settled
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      prevScrollHeight.current = el.scrollHeight;
    });
    return () => cancelAnimationFrame(raf);
  }, [conversation.id, messages.length]);

  // Re-scroll when inner content resizes (images load, posts expand, etc.)
  // Only auto-scroll if we were at the bottom before the resize happened.
  useEffect(() => {
    const content = contentRef.current;
    const scroll = scrollRef.current;
    if (!content || !scroll) return;
    const observer = new ResizeObserver(() => {
      const wasAtBottom =
        scroll.scrollTop + scroll.clientHeight >= prevScrollHeight.current - 40;
      prevScrollHeight.current = scroll.scrollHeight;
      if (wasAtBottom) {
        scroll.scrollTop = scroll.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Pre-compute grouping: which messages need separators and which are grouped
  const layout = useMemo(() => {
    return messages.map((msg, i) => {
      const prev = i > 0 ? messages[i - 1] : null;
      const next = i < messages.length - 1 ? messages[i + 1] : null;
      const gap = prev ? msg.createdAt - prev.createdAt : Infinity;
      const sameSender = prev?.senderUrn === msg.senderUrn;

      // isLastInGroup: this is the last message from this sender before a different sender or end of list
      const nextGap = next ? next.createdAt - msg.createdAt : Infinity;
      const nextSameSender = next?.senderUrn === msg.senderUrn && nextGap < TIME_GAP_MS;
      const isLastInGroup = msg.isFromMe && !nextSameSender;

      return {
        showSeparator: gap >= TIME_GAP_MS || i === 0,
        grouped: sameSender && gap < TIME_GAP_MS,
        isLastInGroup,
      };
    });
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <ThreadHeader conversation={conversation} />

      <div ref={scrollRef} data-scroll-container className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div ref={contentRef}>
          {messages.length === 0 ? (
            conversation.draft === 1 ? null : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                Loading messages...
              </div>
            )
          ) : (
            <div className="space-y-1">
              {messages.map((msg, i) => (
                <div key={msg.id}>
                  {layout[i].showSeparator && (
                    <div className="flex items-center justify-center py-3">
                      <span className="text-[10px] font-medium text-fg-faint">
                        {formatSeparatorTime(msg.createdAt)}
                      </span>
                    </div>
                  )}
                  <div className={layout[i].grouped ? 'pt-0.5' : 'pt-2'}>
                    <MessageBubble
                      message={msg}
                      grouped={layout[i].grouped}
                      isLastInGroup={layout[i].isLastInGroup}
                      onRetry={msg.status === 'failed' ? () => handleRetry(msg.id, msg.body) : undefined}
                      onDelete={msg.status === 'failed' ? () => handleDeleteFailed(msg.id) : undefined}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ComposeBox ref={composeRef} conversationId={conversation.id}
                  messages={messages} participantNames={conversation.participantNames} />
    </div>
  );
}
