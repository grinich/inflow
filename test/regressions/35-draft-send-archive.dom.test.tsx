// @vitest-environment jsdom
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

let testDb: any;

const mockSendAndArchive = vi.fn();
const mockSendMessage = vi.fn();
const mockArchiveConversation = vi.fn();
const mockSendBridgeMessage = vi.fn();

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
    sendMessage: mockSendMessage,
    sendAndArchive: mockSendAndArchive,
    archiveConversation: mockArchiveConversation,
  }),
}));

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: mockSendBridgeMessage,
}));

vi.mock('@/hooks/useAutocomplete', () => ({
  useAutocomplete: () => ({
    suggestion: null,
    accept: vi.fn(),
    dismiss: vi.fn(),
    isOpen: false,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useReplySuggestions', () => ({
  useReplySuggestions: () => ({
    suggestions: [],
    isLoading: false,
    clear: vi.fn(),
  }),
}));

beforeEach(async () => {
  testDb = new Dexie(`DraftSendArchive_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockSendAndArchive.mockReset().mockResolvedValue(undefined);
  mockSendMessage.mockReset().mockResolvedValue(true);
  mockArchiveConversation.mockReset().mockResolvedValue(undefined);
  mockSendBridgeMessage.mockReset().mockResolvedValue({
    success: true,
    data: { conversationId: 'real-conv-1' },
  });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('uses CREATE_CONVERSATION, not SEND_MESSAGE+ARCHIVE, for Cmd+Enter on draft conversations', async () => {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  const draftId = 'draft-recipient-1';
  await testDb.conversations.put(makeConversation({
    id: draftId,
    draft: 1,
    participantUrns: ['urn:li:fsd_profile:RECIPIENT'],
    participantNames: ['Recipient'],
    participantPictures: [''],
  }));

  render(<ComposeBox conversationId={draftId} messages={[]} participantNames={['Recipient']} />);
  const textarea = screen.getByPlaceholderText('Reply...');
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await userEvent.type(textarea, 'hello draft');
  expect((textarea as HTMLTextAreaElement).value).toBe('hello draft');

  await act(async () => {
    document.dispatchEvent(new CustomEvent('inflow:send-and-archive'));
  });

  expect(mockSendAndArchive).not.toHaveBeenCalled();
  await waitFor(() => {
    expect(mockSendBridgeMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CREATE_CONVERSATION',
      recipientUrns: ['urn:li:fsd_profile:RECIPIENT'],
      body: 'hello draft',
    }));
  });
  expect(mockSendAndArchive).not.toHaveBeenCalled();
});
