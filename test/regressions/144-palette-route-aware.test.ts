// Regression: the command palette is reachable with Cmd/Ctrl+K from the Network
// view, but its command list was built for the inbox. "Archive conversation",
// "Move to Other" and "Mark as spam" acted on the still-selected — and now
// invisible — inbox conversation, and "Go back to inbox" only called
// closeThread(), leaving Network on screen.
import { buildCommands } from '@/components/command-palette/commands';

const noop = () => {};

function build(appView: 'inbox' | 'network', over: Record<string, any> = {}) {
  return buildCommands({
    archiveSelected: noop, moveToOtherSelected: noop, moveToSpamSelected: noop,
    markReadSelected: noop, markUnreadSelected: noop, openSelected: noop, reply: noop,
    compose: noop, goBack: noop, showShortcuts: noop, triggerSync: noop,
    setThemeLight: noop, setThemeDark: noop, setThemeSystem: noop, currentTheme: 'system',
    goToFocused: noop, goToOther: noop, goToArchived: noop, goToSpam: noop, goToNetwork: noop,
    undo: noop, openAISetup: noop, toggleDemoMode: noop, isDemoActive: false,
    toggleAISuggestions: noop, aiSuggestionsEnabled: true, reportBug: noop,
    joinWhatsApp: noop, checkForUpdate: noop,
    appView,
    ...over,
  });
}

const ids = (appView: 'inbox' | 'network') => build(appView).map((c) => c.id);

describe('command palette route awareness', () => {
  it('offers the conversation commands in the inbox', () => {
    expect(ids('inbox')).toEqual(
      expect.arrayContaining(['archive', 'move-to-other', 'move-to-spam', 'mark-read', 'mark-unread', 'open', 'reply'])
    );
  });

  it.each(['archive', 'move-to-other', 'move-to-spam', 'mark-read', 'mark-unread', 'open', 'reply'])(
    'hides %s on the network route',
    (id) => {
      expect(ids('network')).not.toContain(id);
    }
  );

  it('hides "Go to Network" when already there', () => {
    expect(ids('inbox')).toContain('go-network');
    expect(ids('network')).not.toContain('go-network');
  });

  it('keeps the route-independent commands on network', () => {
    expect(ids('network')).toEqual(
      expect.arrayContaining(['back', 'compose', 'go-focused', 'go-other', 'go-archived', 'go-spam', 'shortcuts', 'sync', 'undo'])
    );
  });
});
