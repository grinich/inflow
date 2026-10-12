// @vitest-environment jsdom
// The composer shows a live character counter once you're typing a message,
// so long messages feel intentional and you can see LinkedIn's ~8,000 cap.
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { applySchema } from '@/db/database';
import { settleOptimistic } from '../helpers/settle';
import { makeConversation } from '../fixtures/factories';
import { useUIStore } from '@/store/ui-store';

let testDb: any;

vi.mock('@/db/database', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/db/database')>();
  return { ...original, get db() { return testDb; } };
});
vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => ({ sendMessage: vi.fn(), sendAndArchive: vi.fn(), archiveConversation: vi.fn() }),
}));
vi.mock('@/lib/bridge', () => ({ sendBridgeMessage: vi.fn().mockResolvedValue({ success: true }) }));
vi.mock('@/hooks/useAutocomplete', () => ({
  useAutocomplete: () => ({ suggestion: null, accept: vi.fn(), dismiss: vi.fn(), isOpen: false, isLoading: false }),
}));
vi.mock('@/hooks/useReplySuggestions', () => ({
  useReplySuggestions: () => ({ suggestions: [], isLoading: false, clear: vi.fn() }),
}));

beforeEach(async () => {
  testDb = new Dexie(`CharCount_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  act(() => useUIStore.setState({ toast: null }));
});
afterEach(async () => {
  await settleOptimistic(testDb);
  if (testDb) { testDb.close(); await Dexie.delete(testDb.name); }
});

async function renderCompose() {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  await testDb.conversations.put(makeConversation({ id: 'c1', participantUrns: ['u1'], participantNames: ['Ada'] }));
  render(<ComposeBox conversationId="c1" messages={[]} participantNames={['Ada']} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

it('hides the counter when empty and shows the count as you type', async () => {
  await renderCompose();
  // Empty: no counter.
  expect(screen.queryByTitle(/of 8,000 characters/i)).not.toBeInTheDocument();
  const ta = screen.getByPlaceholderText('Reply...');
  fireEvent.change(ta, { target: { value: 'hello there' } });
  expect(screen.getByText('11')).toBeInTheDocument();
});

it('shows the limit and count together once near the cap', async () => {
  await renderCompose();
  const ta = screen.getByPlaceholderText('Reply...');
  fireEvent.change(ta, { target: { value: 'x'.repeat(7600) } });
  // Past 90% of 8,000 → shows "7,600 / 8,000".
  expect(screen.getByText('7,600 / 8,000')).toBeInTheDocument();
});
