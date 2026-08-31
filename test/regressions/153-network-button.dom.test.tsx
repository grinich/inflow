// @vitest-environment jsdom
// The network view was reachable only by the G N chord or the command palette.
// A button beside the Unread quick-filter gives it a visible entry point, and
// it has to land on exactly the same state the chord does — including the URL
// hash, so back/forward and reload still work from it.
import '../dom-setup';
import { render, fireEvent } from '@testing-library/react';
import { ConversationListHeader } from '@/components/conversations/ConversationListHeader';
import { useUIStore } from '@/store/ui-store';

vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn(async () => ({ success: true })) }));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

function renderHeader() {
  return render(
    <ConversationListHeader
      conversationCount={0}
      onSearchFocusChange={() => {}}
    />
  );
}

beforeEach(() => {
  window.location.hash = '';
  useUIStore.setState({ appView: 'inbox', inboxTab: 'focused', searchQuery: '' });
});

describe('regression #153: the Network button', () => {
  it('opens the network view', () => {
    const { getByText } = renderHeader();

    fireEvent.click(getByText('Network'));

    expect(useUIStore.getState().appView).toBe('network');
  });

  it('routes through the hash, exactly like G N', () => {
    // The chord writes the hash so back/forward and reload work. A button that
    // only set store state would leave the URL behind and break both.
    const { getByText } = renderHeader();

    fireEvent.click(getByText('Network'));

    expect(window.location.hash).toBe('#/network');
  });

  it('sits next to the Unread filter without disturbing it', () => {
    const { getByText } = renderHeader();

    fireEvent.click(getByText('Network'));

    // Opening the network view is navigation, not a search — the inbox's
    // unread filter must survive the trip.
    expect(useUIStore.getState().searchQuery).toBe('');
    expect(getByText('Unread')).toBeTruthy();
  });
});
