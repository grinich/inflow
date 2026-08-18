import { ConversationList } from '@/components/conversations/ConversationList';
import { ThreadView } from '@/components/thread/ThreadView';
import { NewMessageComposer } from '@/components/composer/NewMessageComposer';
import { useResizableSidebar } from '@/hooks/useResizableSidebar';
import { useCollapsedSidebar, RAIL_WIDTH } from '@/hooks/useCollapsedSidebar';
import { useUIStore } from '@/store/ui-store';
import type { Conversation } from '@/types/conversation';

interface InboxViewProps {
  conversations: Conversation[];
  isLoading: boolean;
  isDiscovering: boolean;
  category: string;
  isSearching: boolean;
  hasMoreSearchResults: boolean;
  onLoadMoreSearch: () => void;
  onOpenDebug: () => void;
  composeRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * The inbox route: conversation list, resize handle, and thread/composer pane.
 * `App` owns the data (conversations, keyboard, selection) because the
 * overlays it renders need them too; this component only owns the layout.
 */
export function InboxView({
  conversations,
  isLoading,
  isDiscovering,
  category,
  isSearching,
  hasMoreSearchResults,
  onLoadMoreSearch,
  onOpenDebug,
  composeRef,
}: InboxViewProps) {
  const selectedConversationId = useUIStore((s) => s.selectedConversationId);
  const composeNewActive = useUIStore((s) => s.composeNewActive);
  const { width: sidebarWidth, isDragging: isDraggingSidebar, onDividerMouseDown, onDividerDoubleClick } = useResizableSidebar();
  const railMode = useCollapsedSidebar();

  const selectedConversation = selectedConversationId
    ? conversations.find((c) => c.id === selectedConversationId) || null
    : null;

  return (
    <>
      {/* Conversation List — collapses to a fixed avatar rail on narrow windows */}
      <div style={{ width: railMode ? RAIL_WIDTH : sidebarWidth }} className="flex h-full shrink-0 flex-col border-r border-edge">
        <ConversationList conversations={conversations} isLoading={isLoading} isDiscovering={isDiscovering} category={category} isSearching={isSearching} hasMoreSearchResults={hasMoreSearchResults} onLoadMoreSearch={onLoadMoreSearch} onOpenDebug={onOpenDebug} compact={railMode} />
      </div>

      {/* Resize handle: thin visual divider with a wider invisible hit zone.
          Drag to resize the sidebar, double-click to reset. Hidden in rail
          mode — the rail width is fixed. */}
      {!railMode && (
        <div
          onMouseDown={onDividerMouseDown}
          onDoubleClick={onDividerDoubleClick}
          title="Drag to resize · double-click to reset"
          className={`group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize ${isDraggingSidebar ? 'bg-blue-500/40' : ''}`}
        >
          <div className={`absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors ${isDraggingSidebar ? 'bg-blue-500' : 'bg-transparent group-hover:bg-blue-500/60'}`} />
        </div>
      )}

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
    </>
  );
}
