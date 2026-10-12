// @vitest-environment jsdom
// Messaging a non-connection can only go out as a Premium InMail: it carries a
// subject and spends one of the account's InMail credits. The composer decides
// that from the synced connection list, so the cost is disclosed before the
// send rather than discovered after it.
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { settleOptimistic } from '../helpers/settle';
import { makeConversation } from '../fixtures/factories';
import { useUIStore } from '@/store/ui-store';

const { sendBridgeMessageMock } = vi.hoisted(() => ({
  sendBridgeMessageMock: vi.fn().mockResolvedValue({ success: true, data: { conversationId: 'real-1' } }),
}));

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return { ...original, get db() { return testDb; } };
});
vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({ sendMessage: vi.fn(), sendAndArchive: vi.fn(), archiveConversation: vi.fn() }),
}));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: sendBridgeMessageMock }));
vi.mock('@/hooks/useAutocomplete', () => ({
  useAutocomplete: () => ({ suggestion: null, accept: vi.fn(), dismiss: vi.fn(), isOpen: false, isLoading: false }),
}));
vi.mock('@/hooks/useReplySuggestions', () => ({
  useReplySuggestions: () => ({ suggestions: [], isLoading: false, clear: vi.fn() }),
}));

beforeEach(async () => {
  testDb = new Dexie(`InMail_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessageMock.mockClear();
  act(() => useUIStore.setState({ toast: null }));
});
afterEach(async () => {
  await settleOptimistic(testDb);
  if (testDb) { testDb.close(); await Dexie.delete(testDb.name); }
});

/** A pending new-message conversation to `urn`, optionally a known connection. */
async function renderDraftTo(urn: string, name: string, isConnection: boolean) {
  await testDb.conversations.put(
    makeConversation({ id: 'draft-x', draft: 1, participantUrns: [urn], participantNames: [name] }),
  );
  if (isConnection) {
    await testDb.connections.put({
      profileUrn: urn, connectionUrn: 'urn:li:fsd_connection:C', connectedAt: 1, publicId: '',
      firstName: name, lastName: '', fullName: name, headline: '', pictureUrl: '', syncedAt: 0,
    });
  }
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  render(<ComposeBox conversationId="draft-x" messages={[]} participantNames={[name]} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

it('warns about the credit and offers a subject when the recipient is not a connection', async () => {
  await renderDraftTo('urn:li:fsd_profile:STRANGER', 'Theo Marsh', false);
  expect(await screen.findByText(/uses one InMail credit/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/InMail subject/i)).toBeInTheDocument();
});

it('sends it as an InMail, carrying the subject', async () => {
  await renderDraftTo('urn:li:fsd_profile:STRANGER', 'Theo Marsh', false);
  fireEvent.change(await screen.findByLabelText(/InMail subject/i), {
    target: { value: 'Working smarter at Med Smart' },
  });
  fireEvent.change(screen.getByPlaceholderText('Reply...'), { target: { value: 'Mr. Albert,' } });
  fireEvent.click(screen.getByRole('button', { name: /^Send/i }));

  await waitFor(() => expect(sendBridgeMessageMock).toHaveBeenCalled());
  const sent = sendBridgeMessageMock.mock.calls.find((c) => c[0]?.type === 'CREATE_CONVERSATION')![0];
  expect(sent.inMail).toEqual({ subject: 'Working smarter at Med Smart' });
});

it('does NOT spend a credit when the recipient is a real connection', async () => {
  await renderDraftTo('urn:li:fsd_profile:FRIEND', 'Ada Lovelace', true);
  // No warning, no subject box — this is an ordinary message.
  expect(screen.queryByText(/InMail credit/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/InMail subject/i)).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('Reply...'), { target: { value: 'hi Ada' } });
  fireEvent.click(screen.getByRole('button', { name: /^Send/i }));

  await waitFor(() => expect(sendBridgeMessageMock).toHaveBeenCalled());
  const sent = sendBridgeMessageMock.mock.calls.find((c) => c[0]?.type === 'CREATE_CONVERSATION')![0];
  expect(sent.inMail).toBeUndefined();
});

it('carries the subject into the Outbox so a later send is still an InMail', async () => {
  await renderDraftTo('urn:li:fsd_profile:STRANGER', 'Theo Marsh', false);
  fireEvent.change(await screen.findByLabelText(/InMail subject/i), {
    target: { value: 'Working smarter' },
  });
  fireEvent.change(screen.getByPlaceholderText('Reply...'), { target: { value: 'Mr. Albert,' } });

  // Queue it instead of sending now.
  fireEvent.click(screen.getByRole('button', { name: 'Save as draft or schedule' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save as draft' }));

  await waitFor(async () => {
    const queued = await testDb.scheduledMessages.toArray();
    expect(queued).toHaveLength(1);
    // Without this the message would quietly go out as a normal message later,
    // to someone who cannot receive one.
    expect(queued[0].inMailSubject).toBe('Working smarter');
  });
});

it('queues an ordinary message with no InMail subject at all', async () => {
  await renderDraftTo('urn:li:fsd_profile:FRIEND', 'Ada Lovelace', true);
  fireEvent.change(screen.getByPlaceholderText('Reply...'), { target: { value: 'hi Ada' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save as draft or schedule' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save as draft' }));

  await waitFor(async () => {
    const queued = await testDb.scheduledMessages.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].inMailSubject).toBeUndefined();
  });
});
