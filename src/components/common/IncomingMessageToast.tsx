import { useState, useEffect, useRef, useCallback } from 'react';
import { useBackgroundMessage } from '@/hooks/useBackgroundMessage';
import { useUIStore } from '@/store/ui-store';
import { db } from '@/db/database';

interface IncomingNotification {
  id: string;
  senderName: string;
  senderPicture: string;
  body: string;
  conversationId: string;
}

const DISPLAY_MS = 4000;
const ANIMATION_MS = 300;

export function IncomingMessageToast() {
  const [notification, setNotification] = useState<IncomingNotification | null>(null);
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const lastNotification = useRef<IncomingNotification | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>();
  const exitTimer = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback((n: IncomingNotification) => {
    // Don't show if the user is already viewing this conversation
    const store = useUIStore.getState();
    if (store.selectedConversationId === n.conversationId) return;

    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (exitTimer.current) clearTimeout(exitTimer.current);

    lastNotification.current = n;
    setNotification(n);
    setExiting(false);
    requestAnimationFrame(() => setVisible(true));

    dismissTimer.current = setTimeout(() => {
      setExiting(true);
      setVisible(false);
      exitTimer.current = setTimeout(() => {
        setExiting(false);
        setNotification(null);
        lastNotification.current = null;
      }, ANIMATION_MS);
    }, DISPLAY_MS);
  }, []);

  useBackgroundMessage(
    useCallback((msg: any) => {
      if (msg.type === 'INCOMING_MESSAGE') {
        show({
          id: msg.id,
          senderName: msg.senderName,
          senderPicture: msg.senderPicture || '',
          body: msg.body,
          conversationId: msg.conversationId,
        });
      }
    }, [show])
  );

  // Demo trigger (Ctrl+Shift+N)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'N' && e.shiftKey && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        show({
          id: `demo-${Date.now()}`,
          senderName: 'Jane Cooper',
          senderPicture: '',
          body: 'Hey! Just wanted to follow up on our conversation from yesterday. Are you free for a quick call this week?',
          conversationId: 'demo',
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [show]);

  // Demo mode: listen for custom events (chrome.runtime.onMessage won't fire)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        show({
          id: detail.id,
          senderName: detail.senderName,
          senderPicture: detail.senderPicture || '',
          body: detail.body,
          conversationId: detail.conversationId,
        });
      }
    };
    window.addEventListener('inflow:demo-incoming', handler);
    return () => window.removeEventListener('inflow:demo-incoming', handler);
  }, [show]);

  // Clean up timers
  useEffect(() => {
    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, []);

  const handleClick = useCallback(async () => {
    const n = notification ?? lastNotification.current;
    if (!n || n.conversationId === 'demo') return;

    // Navigate to the conversation. Switch to the tab it lives in FIRST so it's
    // present in the rendered (tab-filtered) list — otherwise App's auto-select
    // effect can't find it and lands on an unrelated fallback conversation.
    if (!db) return;
    const conv = await db.conversations.get(n.conversationId);
    if (conv) {
      const tab = conv.archived === 1 ? 'archived'
        : conv.category === 'SPAM' ? 'spam'
        : conv.category === 'SECONDARY_INBOX' ? 'other'
        : 'focused';
      useUIStore.getState().setInboxTab(tab);
    }
    // Don't let setInboxTab's remembered-selection restore hijack our target.
    useUIStore.setState({ _pendingRestore: null });
    // The index is reconciled by App's auto-select effect once the conv is listed.
    useUIStore.getState().openThread(n.conversationId, 0);

    // Dismiss
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setExiting(true);
    setVisible(false);
    exitTimer.current = setTimeout(() => {
      setExiting(false);
      setNotification(null);
      lastNotification.current = null;
    }, ANIMATION_MS);
  }, [notification]);

  const current = notification ?? lastNotification.current;
  if (!current) return null;

  const initials = current.senderName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  return (
    <div className="fixed top-4 right-4 z-50 w-80">
      <div
        onClick={handleClick}
        className={`flex cursor-pointer items-start gap-3 rounded-xl bg-surface-raised p-3 shadow-xl ring-1 ring-ring transition-all ease-out ${
          visible && !exiting
            ? 'translate-y-0 opacity-100 duration-300'
            : '-translate-y-3 opacity-0 duration-200'
        }`}
      >
        {current.senderPicture ? (
          <img
            src={current.senderPicture}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-xs font-medium text-blue-400">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg-strong">{current.senderName}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-fg-secondary">{current.body}</p>
        </div>
      </div>
    </div>
  );
}
