// @vitest-environment jsdom
// The Network view used to render invitations as one full-width list with
// inline Accept/Ignore buttons on every row — it took over the whole layout
// instead of matching the inbox's two-pane shape. It is now list-left /
// detail-right: compact person rows on the left, and the selected invitation
// on the right as a profile card, the sender's note as a message bubble, and
// Accept/Ignore pinned to the bottom. j/k (and clicking a row) move which
// request the detail pane shows.
import '../dom-setup';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { Invitation, Connection } from '@/types/network';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: vi.fn().mockResolvedValue({ success: true, data: {} }),
}));

const acceptInvitation = vi.fn();
const ignoreInvitation = vi.fn();
const messageConnection = vi.fn();
vi.mock('@/hooks/useNetworkActions', () => ({
  useNetworkActions: () => ({
    acceptInvitation,
    ignoreInvitation,
    messageConnection,
    openProfile: vi.fn(),
  }),
}));

import { NetworkView } from '@/components/network/NetworkView';
import { useUIStore } from '@/store/ui-store';

function inv(i: number, over: Partial<Invitation> = {}): Invitation {
  return {
    id: `inv-${i}`,
    sharedSecret: 's',
    fromUrn: `urn:li:fsd_profile:m${i}`,
    name: `Sender ${i}`,
    headline: `Headline ${i}`,
    pictureUrl: '',
    publicId: `sender-${i}`,
    message: `Note from sender ${i}`,
    sentAt: 1_750_000_000_000 - i * 1000,
    status: 'pending',
    mutualCount: 0,
    mutualNames: [],
    ...over,
  };
}

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

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_net_pane_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ appView: 'network', networkTab: 'invitations', networkSelectedIndex: 0 });
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

async function renderWithInvitations() {
  await testDb.invitations.bulkPut([inv(0), inv(1), inv(2)]);
  render(<NetworkView />);
  // The bubble holds the bare note; row previews render it inside “quotes”,
  // so the exact-text query below can only match the detail pane.
  await waitFor(() => expect(screen.getByText('Note from sender 0')).toBeInTheDocument());
}

describe('network two-pane layout', () => {
  it('shows the selected invitation in a detail pane beside the list', async () => {
    await renderWithInvitations();

    // All three rows are listed, but only the selected request's note and
    // actions are on screen.
    expect(screen.getAllByText('Sender 0').length).toBeGreaterThan(1); // row + detail card
    expect(screen.getAllByText('Sender 1')).toHaveLength(1); // row only
    expect(screen.queryByText('Note from sender 1')).toBeNull();
    expect(screen.getByText('Accept')).toBeInTheDocument();
    expect(screen.getByText('Ignore')).toBeInTheDocument();
    expect(screen.getByText('View Profile')).toBeInTheDocument();
  });

  it('j/k move the detail pane between requests', async () => {
    await renderWithInvitations();

    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => expect(screen.getByText('Note from sender 1')).toBeInTheDocument());
    expect(screen.queryByText('Note from sender 0')).toBeNull();

    fireEvent.keyDown(document.body, { key: 'k' });
    await waitFor(() => expect(screen.getByText('Note from sender 0')).toBeInTheDocument());
  });

  it('clicking a row selects it', async () => {
    await renderWithInvitations();

    fireEvent.click(screen.getByText('Sender 2'));

    await waitFor(() => expect(screen.getByText('Note from sender 2')).toBeInTheDocument());
    expect(useUIStore.getState().networkSelectedIndex).toBe(2);
  });

  it('the detail-pane buttons act on the selected invitation', async () => {
    await renderWithInvitations();

    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => expect(screen.getByText('Note from sender 1')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Accept'));
    expect(acceptInvitation).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1' }));

    fireEvent.click(screen.getByText('Ignore'));
    expect(ignoreInvitation).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1' }));
  });

  it('renders no bubble for an invitation without a note', async () => {
    await testDb.invitations.put(inv(0, { message: '' }));
    render(<NetworkView />);

    await waitFor(() => expect(screen.getAllByText('Sender 0').length).toBeGreaterThan(1));
    expect(screen.queryByText(/Note from/)).toBeNull();
    // The actions are still there — a bare request is still answerable.
    expect(screen.getByText('Accept')).toBeInTheDocument();
  });

  it('the connections tab gets the same treatment, with Message in the detail pane', async () => {
    await testDb.connections.bulkPut([conn(0), conn(1)]);
    useUIStore.setState({ networkTab: 'connections' });
    render(<NetworkView />);

    await waitFor(() => expect(screen.getAllByText('Connection 0').length).toBeGreaterThan(1));

    fireEvent.click(screen.getByText('Message'));
    expect(messageConnection).toHaveBeenCalledWith(
      expect.objectContaining({ profileUrn: 'urn:li:fsd_profile:c0' })
    );
  });
});
