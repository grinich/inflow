// @vitest-environment jsdom
// Companion to 148: the commands that survive on the Network route have to
// LEAVE it. "Go back to inbox" used to call closeThread() only, and the tab
// commands only set inboxTab — either way Network stayed on screen and the
// action landed somewhere the user couldn't see.
import '../dom-setup';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/lib/demo-mode', () => ({ isDemoMode: () => false, enableDemoMode: vi.fn(), disableDemoMode: vi.fn() }));
vi.mock('@/lib/ai-settings', () => ({
  getAISuggestionsEnabled: vi.fn().mockResolvedValue(true),
  setAISuggestionsEnabled: vi.fn(),
}));
vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({
    archiveConversation: vi.fn(), moveToFocused: vi.fn(), moveToOther: vi.fn(),
    markRead: vi.fn(), markUnread: vi.fn(),
  }),
}));

import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { useUIStore } from '@/store/ui-store';

function openPaletteOnNetwork() {
  useUIStore.setState({ paletteOpen: true, appView: 'network', inboxTab: 'focused', viewMode: 'thread' });
  render(<CommandPalette conversations={[]} composeRef={{ current: null }} />);
}

/** cmdk renders items as options; click the one with this label. */
function run(label: string) {
  fireEvent.click(screen.getByText(label));
}

afterEach(() => {
  useUIStore.setState({ paletteOpen: false, appView: 'inbox' });
});

describe('palette commands leave the network route', () => {
  it('"Go back to inbox" returns to the inbox', () => {
    openPaletteOnNetwork();
    run('Go back to inbox');
    expect(useUIStore.getState().appView).toBe('inbox');
    expect(useUIStore.getState().viewMode).toBe('list');
  });

  it('a tab command switches route and tab together', () => {
    openPaletteOnNetwork();
    run('Go to Archived');
    const s = useUIStore.getState();
    expect(s.appView).toBe('inbox');
    expect(s.inboxTab).toBe('archived');
  });

  it('"Compose new message" returns to the inbox first', () => {
    openPaletteOnNetwork();
    run('Compose new message');
    const s = useUIStore.getState();
    expect(s.appView).toBe('inbox');
    expect(s.composeNewActive).toBe(true);
  });

  it('does not render the inbox-only commands', () => {
    openPaletteOnNetwork();
    expect(screen.queryByText('Archive conversation')).toBeNull();
    expect(screen.queryByText('Mark as spam')).toBeNull();
  });
});
