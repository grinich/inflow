// @vitest-environment jsdom
// A failed load rendered exactly like an empty one.
//
// NetworkView fired its three fetches inside Promise.allSettled and discarded
// every result, so "you have no sent requests" and "the sent endpoint answered
// 400 on every call" produced the same screen. That is how a Sent tab shipped
// against an endpoint LinkedIn had removed: the UI said "No requests waiting
// on a reply" and looked entirely healthy.
//
// Worth stating plainly, because no unit test could have caught the original
// fault: the suite mocks the API layer, so a wrong URL always "works" here.
// What IS testable — and what this pins — is that the failure reaches the
// screen instead of being swallowed.
import '../dom-setup';
import { render, screen, waitFor } from '@testing-library/react';
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
    acceptInvitation: vi.fn(), ignoreInvitation: vi.fn(), withdrawInvitation: vi.fn(),
    messageConnection: vi.fn(), openProfile: vi.fn(),
  }),
}));

import { NetworkView } from '@/components/network/NetworkView';
import { useUIStore } from '@/store/ui-store';

/** Every fetch succeeds except the named ones, which fail like the bridge does. */
function serve(failures: Record<string, string | 'throw'>) {
  sendBridgeMessage.mockImplementation(async (msg: any) => {
    const f = failures[msg.type];
    if (f === 'throw') throw new Error('service worker asleep');
    if (f) return { success: false, error: f };
    return { success: true, data: { count: 0, hasMore: false } };
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_fail_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ networkTab: 'sent', networkSelectedIndex: 0 });
  (globalThis as any).IntersectionObserver = class { observe() {} disconnect() {} };
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

describe('regression #158: a failed load says so', () => {
  it('reports the failure rather than claiming the list is empty', async () => {
    serve({ FETCH_SENT_INVITATIONS: 'fetchSentInvitations failed: 400' });
    render(<NetworkView />);

    await waitFor(() => expect(screen.getByText(/Couldn't load this list/)).toBeTruthy());
    expect(screen.queryByText('No requests waiting on a reply.')).toBeNull();
  });

  it('shows the reason, so a dead endpoint is diagnosable', async () => {
    serve({ FETCH_SENT_INVITATIONS: 'fetchSentInvitations failed: 400' });
    render(<NetworkView />);

    await waitFor(() => expect(screen.getByText(/failed: 400/)).toBeTruthy());
  });

  it('still says "empty" when the fetch genuinely succeeded with nothing', async () => {
    serve({});
    render(<NetworkView />);

    await waitFor(() => expect(screen.getByText('No requests waiting on a reply.')).toBeTruthy());
    expect(screen.queryByText(/Couldn't load this list/)).toBeNull();
  });

  it('catches a rejected bridge call too, not just success:false', async () => {
    serve({ FETCH_SENT_INVITATIONS: 'throw' });
    render(<NetworkView />);

    await waitFor(() => expect(screen.getByText(/Couldn't load this list/)).toBeTruthy());
  });

  it('blames only the tab that failed', async () => {
    serve({ FETCH_SENT_INVITATIONS: 'boom' });
    render(<NetworkView />);
    await waitFor(() => expect(screen.getByText(/Couldn't load this list/)).toBeTruthy());

    useUIStore.setState({ networkTab: 'invitations' });

    // Invitations loaded fine; it must not inherit Sent's error.
    await waitFor(() => expect(screen.getByText('No pending invitations.')).toBeTruthy());
  });

  it('reports a failed invitations load as well', async () => {
    serve({ FETCH_INVITATIONS: 'fetchInvitations failed: 429' });
    useUIStore.setState({ networkTab: 'invitations' });
    render(<NetworkView />);

    await waitFor(() => expect(screen.getByText(/failed: 429/)).toBeTruthy());
  });

  it('reports a failed connections load as well', async () => {
    serve({ FETCH_CONNECTIONS: 'fetchConnections failed: 500' });
    useUIStore.setState({ networkTab: 'connections' });
    render(<NetworkView />);

    await waitFor(() => expect(screen.getByText(/failed: 500/)).toBeTruthy());
  });
});
