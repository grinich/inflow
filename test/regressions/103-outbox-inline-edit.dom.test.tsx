// @vitest-environment jsdom
/**
 * Regression: editing an Outbox draft relocated it and lost data.
 *
 * "Edit" reopened the draft in the thread composer, which minted a
 * conversation with category PRIMARY_INBOX and draft: 1, dropped the
 * scheduledMessages row, and navigated there. Three consequences:
 *   - a fake thread appeared in Primary beside real conversations;
 *   - the draft left the Outbox, so it looked like it had vanished;
 *   - the InMail subject was lost outright, because draftAttachments stores
 *     {conversationId, text, files, names, types} and has nowhere to put it.
 *
 * Editing now happens in the row. Also ungates scheduling: a draft with no
 * send time is the most likely thing to want one, but the picker used to be
 * offered only on something already scheduled.
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
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn().mockResolvedValue({ success: true }) }));

import { OutboxRow } from '@/components/outbox/OutboxRow';

function draft(over: any = {}) {
  return {
    id: 'd1',
    recipientUrns: ['urn:li:fsd_profile:DANA'],
    recipientName: 'Dana Whitfield',
    body: 'Ms. Whitfield,',
    status: 'draft' as const,
    createdAt: 1,
    updatedAt: 1,
    source: 'mcp' as const,
    inMailSubject: 'Built for billing teams',
    profileUrl: 'https://www.linkedin.com/in/dana-whitfield-4471/',
    ...over,
  };
}

beforeEach(async () => {
  testDb = new Dexie(`TestDB_103_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  useUIStore.setState({ confirmRecipient: true, confirmDelete: true, toast: null });
});

afterEach(async () => {
  await settleOptimistic(testDb);
  testDb.close();
});

it('edits the body and subject in place, keeping the draft in the Outbox', async () => {
  const msg = draft();
  await testDb.scheduledMessages.put(msg);
  render(<OutboxRow msg={msg as any} />);

  fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
  fireEvent.change(screen.getByLabelText(/InMail subject/i), { target: { value: 'A better subject' } });
  fireEvent.change(screen.getByLabelText(/Message body/i), { target: { value: 'A better pitch' } });
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

  await waitFor(async () => {
    const row = await testDb.scheduledMessages.get('d1');
    expect(row.body).toBe('A better pitch');
    // The subject survives, which reopening in the composer could not manage.
    expect(row.inMailSubject).toBe('A better subject');
  });

  // No fake conversation was minted in the inbox.
  expect(await testDb.conversations.count()).toBe(0);
  expect(await testDb.draftAttachments.count()).toBe(0);
});

it('clears a recipient confirmation when the message itself changes', async () => {
  const msg = draft({ recipientConfirmedAt: 99 });
  await testDb.scheduledMessages.put(msg);
  render(<OutboxRow msg={msg as any} />);

  fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
  fireEvent.change(screen.getByLabelText(/Message body/i), { target: { value: 'Something else entirely' } });
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

  await waitFor(async () => {
    expect((await testDb.scheduledMessages.get('d1')).recipientConfirmedAt).toBeUndefined();
  });
});

it('keeps the confirmation when an edit is opened and abandoned', async () => {
  const msg = draft({ recipientConfirmedAt: 99 });
  await testDb.scheduledMessages.put(msg);
  render(<OutboxRow msg={msg as any} />);

  fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
  fireEvent.change(screen.getByLabelText(/Message body/i), { target: { value: 'typing...' } });
  fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

  const row = await testDb.scheduledMessages.get('d1');
  expect(row.body).toBe('Ms. Whitfield,');
  expect(row.recipientConfirmedAt).toBe(99);
});

it('offers a subject field only on something already queued as an InMail', () => {
  // Adding one to a plain draft would turn a free message into a paid one.
  const msg = draft({ inMailSubject: undefined, source: undefined });
  render(<OutboxRow msg={msg as any} />);
  fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
  expect(screen.queryByLabelText(/InMail subject/i)).toBeNull();
  expect(screen.getByLabelText(/Message body/i)).toBeTruthy();
});

it('offers scheduling on a plain draft, not just on something already scheduled', async () => {
  const msg = draft({ status: 'draft' });
  await testDb.scheduledMessages.put(msg);
  render(<OutboxRow msg={msg as any} />);

  fireEvent.click(screen.getByRole('button', { name: /^Schedule$/ }));
  const when = new Date(Date.now() + 3600_000);
  const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  fireEvent.change(screen.getByDisplayValue(''), { target: { value: local } });
  fireEvent.click(screen.getByRole('button', { name: /Set time/i }));

  await waitFor(async () => {
    const row = await testDb.scheduledMessages.get('d1');
    expect(row.status).toBe('scheduled');
    expect(row.scheduledAt).toBeGreaterThan(Date.now());
  });
});

it('says Reschedule once a time is already set', () => {
  render(<OutboxRow msg={draft({ status: 'scheduled', scheduledAt: Date.now() + 1000 }) as any} />);
  expect(screen.getByRole('button', { name: /^Reschedule$/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Schedule$/ })).toBeNull();
});
