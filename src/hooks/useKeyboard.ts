import { useEffect, useRef } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useOptimisticAction } from './useOptimisticAction';
import { sendBridgeMessage } from '@/lib/bridge';
import { db } from '@/db/database';
import type { Conversation } from '@/types/conversation';

export function useKeyboard(conversations: Conversation[], composeRef: React.RefObject<HTMLTextAreaElement | null>) {
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const actions = useOptimisticAction();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // "g" chord: pressing "g" then another key within 500ms triggers a "go to" action
  const gPendingRef = useRef(false);
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Delayed mark-as-read: only mark read after viewing a thread for 1+ second
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleMarkRead = (conversationId: string) => {
    if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    markReadTimerRef.current = setTimeout(() => {
      actionsRef.current.markRead(conversationId);
      markReadTimerRef.current = null;
    }, 1000);
  };

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
      if (gTimerRef.current) clearTimeout(gTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const store = useUIStore.getState();
      const convs = conversationsRef.current;
      const act = actionsRef.current;

      // Don't handle any shortcuts when the debug panel or confirm modal is open
      if (document.querySelector('[data-debug-panel]')) return;
      if (store.deleteConfirmId || store.spamConfirmId) return;

      // Cmd+K — Command palette (works in any context)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        store.togglePalette();
        return;
      }

      // Enter in search — blur to allow j/k navigation
      if (e.key === 'Enter' && isInput && (target as HTMLElement).hasAttribute('data-search-input')) {
        e.preventDefault();
        (target as HTMLElement).blur();
        return;
      }

      // Cmd+Enter — Send + archive (only in compose)
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && isInput) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('inflow:send-and-archive'));
        return;
      }

      // Enter (no modifier) — Send message (only in compose textarea)
      // Shift+Enter inserts a newline (default browser behavior)
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && isInput && target instanceof HTMLTextAreaElement) {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('inflow:send'));
        return;
      }

      // Escape — close overlays, clear search + blur input, exit compose, or close thread
      if (e.key === 'Escape') {
        if (store.shortcutOverlayOpen) {
          e.preventDefault();
          store.setShortcutOverlayOpen(false);
          return;
        }
        if (store.paletteOpen) {
          e.preventDefault();
          store.setPaletteOpen(false);
          return;
        }
        if (isInput) {
          e.preventDefault();
          if ((target as HTMLElement).hasAttribute('data-search-input') && store.searchQuery) {
            // First Escape: clear search query, stay focused
            store.setSearchQuery('');
          } else {
            // No search query (or not search input): blur the input
            (target as HTMLElement).blur();
          }
          return;
        }
        if (store.searchQuery) {
          e.preventDefault();
          store.setSearchQuery('');
          return;
        }
        if (store.composeNewActive) {
          e.preventDefault();
          store.setComposeNewActive(false);
          return;
        }
        if (store.composeActive) {
          e.preventDefault();
          store.setComposeActive(false);
          composeRef.current?.blur();
          return;
        }
        return;
      }

      // Arrow keys in search input: blur and navigate the conversation list
      // BUT only if the filter dropdown is NOT active (dropdown handles its own arrows)
      if (isInput && (target as HTMLElement).hasAttribute('data-search-input') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const dropdown = document.querySelector('[data-filter-dropdown]');
        if (dropdown) {
          // Dropdown is open — let it handle arrow keys, don't blur
          return;
        }
        e.preventDefault();
        (target as HTMLElement).blur();
        // Fall through to j/k/arrow handler below
      } else if (isInput) {
        return;
      }

      // "g" chord — second key: "g s" → go to starred, "g u" → go to unread
      if (gPendingRef.current) {
        gPendingRef.current = false;
        if (gTimerRef.current) { clearTimeout(gTimerRef.current); gTimerRef.current = null; }
        if (e.key === 's') {
          e.preventDefault();
          store.setSearchQuery('is:starred ');
          const input = document.querySelector<HTMLInputElement>('[data-search-input]');
          input?.focus();
          return;
        }
        if (e.key === 'u') {
          e.preventDefault();
          store.setSearchQuery('is:unread ');
          const input = document.querySelector<HTMLInputElement>('[data-search-input]');
          input?.focus();
          return;
        }
        // Unknown second key — fall through to normal handling
      }

      // "g" chord — first key: start the chord timer
      if (e.key === 'g' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        gPendingRef.current = true;
        if (gTimerRef.current) clearTimeout(gTimerRef.current);
        gTimerRef.current = setTimeout(() => { gPendingRef.current = false; }, 500);
        return;
      }

      // S — Star/unstar conversation
      if (e.key === 's' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const conv = store.selectedConversationId
          ? convs.find((c) => c.id === store.selectedConversationId)
          : convs[store.selectedIndex];
        if (conv) {
          act.starConversation(conv);
        }
        return;
      }

      // C — Compose new message
      if (e.key === 'c' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        store.setComposeNewActive(true);
        return;
      }

      // ? — Show shortcuts
      if (e.key === '?' && e.shiftKey) {
        e.preventDefault();
        store.toggleShortcutOverlay();
        return;
      }

      // / — Focus search
      if (e.key === '/') {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>('[data-search-input]');
        input?.focus();
        return;
      }

      // Z — Undo last action and reselect the conversation
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const undo = store.lastUndoAction ?? store.toast?.undoAction;
        const convId = store.lastUndoConversationId ?? store.toast?.undoConversationId;
        if (undo) {
          undo();
          // Reselect the undone conversation after DB updates
          if (convId) {
            setTimeout(() => {
              const idx = conversationsRef.current.findIndex((c) => c.id === convId);
              if (idx >= 0) {
                useUIStore.getState().openThread(convId, idx);
              }
            }, 50);
          }
          store.clearLastUndo();
          store.dismissToast();
        }
        return;
      }

      // J/K/ArrowDown/ArrowUp — navigate conversations and auto-open thread
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const newIndex = Math.min(store.selectedIndex + 1, convs.length - 1);
        const conv = convs[newIndex];
        if (conv) {
          if (conv.draft === 1) {
            store.setSelectedConversationId(conv.id);
            store.setSelectedIndex(newIndex);
            if (conv.lastMessage) {
              // Draft with text → open ThreadView
              store.setComposeNewActive(false);
            } else {
              // Draft still picking recipients → open composer
              store.setComposeNewActive(true);
            }
          } else {
            store.openThread(conv.id, newIndex);
            scheduleMarkRead(conv.id);
          }
        }
        return;
      }
      if ((e.key === 'k' || e.key === 'ArrowUp') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const newIndex = Math.max(store.selectedIndex - 1, 0);
        const conv = convs[newIndex];
        if (conv) {
          if (conv.draft === 1) {
            store.setSelectedConversationId(conv.id);
            store.setSelectedIndex(newIndex);
            if (conv.lastMessage) {
              // Draft with text → open ThreadView
              store.setComposeNewActive(false);
            } else {
              // Draft still picking recipients → open composer
              store.setComposeNewActive(true);
            }
          } else {
            store.openThread(conv.id, newIndex);
            scheduleMarkRead(conv.id);
          }
        }
        return;
      }

      // Shift+! — Mark as Spam (with confirmation)
      if (e.key === '!' && e.shiftKey) {
        e.preventDefault();
        const conv = store.selectedConversationId
          ? convs.find((c) => c.id === store.selectedConversationId)
          : convs[store.selectedIndex];
        if (conv) {
          store.setSpamConfirmId(conv.id);
        }
        return;
      }

      // O — Move to Other
      if (e.key === 'o') {
        e.preventDefault();
        const conv = store.selectedConversationId
          ? convs.find((c) => c.id === store.selectedConversationId)
          : convs[store.selectedIndex];
        if (conv) act.moveToOther(conv);
        return;
      }

      // E — Archive (or Move to Focused if already in Archive tab)
      if (e.key === 'e') {
        e.preventDefault();
        const conv = store.selectedConversationId
          ? convs.find((c) => c.id === store.selectedConversationId)
          : convs[store.selectedIndex];
        if (conv) {
          if (store.inboxTab === 'archived') {
            act.moveToFocused(conv);
          } else {
            act.archiveConversation(conv);
          }
        }
        return;
      }

      // D — Delete conversation (with confirmation)
      if (e.key === 'd' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const conv = store.selectedConversationId
          ? convs.find((c) => c.id === store.selectedConversationId)
          : convs[store.selectedIndex];
        if (conv) {
          store.setDeleteConfirmId(conv.id);
        }
        return;
      }

      // U — Toggle read/unread
      if (e.key === 'u' && !e.shiftKey) {
        e.preventDefault();
        // Cancel any pending auto-mark-read timer
        if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
        const conv = store.selectedConversationId
          ? convs.find((c) => c.id === store.selectedConversationId)
          : convs[store.selectedIndex];
        if (conv) {
          if (conv.read) {
            act.markUnread(conv.id);
            document.dispatchEvent(new CustomEvent('inflow:manual-unread', { detail: conv.id }));
          } else {
            act.markRead(conv.id);
          }
        }
        return;
      }

      // R — Focus compose reply (immediately mark read since user is engaging)
      if (e.key === 'r' && !e.shiftKey && store.selectedConversationId) {
        e.preventDefault();
        if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
        act.markRead(store.selectedConversationId);
        store.setComposeActive(true);
        setTimeout(() => composeRef.current?.focus(), 0);
        return;
      }

      // P — Open participant's LinkedIn profile in a new tab
      if (e.key === 'p' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const conv = store.selectedConversationId
          ? convs.find((c) => c.id === store.selectedConversationId)
          : convs[store.selectedIndex];
        if (conv && conv.participantUrns.length > 0) {
          // Look up the first participant's profile for their publicId
          db.profiles.get(conv.participantUrns[0]).then((profile) => {
            if (profile?.publicId) {
              window.open(`https://www.linkedin.com/in/${profile.publicId}`, '_blank');
            }
          });
        }
        return;
      }

      // Tab — let browser handle default behavior (don't hijack)
      if (e.key === 'Tab') {
        return;
      }

      // 1/2/3 — Switch inbox tabs
      if (e.key === '1') {
        e.preventDefault();
        store.setInboxTab('focused');
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        store.setInboxTab('other');
        sendBridgeMessage({ type: 'SYNC_CATEGORY', category: 'SECONDARY_INBOX' }).catch(() => {});
        return;
      }
      if (e.key === '3') {
        e.preventDefault();
        store.setInboxTab('archived');
        sendBridgeMessage({ type: 'SYNC_CATEGORY', category: 'ARCHIVE' }).catch(() => {});
        return;
      }
      if (e.key === '4') {
        e.preventDefault();
        store.setInboxTab('spam');
        sendBridgeMessage({ type: 'SYNC_CATEGORY', category: 'SPAM' }).catch(() => {});
        return;
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [composeRef]);
}
