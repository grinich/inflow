import { formatDistanceToNowStrict } from 'date-fns';
import { useConnectionChat } from '@/hooks/useConnectionChat';
import { SparkleIcon } from '@/components/common/SparkleIcon';
import { ChatThread } from '@/components/insights/ChatThread';

/**
 * The "AI Chat" section — a Claude-style layout: a history sidebar of past
 * conversations on the left, the active thread on the right. Conversations
 * persist per-account and can be resumed to keep iterating on a topic.
 */
export function ChatView() {
  const { chats, activeId, newChat, selectChat, deleteChat } = useConnectionChat();

  return (
    <div className="flex h-full min-w-0 flex-1">
      {/* History sidebar */}
      <div className="flex h-full w-60 shrink-0 flex-col border-r border-edge bg-surface-raised">
        <div className="p-2">
          <button
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded-lg btn-primary px-3 py-2 text-sm font-medium transition-colors"
          >
            <SparkleIcon className="h-4 w-4" />
            New chat
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {chats.length === 0 ? (
            <p className="px-2 py-3 text-xs text-fg-faint">No conversations yet.</p>
          ) : (
            <div className="space-y-0.5">
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
                    chat.id === activeId ? 'bg-surface-active' : 'hover:bg-surface-hover'
                  }`}
                >
                  <button
                    onClick={() => selectChat(chat.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-[13px] font-medium text-fg-strong">{chat.title}</span>
                    <span className="block text-[11px] text-fg-faint">
                      {formatDistanceToNowStrict(new Date(chat.updatedAt), { addSuffix: true })}
                    </span>
                  </button>
                  <button
                    onClick={() => deleteChat(chat.id)}
                    title="Delete conversation"
                    aria-label={`Delete ${chat.title}`}
                    className="shrink-0 rounded p-1 text-fg-faint opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active thread */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-edge px-6 py-3">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-fg-strong">
            <SparkleIcon className="h-4 w-4 text-blue-400" />
            Flow
          </h2>
          <span className="text-[11px] text-fg-faint">Your network AI</span>
        </div>
        <div className="min-h-0 flex-1">
          <ChatThread />
        </div>
      </div>
    </div>
  );
}
