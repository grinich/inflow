// @vitest-environment jsdom
// The sync indicator shows a static "✓ Up to date" once syncing finishes,
// rather than a "Synced Xs ago" label that counts up.
import '../dom-setup';

const { sendBridgeMessage } = vi.hoisted(() => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage }));

let backgroundHandler: ((msg: any) => void) | null = null;
vi.mock('@/hooks/useBackgroundMessage', () => ({
  useBackgroundMessage: (handler: (msg: any) => void) => {
    backgroundHandler = handler;
  },
}));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => 0 }));

import { render, screen, act } from '@testing-library/react';
import { SyncStatusIndicator } from '@/components/common/SyncStatusIndicator';

const CHECK_PATH = 'M20 6 9 17l-5-5';

beforeEach(() => {
  backgroundHandler = null;
  sendBridgeMessage.mockReset();
  sendBridgeMessage.mockResolvedValue({ success: true, data: null });
});

it('shows "Up to date" with a check icon when idle', () => {
  const { container } = render(<SyncStatusIndicator />);
  expect(screen.getByText('Up to date')).toBeInTheDocument();
  expect(container.querySelector(`svg path[d="${CHECK_PATH}"]`)).not.toBeNull();
});

it('shows "Syncing" while a sync is in progress', () => {
  const { container } = render(<SyncStatusIndicator />);
  act(() => backgroundHandler!({ type: 'SYNC_STATUS', state: 'syncing' }));
  expect(screen.getByText('Syncing')).toBeInTheDocument();
  expect(container.querySelector(`svg path[d="${CHECK_PATH}"]`)).toBeNull();
});

it('returns to "Up to date" after sync completes — no "Synced Xs ago" counter', () => {
  const { container } = render(<SyncStatusIndicator />);
  act(() => backgroundHandler!({ type: 'SYNC_STATUS', state: 'syncing' }));
  act(() => backgroundHandler!({ type: 'SYNC_STATUS', state: 'idle' }));
  expect(screen.getByText('Up to date')).toBeInTheDocument();
  expect(screen.queryByText(/Synced/)).toBeNull();
  expect(container.querySelector(`svg path[d="${CHECK_PATH}"]`)).not.toBeNull();
});
