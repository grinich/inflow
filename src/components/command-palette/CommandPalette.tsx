import { Command } from 'cmdk';
import { useUIStore } from '@/store/ui-store';
import { useOptimisticAction } from '@/hooks/useOptimisticAction';
import { sendBridgeMessage } from '@/lib/bridge';
import { isDemoMode, enableDemoMode, disableDemoMode } from '@/lib/demo-mode';
import { buildCommands } from './commands';
import type { Conversation } from '@/types/conversation';

interface CommandPaletteProps {
  conversations: Conversation[];
  composeRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function CommandPalette({ conversations, composeRef }: CommandPaletteProps) {
  const paletteOpen = useUIStore((s) => s.paletteOpen);
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen);
  const selectedIndex = useUIStore((s) => s.selectedIndex);
  const selectedConversationId = useUIStore((s) => s.selectedConversationId);
  const openThread = useUIStore((s) => s.openThread);
  const closeThread = useUIStore((s) => s.closeThread);
  const setComposeActive = useUIStore((s) => s.setComposeActive);
  const toggleShortcutOverlay = useUIStore((s) => s.toggleShortcutOverlay);
  const cycleTheme = useUIStore((s) => s.cycleTheme);
  const setInboxTab = useUIStore((s) => s.setInboxTab);

  const { archiveConversation, moveToOther, moveToSpam, markRead, markUnread } = useOptimisticAction();

  const selectedConv = selectedConversationId
    ? conversations.find((c) => c.id === selectedConversationId)
    : conversations[selectedIndex];

  const commands = buildCommands({
    archiveSelected: () => {
      if (selectedConv) archiveConversation(selectedConv);
    },
    moveToOtherSelected: () => {
      if (selectedConv) moveToOther(selectedConv);
    },
    moveToSpamSelected: () => {
      if (selectedConv) moveToSpam(selectedConv);
    },
    markReadSelected: () => {
      if (selectedConv) markRead(selectedConv.id);
    },
    markUnreadSelected: () => {
      if (selectedConv) markUnread(selectedConv.id);
    },
    openSelected: () => {
      if (selectedConv) {
        openThread(selectedConv.id, selectedIndex);
        markRead(selectedConv.id);
      }
    },
    reply: () => {
      setComposeActive(true);
      setTimeout(() => composeRef.current?.focus(), 0);
    },
    compose: () => {
      useUIStore.getState().setComposeNewActive(true);
    },
    goBack: () => closeThread(),
    showShortcuts: () => toggleShortcutOverlay(),
    triggerSync: () => {
      sendBridgeMessage({ type: 'SYNC_CONVERSATIONS' });
    },
    toggleTheme: () => cycleTheme(),
    goToFocused: () => setInboxTab('focused'),
    goToOther: () => {
      setInboxTab('other');
      sendBridgeMessage({ type: 'SYNC_CATEGORY', category: 'SECONDARY_INBOX' }).catch(() => {});
    },
    goToArchived: () => {
      setInboxTab('archived');
      sendBridgeMessage({ type: 'SYNC_CATEGORY', category: 'ARCHIVE' }).catch(() => {});
    },
    goToSpam: () => {
      setInboxTab('spam');
      sendBridgeMessage({ type: 'SYNC_CATEGORY', category: 'SPAM' }).catch(() => {});
    },
    undo: () => {
      const store = useUIStore.getState();
      const undoFn = store.lastUndoAction ?? store.toast?.undoAction;
      if (undoFn) {
        undoFn();
        store.clearLastUndo();
        store.dismissToast();
      }
    },
    openAISetup: () => {
      useUIStore.getState().setAISetupOpen(true);
    },
    toggleDemoMode: () => {
      if (isDemoMode()) {
        disableDemoMode(); // navigates to URL without ?demo
      } else {
        enableDemoMode(); // navigates to URL with ?demo
      }
    },
    isDemoActive: isDemoMode(),
  });

  if (!paletteOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]" onClick={() => setPaletteOpen(false)}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-surface-raised shadow-2xl ring-1 ring-ring"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Command palette" className="flex flex-col">
          <Command.Input
            autoFocus
            placeholder="Type a command..."
            className="w-full border-b border-edge bg-transparent px-4 py-3 text-sm text-fg placeholder-fg-faint outline-none"
          />
          <Command.List className="max-h-72 overflow-y-auto p-2">
            <Command.Empty className="px-4 py-6 text-center text-sm text-fg-muted">
              No commands found.
            </Command.Empty>
            {commands.map((cmd) => (
              <Command.Item
                key={cmd.id}
                value={cmd.label}
                onSelect={() => {
                  setPaletteOpen(false);
                  cmd.action();
                }}
                className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm text-fg-secondary transition-colors data-[selected=true]:bg-surface-hover data-[selected=true]:text-fg-strong"
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd className="rounded bg-surface px-1.5 py-0.5 text-xs font-mono text-fg-muted ring-1 ring-ring">
                    {cmd.shortcut}
                  </kbd>
                )}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
