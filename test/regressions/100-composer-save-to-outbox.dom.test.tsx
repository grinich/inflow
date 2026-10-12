// @vitest-environment jsdom
// Feature: the composer's clock menu saves the current text to the queue as a
// draft or a scheduled send — persisted to IndexedDB (scheduledMessages) — for
// both new-message draft conversations and replies into an existing thread.
// A reply carries its conversationId so it later sends via SEND_MESSAGE.
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySchema } from '@/db/database';
import { settleOptimistic } from '../helpers/settle';
import { makeConversation } from '../fixtures/factories';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return { ...original, get db() { return testDb; } };
});

vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({
    sendMessage: vi.fn(),
    sendAndArchive: vi.fn(),
    archiveConversation: vi.fn(),
  }),
}));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn() }));
vi.mock('@/hooks/useAutocomplete', () => ({
  useAutocomplete: () => ({ suggestion: null, accept: vi.fn(), dismiss: vi.fn(), isOpen: false, isLoading: false }),
}));
vi.mock('@/hooks/useReplySuggestions', () => ({
  useReplySuggestions: () => ({ suggestions: [], isLoading: false, clear: vi.fn() }),
}));

URL.createObjectURL = vi.fn(() => 'blob:x') as any;
URL.revokeObjectURL = vi.fn() as any;

beforeEach(async () => {
  testDb = new Dexie(`SaveOutbox_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
});
afterEach(async () => {
  await settleOptimistic(testDb);
  if (testDb) { testDb.close(); await Dexie.delete(testDb.name); }
});

async function mountComposer(conversationId: string) {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  render(<ComposeBox conversationId={conversationId} messages={[]} participantNames={['Recipient']} />);
  const textarea = screen.getByPlaceholderText('Reply...') as HTMLTextAreaElement;
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return textarea;
}

it('saves a new-message draft to the queue (no conversationId)', async () => {
  const draftId = 'draft-SAVE';
  await testDb.conversations.put(makeConversation({
    id: draftId, draft: 1,
    participantUrns: ['urn:li:fsd_profile:R'], participantNames: ['Recipient'], participantPictures: [''],
  }));
  const textarea = await mountComposer(draftId);
  await userEvent.type(textarea, 'a saved draft');

  fireEvent.click(screen.getByRole('button', { name: /Save as draft or schedule/i }));
  fireEvent.click(screen.getByRole('button', { name: /^Save as draft$/i }));

  await waitFor(async () => {
    const rows = await testDb.scheduledMessages.toArray();
    expect(rows).toHaveLength(1);
  });
  const [row] = await testDb.scheduledMessages.toArray();
  expect(row.status).toBe('draft');
  expect(row.body).toBe('a saved draft');
  expect(row.recipientUrns).toEqual(['urn:li:fsd_profile:R']);
  expect(row.conversationId).toBeUndefined(); // new message → CREATE_CONVERSATION on send
});

it('schedules a reply into an existing thread (carries conversationId + scheduledAt)', async () => {
  const convId = 'urn:li:msg_conversation:THREAD';
  await testDb.conversations.put(makeConversation({
    id: convId,
    participantUrns: ['urn:li:fsd_profile:Z'], participantNames: ['Zack Allen'], participantPictures: [''],
  }));
  const textarea = await mountComposer(convId);
  await userEvent.type(textarea, 'a scheduled reply');

  fireEvent.click(screen.getByRole('button', { name: /Save as draft or schedule/i }));
  const dt = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
  const future = '2999-01-01T09:00';
  fireEvent.change(dt, { target: { value: future } });
  fireEvent.click(screen.getByRole('button', { name: /^Schedule$/i }));

  await waitFor(async () => {
    const rows = await testDb.scheduledMessages.toArray();
    expect(rows).toHaveLength(1);
  });
  const [row] = await testDb.scheduledMessages.toArray();
  expect(row.status).toBe('scheduled');
  expect(row.body).toBe('a scheduled reply');
  expect(row.conversationId).toBe(convId); // reply → SEND_MESSAGE on send
  expect(row.scheduledAt).toBe(new Date(future).getTime());
});
