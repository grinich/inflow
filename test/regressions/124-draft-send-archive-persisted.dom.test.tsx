// @vitest-environment jsdom
/**
 * Regression: send+archive from a NEW-message draft persisted the created
 * conversation as UN-archived.
 *
 * handleDraftSend(text, files, true) sends ARCHIVE to LinkedIn for the real
 * conversation id, then writes the local row with archived: echoed?.archived
 * ?? 0 and category: echoed?.category || 'PRIMARY_INBOX' — the archive it
 * just performed wasn't represented, so the conversation sat in Focused until
 * a later sync corrected it.
 */
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

let testDb: any;

const { mockSendBridgeMessage } = vi.hoisted(() => ({ mockSendBridgeMessage: vi.fn() }));

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({
    sendMessage: vi.fn().mockResolvedValue(true),
    sendAndArchive: vi.fn(),
    archiveConversation: vi.fn(),
  }),
}));

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: mockSendBridgeMessage,
}));

vi.mock('@/hooks/useAutocomplete', () => ({
  useAutocomplete: () => ({ suggestion: null, accept: vi.fn(), dismiss: vi.fn(), isOpen: false, isLoading: false }),
}));

vi.mock('@/hooks/useReplySuggestions', () => ({
  useReplySuggestions: () => ({ suggestions: [], isLoading: false, clear: vi.fn() }),
}));

import { ComposeBox } from '@/components/thread/ComposeBox';

beforeEach(async () => {
  testDb = new Dexie(`DraftArchive_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  URL.createObjectURL = vi.fn(() => 'blob:test') as any;
  URL.revokeObjectURL = vi.fn() as any;

  mockSendBridgeMessage.mockReset().mockImplementation(async (msg: any) => {
    if (msg.type === 'CREATE_CONVERSATION') {
      return { success: true, data: { conversationId: '2-real-conv' } };
    }
    return { success: true };
  });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('persists the created conversation as archived after send+archive', async () => {
  await testDb.conversations.put(makeConversation({
    id: 'draft-arch-1',
    draft: 1,
    participantUrns: ['urn:li:fsd_profile:RECIPIENT'],
    participantNames: ['Recipient'],
    participantPictures: [''],
  }));

  render(<ComposeBox conversationId="draft-arch-1" messages={[]} participantNames={['Recipient']} />);
  const textarea = screen.getByPlaceholderText('Reply...') as HTMLTextAreaElement;
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await userEvent.type(textarea, 'sending and archiving');

  await act(async () => {
    document.dispatchEvent(new CustomEvent('inflow:send-and-archive'));
  });

  await waitFor(() => {
    expect(mockSendBridgeMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ARCHIVE', conversationId: '2-real-conv' })
    );
  });

  await waitFor(async () => {
    const row = await testDb.conversations.get('2-real-conv');
    expect(row).toBeTruthy();
    expect(row.archived).toBe(1);
    expect(row.category).toBe('ARCHIVE');
  });
});
