// @vitest-environment jsdom
// The detail pane's Accept and Ignore name their keys, and those keys work.
//
// Buttons with no hint leave a keyboard-driven app's main actions undiscovered;
// hints that name a key the handler does not implement are worse. This pins
// the two together, so the label and the binding cannot drift apart.
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

describe('regression #155: the invitation actions and their hints', () => {
  it('accepts the selected invitation on Enter', async () => {
    await renderNetwork();

    await press(window, { key: 'Enter' }, acceptInvitation);

    expect(acceptInvitation.mock.calls[0][0].id).toBe('inv-0');
  });

  it('ignores the selected invitation on D', async () => {
    await renderNetwork();
    useUIStore.setState({ networkSelectedIndex: 1 });
    await waitFor(() => expect(screen.getByText(/Sender 1/)).toBeTruthy());

    await press(window, { key: 'd' }, ignoreInvitation);

    expect(ignoreInvitation.mock.calls[0][0].id).toBe('inv-1');
  });

  it('also ignores on Backspace', async () => {
    await renderNetwork();

    await press(window, { key: 'Backspace' }, ignoreInvitation);

    expect(ignoreInvitation.mock.calls[0][0].id).toBe('inv-0');
  });

  it('leaves the keys alone while the filter box has focus', async () => {
    await renderNetwork();
    const filter = screen.getByPlaceholderText(/^Filter invitations/);
    filter.focus();

    // Typing a `d` into the filter must not ignore the selected invitation.
    fireEvent.keyDown(filter, { key: 'd', bubbles: true });

    expect(ignoreInvitation).not.toHaveBeenCalled();
  });

  it('does nothing on the Connections tab', async () => {
    await renderNetwork();
    useUIStore.setState({ networkTab: 'connections', networkSelectedIndex: 0 });
    // Wait for the re-render, or the key handler still closes over the old tab.
    await waitFor(() => expect(screen.getByPlaceholderText(/^Filter connections/)).toBeTruthy());

    fireEvent.keyDown(window, { key: 'd' });

    // There is no invitation to ignore over there.
    expect(ignoreInvitation).not.toHaveBeenCalled();
  });

  it('shows those same keys on the buttons', async () => {
    await renderNetwork();

    expect(screen.getByText('↵')).toBeTruthy();
    expect(screen.getByText('D')).toBeTruthy();
  });
});
