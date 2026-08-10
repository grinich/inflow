// @vitest-environment jsdom
// The compose box has a visible "Attach a file" button (files could previously
// only be added via drag-drop or paste), and rejects files over the size limit.
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { applySchema } from '@/db/database';
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
  testDb = new Dexie(`AttachBtn_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  act(() => useUIStore.setState({ toast: null }));
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function renderCompose() {
  const { ComposeBox } = await import('@/components/thread/ComposeBox');
  await testDb.conversations.put(makeConversation({ id: 'c1', participantUrns: ['u1'], participantNames: ['Ada'] }));
  render(<ComposeBox conversationId="c1" messages={[]} participantNames={['Ada']} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

it('renders visible Attach file, Attach photo, and Emoji buttons', async () => {
  await renderCompose();
  expect(screen.getByRole('button', { name: /Attach a file/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Attach a photo/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Emoji$/i })).toBeInTheDocument();
});

it('opens the emoji picker and inserts an emoji into the composer', async () => {
  await renderCompose();
  fireEvent.click(screen.getByRole('button', { name: /^Emoji$/i }));
  const fire = await screen.findByRole('button', { name: 'fire' });
  fireEvent.mouseDown(fire);
  const textarea = screen.getByPlaceholderText('Reply...') as HTMLTextAreaElement;
  await waitFor(() => expect(textarea.value).toContain('🔥'));
});

it('adds a picked file as an attachment chip', async () => {
  await renderCompose();
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['hello'], 'notes.pdf', { type: 'application/pdf' });

  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });

  expect(await screen.findByText('notes.pdf')).toBeInTheDocument();
});

it('rejects files over the 20 MB limit with a toast and adds no chip', async () => {
  await renderCompose();
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const big = new File(['x'], 'huge.zip', { type: 'application/zip' });
  Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });

  await act(async () => {
    fireEvent.change(input, { target: { files: [big] } });
  });

  await waitFor(() => expect(useUIStore.getState().toast?.message).toMatch(/over the 20 MB limit/i));
  expect(screen.queryByText('huge.zip')).not.toBeInTheDocument();
});
