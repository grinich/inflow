import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { AuthGate } from '@/components/common/AuthGate';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ThreadView } from '@/components/thread/ThreadView';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { ShortcutOverlay, SHORTCUT_PANEL_PADDING } from '@/components/common/ShortcutOverlay';
import { ImageLightbox } from '@/components/common/ImageLightbox';
import { ConfirmDeleteModal } from '@/components/common/ConfirmDeleteModal';
import { ConfirmSpamModal } from '@/components/common/ConfirmSpamModal';
import { AISetupModal } from '@/components/common/AISetupModal';
import { Toast } from '@/components/common/Toast';
import { IncomingMessageToast } from '@/components/common/IncomingMessageToast';
import { DebugPanel } from '@/components/common/DebugPanel';
import { NewMessageComposer } from '@/components/composer/NewMessageComposer';
import { useConversations } from '@/hooks/useConversations';
import { useRemoteSearch } from '@/hooks/useRemoteSearch';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { useUIStore } from '@/store/ui-store';

export function App() {
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const { conversations: localConversations, isLoading, isDiscovering, category } = useConversations();
  const searchQuery = useUIStore((s) => s.searchQuery);
  const { remoteResults, isSearching, hasMore, loadMore } = useRemoteSearch();
  const selectedConversationId = useUIStore((s) => s.selectedConversationId);
  const composeNewActive = useUIStore((s) => s.composeNewActive);
  const shortcutPanelOpen = useUIStore((s) => s.shortcutOverlayOpen);
  const deleteConfirmId = useUIStore((s) => s.deleteConfirmId);
  const setDeleteConfirmId = useUIStore((s) => s.setDeleteConfirmId);
  const spamConfirmId = useUIStore((s) => s.spamConfirmId);
  const setSpamConfirmId = useUIStore((s) => s.setSpamConfirmId);
  const actions = useOptimisticAction();
  const [debugOpen, setDebugOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  // Full-window drag-and-drop for file attachments
  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      e.preventDefault();
      dragCounter.current++;
      if (e.dataTransfer?.types.includes('Files')) setDragging(true);
    }
    function onDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setDragging(false);
      }
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      dragCounter.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) {
        document.dispatchEvent(new CustomEvent('inflow:attach-files', { detail: files }));
      }
    }
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Merge local + remote results: append remote-only conversations after local ones
  const conversations = useMemo(() => {
    if (!searchQuery || remoteResults.length === 0) return localConversations;
    const localIds = new Set(localConversations.map((c) => c.id));
    const remoteOnly = remoteResults
      .filter((c) => !localIds.has(c.id))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    return [...localConversations, ...remoteOnly];
  }, [localConversations, remoteResults, searchQuery]);

  useKeyboard(conversations, composeRef);

  // Auto-select conversation when list loads or changes:
  // - Pending restore from tab switch → try to restore remembered selection
  // - No selection → pick first conversation
  // - Selection not in current list → pick first conversation
  // - Selection exists in list → sync selectedIndex to its position
  useEffect(() => {
    if (conversations.length === 0) return;
    const store = useUIStore.getState();

    // Don't interfere with the composer when it's open
    if (store.composeNewActive) return;

    // Helper: find first non-draft conversation for auto-select
    const firstNonDraft = () => {
      const idx = conversations.findIndex((c) => c.draft !== 1);
      return idx !== -1 ? { conv: conversations[idx], idx } : null;
    };

    // Check for pending tab restore first
    const pending = store._pendingRestore;
    if (pending) {
      useUIStore.setState({ _pendingRestore: null });
      if (pending.conversationId) {
        const idx = conversations.findIndex((c) => c.id === pending.conversationId);
        if (idx !== -1) {
          store.openThread(pending.conversationId, idx);
          return;
        }
      }
      // Remembered conversation not found — fall through to select first non-draft
      const first = firstNonDraft();
      if (first) store.openThread(first.conv.id, first.idx);
      return;
    }

    if (!selectedConversationId) {
      queueMicrotask(() => {
        const current = useUIStore.getState().selectedConversationId;
        if (!current && conversations.length > 0) {
          const first = firstNonDraft();
          if (first) useUIStore.getState().openThread(first.conv.id, first.idx);
        }
      });
    } else {
      const idx = conversations.findIndex((c) => c.id === selectedConversationId);
      if (idx !== -1) {
        store.setSelectedIndex(idx);
      } else {
        // Selected conversation was removed (archived/deleted/spam/etc.)
        // Select the conversation at the same position, or the last one
        const fallbackIdx = Math.min(store.selectedIndex, conversations.length - 1);
        const fallback = conversations[fallbackIdx];
        if (fallback && fallback.draft !== 1) {
          store.openThread(fallback.id, fallbackIdx);
        } else {
          // Fallback was a draft — find next non-draft
          const first = firstNonDraft();
          if (first) store.openThread(first.conv.id, first.idx);
        }
      }
    }
  }, [conversations, selectedConversationId]);

  // Debug panel toggle
  const toggleDebug = useCallback(() => setDebugOpen(prev => !prev), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '.' && e.metaKey && !(e.target as HTMLElement).matches('input, textarea, [contenteditable]')) {
        e.preventDefault();
        toggleDebug();
      }
      if (e.key === 'Escape' && debugOpen) {
        e.preventDefault();
        setDebugOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleDebug, debugOpen]);

  const selectedConversation = selectedConversationId
    ? conversations.find((c) => c.id === selectedConversationId) || null
    : null;

  const deleteConversation = deleteConfirmId
    ? conversations.find((c) => c.id === deleteConfirmId) || null
    : null;

  const spamConversation = spamConfirmId
    ? conversations.find((c) => c.id === spamConfirmId) || null
    : null;

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteConversation) return;
    actions.deleteConversation(deleteConversation);
    setDeleteConfirmId(null);
  }, [deleteConversation, actions, setDeleteConfirmId]);

  const handleSpamConfirm = useCallback(() => {
    if (!spamConversation) return;
    actions.moveToSpam(spamConversation);
    setSpamConfirmId(null);
  }, [spamConversation, actions, setSpamConfirmId]);

  return (
    <AuthGate>
      <div className={`flex h-full overflow-hidden bg-surface text-fg transition-[padding-bottom] duration-200 ease-out ${shortcutPanelOpen ? SHORTCUT_PANEL_PADDING : 'pb-0'}`}>
        {/* Conversation List */}
        <div className="flex h-full w-96 shrink-0 flex-col border-r border-edge">
          <ConversationList conversations={conversations} isLoading={isLoading} isDiscovering={isDiscovering} category={category} isSearching={isSearching} hasMoreSearchResults={hasMore} onLoadMoreSearch={loadMore} onOpenDebug={() => setDebugOpen(true)} />
        </div>

        {/* Thread View or New Message Composer */}
        <div className="flex h-full min-w-0 flex-1 flex-col">
          {composeNewActive ? (
            <NewMessageComposer
              key={selectedConversation?.draft === 1 ? selectedConversation.id : 'new'}
              draftConversation={selectedConversation?.draft === 1 ? selectedConversation : undefined}
              composeRef={composeRef}
            />
          ) : selectedConversation ? (
            <ThreadView conversation={selectedConversation} composeRef={composeRef} />
          ) : null}
        </div>
      </div>

      {/* Drag-and-drop overlay */}
      {dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-blue-400 bg-surface/90 px-12 py-10">
            <svg className="h-10 w-10 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-8m0 0l-3 3m3-3l3 3M3 16.5V18a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18v-1.5m-18 0V7.875C3 6.839 3.839 6 4.875 6h2.25c.621 0 1.207.296 1.575.8l.7.933c.368.504.954.8 1.575.8h7.15c1.036 0 1.875.84 1.875 1.875v5.592" />
            </svg>
            <p className="text-sm font-medium text-fg">Drop to attach file</p>
          </div>
        </div>
      )}

      {/* Overlays */}
      <CommandPalette conversations={conversations} composeRef={composeRef} />
      <ShortcutOverlay />
      <ImageLightbox />
      {deleteConversation && (
        <ConfirmDeleteModal
          participantNames={deleteConversation.participantNames}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
      {spamConversation && (
        <ConfirmSpamModal
          participantNames={spamConversation.participantNames}
          onConfirm={handleSpamConfirm}
          onCancel={() => setSpamConfirmId(null)}
        />
      )}
      <AISetupModal />
      <Toast />
      <IncomingMessageToast />
      <DebugPanel open={debugOpen} onClose={() => setDebugOpen(false)} />
    </AuthGate>
  );
}
