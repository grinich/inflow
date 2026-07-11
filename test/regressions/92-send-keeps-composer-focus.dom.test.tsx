// @vitest-environment jsdom
// Regression: sending a message (Enter → inflow:send) blurred the composer
// textarea, so users firing off several messages in a row (iMessage-style)
// had to refocus the composer after every send. Focus must stay in the
// composer after a normal send. Send+archive still blurs, since the
// conversation is archived away.
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySchema } from '@/db/database';
import { makeConversation } from '../fixtures/factories';

let testDb: any;

const mockSendMessage = vi.fn();
const mockSendAndArchive = vi.fn();

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
    archiveConversation: vi.fn(),
  }),
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
  testDb = new Dexie(`ComposeFocus_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockSendMessage.mockReset().mockResolvedValue(true);
  mockSendAndArchive.mockReset();
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function renderComposer(convId: string) {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  await testDb.conversations.put(makeConversation({ id: convId }));
  render(<ComposeBox conversationId={convId} messages={[]} participantNames={['Someone']} />);
  const textarea = screen.getByPlaceholderText('Reply...') as HTMLTextAreaElement;
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return textarea;
}

it('keeps focus in the composer after sending so the next message can be typed immediately', async () => {
  const textarea = await renderComposer('conv-focus-1');

  await userEvent.type(textarea, 'first message');
  expect(document.activeElement).toBe(textarea);

  await act(async () => {
    document.dispatchEvent(new CustomEvent('inflow:send'));
  });

  expect(mockSendMessage).toHaveBeenCalledTimes(1);
  // Composer cleared and still focused, ready for the next message
  expect(textarea.value).toBe('');
  expect(document.activeElement).toBe(textarea);

  // A second message can be sent without refocusing
  await userEvent.type(textarea, 'second message');
  await act(async () => {
    document.dispatchEvent(new CustomEvent('inflow:send'));
  });
  expect(mockSendMessage).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(textarea);
});

it('still blurs the composer on send+archive since the conversation goes away', async () => {
  const textarea = await renderComposer('conv-focus-2');

  await userEvent.type(textarea, 'parting words');
  expect(document.activeElement).toBe(textarea);

  await act(async () => {
    document.dispatchEvent(new CustomEvent('inflow:send-and-archive'));
  });

  expect(mockSendAndArchive).toHaveBeenCalledTimes(1);
  expect(document.activeElement).not.toBe(textarea);
});
