// @vitest-environment jsdom
// The Outbox is a pure status view: groups drafts/scheduled/sent, resurfaces due
// messages as "Ready to send" (never auto-sends), one-click send, delete, and
// reopens a draft in the composer.
import '../dom-setup';
import Dexie from 'dexie';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { switchDatabase, db } from '@/db/database';
import { OutboxView } from '@/components/outbox/OutboxView';
import { useUIStore } from '@/store/ui-store';
import type { ScheduledMessage } from '@/types/scheduled-message';

const sendBridgeMessage = vi.fn();
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: (...a: any[]) => sendBridgeMessage(...a) }));

function row(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: Math.random().toString(36).slice(2),
    recipientUrns: ['urn:li:fsd_profile:P'],
    recipientName: 'Ada Lovelace',
    body: 'Hey Ada!',
    status: 'draft',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

beforeEach(async () => {
  sendBridgeMessage.mockReset().mockResolvedValue({ success: true });
  await switchDatabase('MEMBER_OB');
  await db!.scheduledMessages.clear();
  await db!.conversations.clear();
  await db!.draftAttachments.clear();
  act(() => useUIStore.setState({ toast: null, activeSection: 'outbox', composeNewActive: false, selectedConversationId: null }));
});
afterEach(async () => {
  await Dexie.delete('InflowDB_MEMBER_OB').catch(() => {});
});

it('shows an empty state when the outbox is empty', async () => {
  render(<OutboxView />);
  expect(await screen.findByText(/No drafts or scheduled sends yet/i)).toBeInTheDocument();
});

it('lists a draft under Drafts and sends it now', async () => {
  await db!.scheduledMessages.add(row({ id: 'd1', body: 'Hey Ada!' }));
  render(<OutboxView />);

  expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  expect(screen.getByText('Drafts')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /send now/i }));
  await waitFor(() =>
    expect(sendBridgeMessage).toHaveBeenCalledWith({
      type: 'CREATE_CONVERSATION',
      recipientUrns: ['urn:li:fsd_profile:P'],
      body: 'Hey Ada!',
    }),
  );
  await waitFor(async () => expect((await db!.scheduledMessages.get('d1'))!.status).toBe('sent'));
});

it('sends a scheduled reply into its thread via SEND_MESSAGE (not CREATE_CONVERSATION)', async () => {
  await db!.scheduledMessages.add(
    row({ id: 'r1', conversationId: 'urn:li:msg_conversation:THREAD', body: 'Following up!' }),
  );
  render(<OutboxView />);
  await screen.findByText('Ada Lovelace');

  fireEvent.click(screen.getByRole('button', { name: /send now/i }));
  await waitFor(() =>
    expect(sendBridgeMessage).toHaveBeenCalledWith({
      type: 'SEND_MESSAGE',
      conversationId: 'urn:li:msg_conversation:THREAD',
      body: 'Following up!',
    }),
  );
  await waitFor(async () => expect((await db!.scheduledMessages.get('r1'))!.status).toBe('sent'));
});

it('Edit on a scheduled reply stays in the Outbox and leaves the thread alone', async () => {
  // This used to navigate to the real thread and stash the body in that
  // conversation's draft, which silently emptied the queue row.
  await db!.scheduledMessages.add(
    row({ id: 'r2', conversationId: 'urn:li:msg_conversation:T2', body: 'Reopen reply' }),
  );
  render(<OutboxView />);
  await screen.findByText('Ada Lovelace');

  fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));

  expect(await db!.scheduledMessages.get('r2')).toBeTruthy();
  expect(useUIStore.getState().selectedConversationId).not.toBe('urn:li:msg_conversation:T2');
  expect(await db!.draftAttachments.get('urn:li:msg_conversation:T2')).toBeUndefined();
  expect(screen.getByLabelText(/Message body/i)).toBeTruthy();
});

it('resurfaces a past-due scheduled message as Ready to send (does not auto-send)', async () => {
  await db!.scheduledMessages.add(row({ id: 's1', status: 'scheduled', scheduledAt: Date.now() - 60_000 }));
  render(<OutboxView />);

  expect((await screen.findAllByText('Ready to send')).length).toBeGreaterThan(0);
  expect(sendBridgeMessage).not.toHaveBeenCalled();
  expect((await db!.scheduledMessages.get('s1'))!.status).toBe('scheduled');
});

it('deletes a draft, once the discard question is answered', async () => {
  await db!.scheduledMessages.add(row({ id: 'd2' }));
  render(<OutboxView />);
  await screen.findByText('Ada Lovelace');

  // Delete asks first by default — it sits beside Send and cannot be undone.
  fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));
  expect(await db!.scheduledMessages.get('d2')).toBeTruthy();

  fireEvent.click(await screen.findByRole('button', { name: /^Delete$/i }));
  await waitFor(async () => expect(await db!.scheduledMessages.get('d2')).toBeUndefined());
});

it('Edit keeps the draft in the Outbox instead of minting an inbox conversation', async () => {
  // It used to create a draft: 1 conversation in PRIMARY_INBOX and drop the
  // queue row, so the draft appeared to vanish and landed among real threads.
  await db!.scheduledMessages.add(row({ id: 'd3', body: 'Reopen me', recipientUrns: ['urn:li:fsd_profile:Z'], recipientName: 'Zack Allen' }));
  render(<OutboxView />);
  await screen.findByText('Zack Allen');

  fireEvent.click(screen.getByRole('button', { name: /^Edit$/i }));

  expect(await db!.scheduledMessages.get('d3')).toBeTruthy();
  expect(await db!.conversations.get('draft-Z')).toBeUndefined();
  expect(await db!.draftAttachments.get('draft-Z')).toBeUndefined();

  // The body is editable where it sits.
  const field = screen.getByLabelText(/Message body/i) as HTMLTextAreaElement;
  expect(field.value).toBe('Reopen me');
});

it('explains why a long-overdue message did not send itself', async () => {
  // Auto-send is on and the time has passed, so without a word the silence
  // looks like a bug rather than a deliberate hold.
  useUIStore.setState({ autoSendScheduled: true });
  await db!.scheduledMessages.add(
    row({ id: 's9', status: 'scheduled', scheduledAt: Date.now() - 30 * 3600_000 }),
  );
  render(<OutboxView />);

  expect(await screen.findByText(/Too far past its time to send itself/i)).toBeTruthy();
});

it('says nothing of the sort about a message that is only a little late', async () => {
  useUIStore.setState({ autoSendScheduled: true });
  await db!.scheduledMessages.add(
    row({ id: 's10', status: 'scheduled', scheduledAt: Date.now() - 60_000 }),
  );
  render(<OutboxView />);

  await screen.findByText('Ada Lovelace');
  expect(screen.queryByText(/Too far past its time/i)).toBeNull();
});

it('clamps a long message so one card cannot stretch its whole row', async () => {
  // The grid aligns each row to its tallest card, so an unclamped long
  // message left the shorter cards beside it trailing white space.
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  await db!.scheduledMessages.add(row({ id: 'long1', body: long }));
  render(<OutboxView />);

  const body = await screen.findByText(/line 0/);
  expect(body.className).toMatch(/line-clamp/);

  // The whole message stays reachable.
  fireEvent.click(screen.getByRole('button', { name: /Show more/i }));
  expect(screen.getByText(/line 0/).className).not.toMatch(/line-clamp/);
  fireEvent.click(screen.getByRole('button', { name: /Show less/i }));
  expect(screen.getByText(/line 0/).className).toMatch(/line-clamp/);
});

it('offers no toggle on a message that already fits', async () => {
  await db!.scheduledMessages.add(row({ id: 'short1', body: 'Two lines\nonly' }));
  render(<OutboxView />);

  await screen.findByText(/Two lines/);
  expect(screen.queryByRole('button', { name: /Show more/i })).toBeNull();
});
