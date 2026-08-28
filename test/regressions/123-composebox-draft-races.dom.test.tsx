// @vitest-environment jsdom
/**
 * Regression: three ComposeBox draft-persistence bugs.
 *
 * 1. DATA LOSS — navigating past a conversation faster than its draft loads
 *    DELETED that draft: the interval effect's cleanup unconditionally saved
 *    bodyRef ('' — the load hadn't resolved), and saveDraft with empty text
 *    and no files deletes the row.
 * 2. DATA LOSS — the late draft load overwrote text typed after the switch:
 *    the `cancelled` flag guards a conversation change, not user input, so
 *    setBody(draft.text) replaced what was typed and the next 1s tick
 *    persisted it.
 * 3. CHURN — the 1 Hz interval wrote to IndexedDB even with nothing to save
 *    (an empty composer issues a delete every second), and even a no-op Dexie
 *    delete re-fires every liveQuery observing draftAttachments — re-scanning
 *    and re-rendering the whole conversation list once per second while any
 *    thread is open.
 *
 * Fix: saves are gated on the draft having loaded, skipped when the state
 * matches what's already persisted, and the load result never clobbers input
 * the user produced while the read was in flight.
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
  testDb = new Dexie(`ComposeRace_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockSendBridgeMessage.mockReset().mockResolvedValue({ success: true });
  URL.createObjectURL = vi.fn(() => 'blob:test') as any;
  URL.revokeObjectURL = vi.fn() as any;
});

afterEach(async () => {
  vi.useRealTimers();
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

it('does not delete an unloaded draft when navigating past its conversation', async () => {
  await testDb.draftAttachments.put({
    conversationId: '2-b',
    text: 'half-written reply',
    files: [],
    names: [],
    types: [],
  });

  const { rerender } = render(<ComposeBox conversationId="2-a" messages={[]} participantNames={[]} />);
  await settle();

  // j, j — pass through 2-b faster than its draft can load.
  rerender(<ComposeBox conversationId="2-b" messages={[]} participantNames={[]} />);
  rerender(<ComposeBox conversationId="2-c" messages={[]} participantNames={[]} />);
  await settle();

  const row = await testDb.draftAttachments.get('2-b');
  expect(row?.text).toBe('half-written reply');
});

it('does not clobber text typed while the draft read is in flight', async () => {
  // Defer the draft load so we can type before it resolves.
  let resolveGet!: (v: any) => void;
  const origGet = testDb.draftAttachments.get.bind(testDb.draftAttachments);
  const getSpy = vi.spyOn(testDb.draftAttachments, 'get').mockImplementation(
    () => new Promise((r) => { resolveGet = r; })
  );

  render(<ComposeBox conversationId="2-d" messages={[]} participantNames={[]} />);
  const textarea = screen.getByPlaceholderText('Reply...') as HTMLTextAreaElement;
  await userEvent.type(textarea, 'fast typist');

  // The read finally resolves with an older stored draft.
  await act(async () => {
    resolveGet({ conversationId: '2-d', text: 'old stored draft', files: [], names: [], types: [] });
    await new Promise((r) => setTimeout(r, 0));
  });
  getSpy.mockImplementation(origGet);

  expect(textarea.value).toBe('fast typist');
});

it('an idle empty composer issues no draft writes on the save interval', async () => {
  // Fake ONLY intervals (before mount, so the save interval registers on the
  // fake clock); timeouts/microtasks stay real so the draft load resolves.
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });

  render(<ComposeBox conversationId="2-e" messages={[]} participantNames={[]} />);
  await settle();

  const delSpy = vi.spyOn(testDb.draftAttachments, 'delete');
  const putSpy = vi.spyOn(testDb.draftAttachments, 'put');

  await act(async () => {
    vi.advanceTimersByTime(3500);
  });
  await settle();

  expect(delSpy).not.toHaveBeenCalled();
  expect(putSpy).not.toHaveBeenCalled();
});
