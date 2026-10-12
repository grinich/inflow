// @vitest-environment jsdom
/**
 * Human in the middle for InMail.
 *
 * An InMail goes to someone the user has never spoken to, whose URN came from
 * a live LinkedIn name search rather than their own synced data — a search for
 * one real prospect returned two different people with the same name — and
 * sending it spends a credit. So the Outbox shows the recipient's profile link
 * and keeps Send disabled until a human confirms it is the right person.
 *
 * Connections are exempt: their URN came from the user's own connection list,
 * so there is nothing to disambiguate and nothing to spend.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { settleOptimistic } from '../helpers/settle';
import { useUIStore } from '@/store/ui-store';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return { ...original, get db() { return testDb; } };
});

const sendBridgeMessage = vi.fn().mockResolvedValue({ success: true, data: {} });
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a) }));

import { OutboxRow } from '@/components/outbox/OutboxRow';

const PROFILE = 'https://www.linkedin.com/in/dana-whitfield-4471/';

function draft(over: any = {}) {
  return {
    id: 'd1',
    recipientUrns: ['urn:li:fsd_profile:DANA'],
    recipientName: 'Dana Whitfield',
    body: 'Ms. Whitfield,',
    status: 'draft' as const,
    createdAt: 1,
    updatedAt: 1,
    inMailSubject: 'Built for billing teams',
    profileUrl: PROFILE,
    source: 'mcp' as const,
    ...over,
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_102_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockClear();
  useUIStore.setState({ confirmRecipient: true, toast: null });
});

afterEach(async () => {
  await settleOptimistic(testDb);
  testDb.close();
});

const sendButton = () => screen.getByRole('button', { name: /Send now/i }) as HTMLButtonElement;

it('shows the profile link and blocks Send until a human confirms', async () => {
  const msg = draft();
  await testDb.scheduledMessages.put(msg);
  render(<OutboxRow msg={msg as any} />);

  const link = screen.getByRole('link') as HTMLAnchorElement;
  expect(link.href).toBe(PROFILE);
  // Opens LinkedIn itself, so the check is against the real profile.
  expect(link.target).toBe('_blank');

  expect(sendButton().disabled).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: /This is the right person/i }));

  await waitFor(async () => {
    const stored = await testDb.scheduledMessages.get('d1');
    expect(stored.recipientConfirmedAt).toBeGreaterThan(0);
  });
  // Nothing was sent by confirming — it only unlocks the button.
  expect(sendBridgeMessage).not.toHaveBeenCalled();
});

it('leaves Send enabled once the recipient is already confirmed', async () => {
  const msg = draft({ recipientConfirmedAt: 123 });
  await testDb.scheduledMessages.put(msg);
  render(<OutboxRow msg={msg as any} />);

  expect(sendButton().disabled).toBe(false);
  expect(screen.getByText(/Recipient confirmed/i)).toBeTruthy();
});

it('does not gate an InMail the user wrote themselves in the composer', async () => {
  // No source: the user picked this recipient from a list showing their name,
  // headline and photo, so they are already the human in the middle. Gating it
  // asked them to confirm against a link the composer cannot supply.
  const msg = draft({ source: undefined, profileUrl: undefined });
  await testDb.scheduledMessages.put(msg);
  render(<OutboxRow msg={msg as any} />);

  expect(sendButton().disabled).toBe(false);
  expect(screen.queryByText(/No profile link on this draft/i)).toBeNull();
  expect(screen.queryByRole('button', { name: /This is the right person/i })).toBeNull();
});

it('does not gate a normal message to a connection', async () => {
  // No inMailSubject: this is a free message to someone already synced.
  const msg = draft({ inMailSubject: undefined, profileUrl: undefined });
  await testDb.scheduledMessages.put(msg);
  render(<OutboxRow msg={msg as any} />);

  expect(sendButton().disabled).toBe(false);
  expect(screen.queryByRole('link')).toBeNull();
});

it('does not gate when the user has turned the check off', async () => {
  useUIStore.setState({ confirmRecipient: false });
  const msg = draft();
  await testDb.scheduledMessages.put(msg);
  render(<OutboxRow msg={msg as any} />);

  expect(sendButton().disabled).toBe(false);
  // The link stays, since it is useful even when it is not required.
  expect((screen.getByRole('link') as HTMLAnchorElement).href).toBe(PROFILE);
  expect(screen.queryByRole('button', { name: /This is the right person/i })).toBeNull();
});
