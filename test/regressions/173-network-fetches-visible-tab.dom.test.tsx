// @vitest-environment jsdom
// Opening the Network view fired all three fetches at once, so looking at
// Invitations also paid for a full walk of the sent list — the slowest of the
// three by far, and the one least likely to be wanted. Nothing outside this
// view reads those tables, so there is no count or badge that needs them.
//
// It fetches the tab being looked at, once per mount, and the others when they
// are opened. A tab whose fetch FAILED is the exception: those walks are long
// and the background gives up on a rate-limited page rather than retrying, so
// coming back to it must try again instead of showing an error until the whole
// view is closed and reopened.
import '../dom-setup';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a),
}));
vi.mock('@/hooks/useNetworkActions', () => ({
  useNetworkActions: () => ({
    acceptInvitation: vi.fn(), ignoreInvitation: vi.fn(),
    messageConnection: vi.fn(), openProfile: vi.fn(), withdrawInvitation: vi.fn(),
  }),
}));

import { NetworkView } from '@/components/network/NetworkView';
import { useUIStore } from '@/store/ui-store';

const types = () => sendBridgeMessage.mock.calls.map((c: any) => c[0].type);
const countOf = (type: string) => types().filter((t) => t === type).length;

beforeEach(async () => {
  sendBridgeMessage.mockReset().mockResolvedValue({ success: true, data: {} });
  testDb = new Dexie(`TestDB_tabfetch_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ appView: 'network', networkTab: 'invitations', networkSelectedIndex: 0 });
  (globalThis as any).IntersectionObserver = class { observe() {} disconnect() {} };
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

/** Let the mount effect's promise settle. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('regression #173: the Network view fetches the tab you are looking at', () => {
  it('asks only for the open tab on mount', async () => {
    render(<NetworkView />);
    await settle();

    expect(types()).toContain('FETCH_INVITATIONS');
    expect(types()).not.toContain('FETCH_SENT_INVITATIONS');
    expect(types()).not.toContain('FETCH_CONNECTIONS');
  });

  it('fetches a tab when it is opened', async () => {
    render(<NetworkView />);
    await settle();

    fireEvent.click(screen.getByText('Sent'));
    await settle();

    expect(types()).toContain('FETCH_SENT_INVITATIONS');
  });

  it('does not refetch a tab already loaded this mount', async () => {
    render(<NetworkView />);
    await settle();
    fireEvent.click(screen.getByText('Sent'));
    await settle();

    fireEvent.click(screen.getByText('Invitations'));
    await settle();
    fireEvent.click(screen.getByText('Sent'));
    await settle();

    expect(countOf('FETCH_SENT_INVITATIONS')).toBe(1);
    expect(countOf('FETCH_INVITATIONS')).toBe(1);
  });

  it('tries again when a tab’s fetch failed', async () => {
    // A rate-limited walk must not leave the tab permanently broken.
    sendBridgeMessage.mockImplementation(async (msg: any) =>
      msg.type === 'FETCH_SENT_INVITATIONS'
        ? { success: false, error: 'rate limited' }
        : { success: true, data: {} }
    );
    render(<NetworkView />);
    await settle();
    fireEvent.click(screen.getByText('Sent'));
    await settle();
    expect(countOf('FETCH_SENT_INVITATIONS')).toBe(1);

    fireEvent.click(screen.getByText('Invitations'));
    await settle();
    fireEvent.click(screen.getByText('Sent'));
    await settle();

    expect(countOf('FETCH_SENT_INVITATIONS')).toBe(2);
  });

  it('says why a tab is empty when its fetch failed', async () => {
    sendBridgeMessage.mockImplementation(async (msg: any) =>
      msg.type === 'FETCH_SENT_INVITATIONS'
        ? { success: false, error: 'rate limited' }
        : { success: true, data: {} }
    );
    render(<NetworkView />);
    await settle();

    fireEvent.click(screen.getByText('Sent'));

    // Not "no requests waiting on a reply" — that would be a lie.
    await waitFor(() => expect(screen.getByText(/rate limited/)).toBeTruthy());
  });
});
