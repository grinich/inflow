// @vitest-environment jsdom
// A third network pane for outgoing requests: who I asked, the note I sent,
// and Withdraw.
//
// Sent invitations get their OWN table rather than a `direction` flag on
// `invitations`, because the received walk prunes that table by
// `status === 'pending'` — sent rows sharing it would be deleted by a routine
// received sync.
import '../dom-setup';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';
import type { SentInvitation } from '@/types/network';

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

const withdrawInvitation = vi.fn();
vi.mock('@/hooks/useNetworkActions', () => ({
  useNetworkActions: () => ({
    acceptInvitation: vi.fn(), ignoreInvitation: vi.fn(), withdrawInvitation,
    messageConnection: vi.fn(), openProfile: vi.fn(),
  }),
}));

import { NetworkView } from '@/components/network/NetworkView';
import { useUIStore } from '@/store/ui-store';

function sent(i: number, message = ''): SentInvitation {
  return {
    id: `sent-${i}`, toUrn: `urn:li:fsd_profile:t${i}`,
    name: `Recipient ${i}`, headline: 'Their headline', pictureUrl: '', publicId: `t${i}`,
    message, sentAt: 1_750_000_000_000 - i * 1000, status: 'pending',
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  testDb = new Dexie(`TestDB_sent_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.sentInvitations.bulkPut([
    sent(0, 'Would love to trade notes.'),
    sent(1),
  ]);
  useUIStore.setState({ networkTab: 'sent', networkSelectedIndex: 0 });
  (globalThis as any).IntersectionObserver = class { observe() {} disconnect() {} };
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

async function renderSent() {
  render(<NetworkView />);
  await waitFor(() => expect(screen.getByText(/Waiting on/)).toBeTruthy());
}

describe('regression #156: the Sent tab', () => {
  it('lists outgoing requests', async () => {
    await renderSent();

    expect(screen.getAllByText('Recipient 0').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Recipient 1').length).toBeGreaterThan(0);
  });

  it('shows the note I sent, not one I received', async () => {
    await renderSent();

    expect(screen.getByText('Would love to trade notes.')).toBeTruthy();
  });

  it('says so when there was no note', async () => {
    await renderSent();
    useUIStore.setState({ networkSelectedIndex: 1 });

    // The page renders a note whenever one exists, so absence is real.
    await waitFor(() => expect(screen.getByText(/sent this without a note/)).toBeTruthy());
  });

  it('withdraws from the button', async () => {
    await renderSent();

    fireEvent.click(screen.getByText('Withdraw'));

    expect(withdrawInvitation).toHaveBeenCalledTimes(1);
    expect(withdrawInvitation.mock.calls[0][0].id).toBe('sent-0');
  });

  it('has no withdraw key — the button is the only way', async () => {
    await renderSent();

    // Deliberate: a stray D on the wrong tab must not silently retract a
    // request. Withdrawing is not symmetrical with ignoring an incoming one.
    fireEvent.keyDown(window, { key: 'd' });
    fireEvent.keyDown(window, { key: 'Backspace' });

    expect(withdrawInvitation).not.toHaveBeenCalled();
  });

  it('offers no Accept — there is nothing to accept on an outgoing request', async () => {
    await renderSent();

    expect(screen.queryByText('Accept')).toBeNull();
    expect(screen.queryByText('Ignore')).toBeNull();
  });

  it('does not explain itself when the list is short', async () => {
    // It used to footnote "Showing 10 of 310 — LinkedIn only hands over the
    // first page", which stopped being true once paging landed. A count that
    // disagrees with the list is a bug to fix, not a caption to write.
    await renderSent();

    expect(screen.queryByText(/Showing \d+ of/)).toBeNull();
    expect(screen.queryByText(/hands over the first page/)).toBeNull();
  });

  it('counts the outstanding requests on the tab', async () => {
    await renderSent();

    const tab = screen.getByTitle('Sent (3)');
    expect(tab.textContent).toContain('2');
  });

  it('only counts the ones still pending', async () => {
    await testDb.sentInvitations.update('sent-1', { status: 'withdrawn' });
    await renderSent();

    await waitFor(() => expect(screen.getByTitle('Sent (3)').textContent).toContain('1'));
    // A withdrawn row leaves the list rather than lingering greyed out.
    expect(screen.queryByText('Recipient 1')).toBeNull();
  });
});
