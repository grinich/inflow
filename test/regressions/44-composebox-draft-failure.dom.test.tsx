// @vitest-environment jsdom
// Regression 1: handleSend optimistically cleared the compose state AND the
// persisted draft row before sending. For draft- (new) conversations the
// failure path only showed a toast — no failed-message record, no offline
// queue — so the composed text and attachments were destroyed.
//
// Regression 2: the preview-URL useMemo recreated object URLs for EVERY image
// file whenever the attachments array changed, and the cleanup only revoked
// URLs of REMOVED files, so retained files' previous URLs leaked (pinning the
// file data in memory) on every attach/remove.
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

let testDb: any;

const mockSendMessage = vi.fn();
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
    sendAndArchive: vi.fn(),
    archiveConversation: vi.fn(),
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

// jsdom doesn't implement object URLs
let urlCounter = 0;
const createObjectURL = vi.fn(() => `blob:test/${++urlCounter}`);
const revokeObjectURL = vi.fn();

beforeEach(async () => {
  testDb = new Dexie(`ComposeFail_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockSendMessage.mockReset().mockResolvedValue(true);
  mockSendBridgeMessage.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  URL.createObjectURL = createObjectURL as any;
  URL.revokeObjectURL = revokeObjectURL as any;
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('restores the composed text when a draft-conversation send fails', async () => {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  const draftId = 'draft-fail-1';
  await testDb.conversations.put(makeConversation({
    id: draftId,
    draft: 1,
    participantUrns: ['urn:li:fsd_profile:RECIPIENT'],
    participantNames: ['Recipient'],
    participantPictures: [''],
  }));

  mockSendBridgeMessage.mockResolvedValue({ success: false, error: 'offline' });

  render(<ComposeBox conversationId={draftId} messages={[]} participantNames={['Recipient']} />);
  const textarea = screen.getByPlaceholderText('Reply...') as HTMLTextAreaElement;
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await userEvent.type(textarea, 'precious first message');

  await act(async () => {
    document.dispatchEvent(new CustomEvent('inflow:send'));
  });

  await waitFor(() => {
    expect(mockSendBridgeMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CREATE_CONVERSATION' })
    );
  });

  // The user's message must come back instead of being silently destroyed
  await waitFor(() => {
    expect(textarea.value).toBe('precious first message');
  });
  // ...and the persisted draft row must be restored too
  const draftRow = await testDb.draftAttachments.get(draftId);
  expect(draftRow?.text).toBe('precious first message');
});

it('restores the composed text when CREATE_CONVERSATION throws', async () => {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  const draftId = 'draft-fail-2';
  await testDb.conversations.put(makeConversation({
    id: draftId,
    draft: 1,
    participantUrns: ['urn:li:fsd_profile:RECIPIENT'],
    participantNames: ['Recipient'],
    participantPictures: [''],
  }));

  mockSendBridgeMessage.mockRejectedValue(new Error('network down'));

  render(<ComposeBox conversationId={draftId} messages={[]} participantNames={['Recipient']} />);
  const textarea = screen.getByPlaceholderText('Reply...') as HTMLTextAreaElement;
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await userEvent.type(textarea, 'hello again');

  await act(async () => {
    document.dispatchEvent(new CustomEvent('inflow:send'));
  });

  await waitFor(() => {
    expect(textarea.value).toBe('hello again');
  });
});

it('reuses preview object URLs for retained attachments instead of leaking them', async () => {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  const convId = '2-conv-urls';
  await testDb.conversations.put(makeConversation({ id: convId }));

  render(<ComposeBox conversationId={convId} messages={[]} participantNames={['Someone']} />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const fileA = new File(['a'], 'a.png', { type: 'image/png' });
  const fileB = new File(['b'], 'b.png', { type: 'image/png' });

  await act(async () => {
    document.dispatchEvent(new CustomEvent('inflow:attach-files', { detail: [fileA] }));
  });
  expect(createObjectURL).toHaveBeenCalledTimes(1);

  await act(async () => {
    document.dispatchEvent(new CustomEvent('inflow:attach-files', { detail: [fileB] }));
  });

  // One URL per unique file — fileA's URL must be reused, not recreated
  expect(createObjectURL).toHaveBeenCalledTimes(2);
  // ...and fileA's original URL must not have been dropped without revocation
  expect(revokeObjectURL).not.toHaveBeenCalled();
});
