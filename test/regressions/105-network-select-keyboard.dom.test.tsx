// @vitest-environment jsdom
// Regression: NetworkView's key handler omitted SELECT from its editable-control
// list (useKeyboard has always included it). Once a keyboard user focused the
// "Recently added / Name A–Z" sort dropdown, ArrowUp/ArrowDown were
// preventDefault'd and moved the row selection instead of changing the option —
// the native select couldn't be operated from the keyboard at all.
import '../dom-setup';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/hooks/useNetworkActions', () => ({
  useNetworkActions: () => ({
    acceptInvitation: vi.fn(), ignoreInvitation: vi.fn(),
    messageConnection: vi.fn(), openProfile: vi.fn(),
  }),
}));

let rows: any[] = [];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => rows }));
vi.mock('@/db/database', () => ({
  db: { invitations: {}, connections: {}, conversations: {} },
}));

import { NetworkView } from '@/components/network/NetworkView';
import { useUIStore } from '@/store/ui-store';

beforeEach(() => {
  rows = [0, 1, 2].map((i) => ({
    profileUrn: `urn:li:fsd_profile:p${i}`,
    name: `Person ${i}`,
    headline: 'Engineer',
    pictureUrl: '',
    publicId: `p${i}`,
    connectedAt: 1750000000000 - i * 1000,
  }));
  useUIStore.setState({ appView: 'network', networkTab: 'connections', networkSelectedIndex: 0 });
});

describe('network view sort select', () => {
  it('leaves arrow keys to the focused select instead of moving the row selection', async () => {
    render(<NetworkView />);
    const select = await screen.findByRole('combobox');
    select.focus();

    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    select.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(false);
    expect(useUIStore.getState().networkSelectedIndex).toBe(0);
  });

  it('still moves the row selection when the select is not focused', async () => {
    render(<NetworkView />);
    await screen.findByRole('combobox');

    fireEvent.keyDown(document.body, { key: 'ArrowDown' });

    await waitFor(() => expect(useUIStore.getState().networkSelectedIndex).toBe(1));
  });

  it('changing the sort option still works', async () => {
    render(<NetworkView />);
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'name' } });

    expect(select.value).toBe('name');
  });
});
