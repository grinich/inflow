// @vitest-environment jsdom
// Regression: handleRetry had no in-flight guard. The failed bubble stays on
// screen until the delete commits and the live query re-renders, so a
// double-click ran the whole pipeline twice — the second delete was a no-op
// but BOTH calls reached sendMessage, actually sending the message twice.
import '../dom-setup';

// jsdom doesn't implement ResizeObserver (ThreadView uses it for scroll pinning)
if (typeof (globalThis as any).ResizeObserver === 'undefined') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import Dexie from 'dexie';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { makeConversation, makeMessage } from '../fixtures/factories';

let testDb: any;

const mockSendMessage = vi.fn();
const failedMessage = makeMessage({
  id: 'temp-failed-1',
  conversationId: '2-conv-retry',
  body: 'resend me',
  isFromMe: true,
  status: 'failed',
});

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return {
    ...original,
    get db() {
      return testDb;
    },
  };
});

vi.mock('@/hooks/useThread', () => ({
  useThread: () => [failedMessage],
}));

vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({
    sendMessage: mockSendMessage,
    markRead: vi.fn(),
  }),
}));

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (_fn: any, _deps: any, def: any) => def,
}));

vi.mock('@/components/thread/ThreadHeader', () => ({
  ThreadHeader: () => null,
}));

vi.mock('@/components/thread/ComposeBox', () => ({
  ComposeBox: () => null,
}));

beforeEach(async () => {
  testDb = new Dexie(`RetryGuard_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  await testDb.messages.put(failedMessage);
  mockSendMessage.mockReset().mockResolvedValue(true);
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

it('sends only once when the retry button is double-clicked', async () => {
  const { ThreadView } = await import('@/components/thread/ThreadView');
  const conversation = makeConversation({ id: '2-conv-retry' });

  render(<ThreadView conversation={conversation} composeRef={{ current: null }} />);

  const retryBtn = await screen.findByText('Failed — Click to retry');
  // Two rapid clicks before the async delete + re-render can remove the button
  fireEvent.click(retryBtn);
  fireEvent.click(retryBtn);

  await waitFor(() => expect(mockSendMessage).toHaveBeenCalled());
  // Give the second (buggy) pipeline a chance to land before asserting
  await new Promise((r) => setTimeout(r, 50));
  expect(mockSendMessage).toHaveBeenCalledTimes(1);
});
