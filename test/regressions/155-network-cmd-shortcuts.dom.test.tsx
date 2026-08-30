// @vitest-environment jsdom
// ⌘↵ accepts and ⌘I ignores the selected invitation.
//
// The network key handler bailed out of every chorded key (`if (e.metaKey ||
// e.ctrlKey) return`) before reaching any action, and separately ignored all
// keys while focus sat in an editable control. Both are right for bare keys
// and wrong for a chord: holding a modifier is exactly what makes a shortcut
// unambiguous while you are typing in the filter box.
import '../dom-setup';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Invitation } from '@/types/network';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: vi.fn(async () => ({ success: true })),
}));

const acceptInvitation = vi.fn();
const ignoreInvitation = vi.fn();
vi.mock('@/hooks/useNetworkActions', () => ({
  useNetworkActions: () => ({
    acceptInvitation, ignoreInvitation,
    messageConnection: vi.fn(), openProfile: vi.fn(),
  }),
}));

import { NetworkView } from '@/components/network/NetworkView';
import { useUIStore } from '@/store/ui-store';

function invitation(i: number): Invitation {
  return {
    id: `inv-${i}`, sharedSecret: 's', fromUrn: `urn:li:fsd_profile:p${i}`,
    name: `Sender ${i}`, headline: 'Headline', pictureUrl: '', publicId: `p${i}`,
    message: '', sentAt: 1_750_000_000_000 - i * 1000, status: 'pending',
    mutualCount: 0, mutualNames: [],
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_net_cmd_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.invitations.bulkPut([invitation(0), invitation(1)]);
  useUIStore.setState({ networkTab: 'invitations', networkSelectedIndex: 0 });
  (globalThis as any).IntersectionObserver = class {
    observe() {} disconnect() {}
  };
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

/**
 * Press until it lands. The key handler's effect lists the filtered lists in
 * its deps, so it re-subscribes every time one of the live queries resolves —
 * a single press can fall into the gap and be dropped. Retrying is what a user
 * holding a shortcut key would do anyway.
 */
async function press(target: Window | Element, init: object, mock: { mock: { calls: any[] } }) {
  await waitFor(() => {
    fireEvent.keyDown(target as any, { bubbles: true, ...init });
    expect(mock.mock.calls.length).toBeGreaterThan(0);
  });
}

async function renderNetwork() {
  render(<NetworkView />);
  // Wait for the DETAIL pane, not just a row. The key handler's effect lists
  // filteredInvitations in its deps, so it re-subscribes when the live query
  // resolves; a keypress fired before that closes over an empty list and is
  // silently dropped. The detail pane renders from the same data in the same
  // commit, so once it is on screen that commit's effect has run.
  await waitFor(() => expect(screen.getByText(/Accept invitation from/)).toBeTruthy());
}

describe('regression #155: ⌘↵ and ⌘I on the network view', () => {
  it('accepts the selected invitation on ⌘↵', async () => {
    await renderNetwork();

    await press(window, { key: 'Enter', metaKey: true }, acceptInvitation);

    expect(acceptInvitation.mock.calls[0][0].id).toBe('inv-0');
  });

  it('ignores the selected invitation on ⌘I', async () => {
    await renderNetwork();
    useUIStore.setState({ networkSelectedIndex: 1 });
    await waitFor(() => expect(screen.getByText(/Sender 1/)).toBeTruthy());

    await press(window, { key: 'i', metaKey: true }, ignoreInvitation);

    expect(ignoreInvitation.mock.calls[0][0].id).toBe('inv-1');
  });

  it('works with Ctrl for non-Mac keyboards', async () => {
    await renderNetwork();

    await press(window, { key: 'Enter', ctrlKey: true }, acceptInvitation);

    expect(acceptInvitation.mock.calls[0][0].id).toBe('inv-0');
  });

  it('still fires while the filter box has focus', async () => {
    await renderNetwork();
    const filter = screen.getByPlaceholderText(/^Filter invitations/);
    filter.focus();

    // A bare Enter here just blurs the field; the chord is unambiguous.
    await press(filter, { key: 'Enter', metaKey: true }, acceptInvitation);
  });

  it('does nothing on the Connections tab', async () => {
    await renderNetwork();
    useUIStore.setState({ networkTab: 'connections', networkSelectedIndex: 0 });
    // Wait for the re-render, or the key handler still closes over the old tab.
    await waitFor(() => expect(screen.getByPlaceholderText(/^Filter connections/)).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(window, { key: 'i', metaKey: true });

    // There is no invitation to accept or ignore over there.
    expect(acceptInvitation).not.toHaveBeenCalled();
    expect(ignoreInvitation).not.toHaveBeenCalled();
  });

  it('shows the chords on the buttons', async () => {
    await renderNetwork();

    // Discoverability: the detail pane's actions name their shortcut.
    expect(screen.getByText('⌘↵')).toBeTruthy();
    expect(screen.getByText('⌘I')).toBeTruthy();
  });
});
