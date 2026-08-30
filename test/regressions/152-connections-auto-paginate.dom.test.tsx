// @vitest-environment jsdom
// Regression: the Connections tab fetched exactly one page of 40 and then sat
// behind a "Load more connections" button. On an account with thousands of
// connections that reads as "you have 40 connections", and clicking through
// them 40 at a time is not a browsable list. Keyboard users had it worse:
// J past row 40 simply stopped, with no way to reach the rest at all.
import '../dom-setup';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Connection } from '@/types/network';

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
    messageConnection: vi.fn(), openProfile: vi.fn(),
  }),
}));

import { NetworkView } from '@/components/network/NetworkView';
import { useUIStore } from '@/store/ui-store';

const PAGE = 40;

function conn(i: number): Connection {
  return {
    profileUrn: `urn:li:fsd_profile:c${i}`,
    name: `Connection ${i}`,
    headline: 'Headline',
    pictureUrl: '',
    publicId: `c${i}`,
    connectedAt: 1_750_000_000_000 - i * 1000,
  };
}

/** Each FETCH_CONNECTIONS writes its page into the DB, like the real handler. */
function serveConnections(total: number) {
  sendBridgeMessage.mockImplementation(async (msg: any) => {
    if (msg.type === 'FETCH_INVITATIONS') return { success: true, data: { count: 0 } };
    if (msg.type !== 'FETCH_CONNECTIONS') return { success: true };
    const start = msg.start ?? 0;
    const rows = Array.from(
      { length: Math.max(0, Math.min(PAGE, total - start)) },
      (_, i) => conn(start + i)
    );
    await testDb.connections.bulkPut(rows);
    return { success: true, data: { fetched: rows.length, hasMore: start + rows.length < total } };
  });
}

let observerCallbacks: Array<(entries: any[]) => void> = [];

beforeEach(async () => {
  vi.clearAllMocks();
  observerCallbacks = [];
  testDb = new Dexie(`TestDB_conn_page_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ networkTab: 'connections', networkSelectedIndex: 0 });

  // jsdom has no IntersectionObserver; capture the callbacks so a test can
  // decide when the sentinel scrolls into view. `disconnect` really has to
  // drop the callback — otherwise a test firing "scrolled into view" also
  // fires observers the component already tore down, and the effect's own
  // guards look broken when they are not.
  (globalThis as any).IntersectionObserver = class {
    cb: (entries: any[]) => void;
    constructor(cb: (entries: any[]) => void) {
      this.cb = cb;
      observerCallbacks.push(cb);
    }
    observe() {}
    disconnect() {
      observerCallbacks = observerCallbacks.filter((c) => c !== this.cb);
    }
  };
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

describe('connections auto-pagination', () => {
  it('loads the next page when the end of the list scrolls into view', async () => {
    serveConnections(95);
    render(<NetworkView />);

    await waitFor(() => expect(screen.getAllByText('Connection 0').length).toBeGreaterThan(0));
    expect(await testDb.connections.count()).toBe(40);

    // Sentinel enters the viewport twice — the rest of the list follows.
    for (const round of [1, 2]) {
      observerCallbacks.forEach((cb) => cb([{ isIntersecting: true }]));
      await waitFor(() => expect(testDb.connections.count()).resolves.toBe(round === 1 ? 80 : 95));
    }
  });

  it('keeps loading as the keyboard selection nears the end', async () => {
    serveConnections(95);
    render(<NetworkView />);
    await waitFor(() => expect(screen.getAllByText('Connection 0').length).toBeGreaterThan(0));

    // J past row 40 used to dead-end; the selection nearing the tail now pulls
    // the next page in.
    useUIStore.setState({ networkSelectedIndex: 37 });

    await waitFor(() => expect(testDb.connections.count()).resolves.toBe(80));
  });

  it('marks the count as partial while more remain', async () => {
    serveConnections(95);
    render(<NetworkView />);

    // "40" claims that is all of them; "40+" does not.
    await waitFor(() => expect(screen.getByText('40+')).toBeInTheDocument());
  });

  it('drops the + once the whole list is in', async () => {
    serveConnections(25);
    render(<NetworkView />);

    await waitFor(() => expect(screen.getByText('25')).toBeInTheDocument());
    expect(screen.queryByText('25+')).not.toBeInTheDocument();
  });

  it('does not fetch the same page twice when both triggers fire', async () => {
    serveConnections(200);
    render(<NetworkView />);
    await waitFor(() => expect(screen.getAllByText('Connection 0').length).toBeGreaterThan(0));

    const before = sendBridgeMessage.mock.calls.filter((c) => c[0].type === 'FETCH_CONNECTIONS').length;
    // Sentinel and keyboard reach for the next page in the same tick.
    observerCallbacks.forEach((cb) => cb([{ isIntersecting: true }]));
    useUIStore.setState({ networkSelectedIndex: 38 });
    await waitFor(() => expect(testDb.connections.count()).resolves.toBe(80));

    const starts = sendBridgeMessage.mock.calls
      .filter((c) => c[0].type === 'FETCH_CONNECTIONS')
      .map((c) => c[0].start ?? 0);
    expect(new Set(starts).size).toBe(starts.length);
    expect(starts.length).toBeGreaterThan(before - 1);
  });

  it('stops auto-loading while a filter is active', async () => {
    serveConnections(200);
    render(<NetworkView />);
    await waitFor(() => expect(screen.getAllByText('Connection 0').length).toBeGreaterThan(0));

    await userEvent.type(screen.getByPlaceholderText(/^Filter connections/), 'Connection 1');
    const after = sendBridgeMessage.mock.calls.filter((c) => c[0].type === 'FETCH_CONNECTIONS').length;
    observerCallbacks.forEach((cb) => cb([{ isIntersecting: true }]));

    // Filtering searches what is synced; it must not trigger a paging walk.
    await new Promise((r) => setTimeout(r, 50));
    expect(sendBridgeMessage.mock.calls.filter((c) => c[0].type === 'FETCH_CONNECTIONS').length).toBe(after);
  });
});
