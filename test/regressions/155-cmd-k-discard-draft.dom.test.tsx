// @vitest-environment jsdom
// Discarding a draft lives in the command palette, not on a key: Cmd+K always
// opens the palette (an earlier cut intercepted Cmd+K when a draft existed —
// rejected: Cmd+K must stay the palette), and a "Discard draft" command is
// offered only while the open thread's composer holds unsent text or
// attachments. Selecting it clears the draft everywhere it lives: the
// composer's in-memory state AND the stored draftAttachments row — deleting
// only the row would let the 1s periodic saver write the old text right back.
//
// (Numbered past 146–154, which the network-view branch's renumbered network
// tests occupy, so the merge doesn't need another renumber.)
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, screen, waitFor, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applySchema } from '@/db/database';

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
    moveToFocused: vi.fn(),
    moveToOther: vi.fn(),
    markRead: vi.fn(),
    markUnread: vi.fn(),
  }),
}));

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: mockSendBridgeMessage,
}));

vi.mock('@/lib/demo-mode', () => ({
  isDemoMode: () => false,
  enableDemoMode: vi.fn(),
  disableDemoMode: vi.fn(),
}));

vi.mock('@/lib/ai-settings', () => ({
  getAISuggestionsEnabled: vi.fn().mockResolvedValue(true),
  setAISuggestionsEnabled: vi.fn(),
}));

vi.mock('@/hooks/useAutocomplete', () => ({
  useAutocomplete: () => ({ suggestion: null, accept: vi.fn(), dismiss: vi.fn(), isOpen: false, isLoading: false }),
}));

vi.mock('@/hooks/useReplySuggestions', () => ({
  useReplySuggestions: () => ({ suggestions: [], isLoading: false, clear: vi.fn() }),
}));

// cmdk scrolls the selected item into view and observes list resizes; jsdom
// implements neither.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof (globalThis as any).ResizeObserver !== 'function') {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

import { useKeyboard } from '@/hooks/useKeyboard';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { ComposeBox } from '@/components/thread/ComposeBox';
import { useUIStore } from '@/store/ui-store';

let discardSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  testDb = new Dexie(`PaletteDiscard_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  mockSendBridgeMessage.mockReset().mockResolvedValue({ success: true });
  useUIStore.setState({
    selectedIndex: 0,
    selectedConversationId: '2-conv-a',
    paletteOpen: false,
    shortcutOverlayOpen: false,
    composeActive: false,
    composeNewActive: false,
    deleteConfirmId: null,
    spamConfirmId: null,
    aiSetupOpen: false,
    lightboxImageUrl: null,
    lightboxVideoUrl: null,
    toast: null,
  });
  discardSpy = vi.fn();
  document.addEventListener('inflow:discard-draft', discardSpy);
});

afterEach(async () => {
  document.removeEventListener('inflow:discard-draft', discardSpy);
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

/** A detached stand-in for the thread composer's textarea. */
function composerStandIn(value: string): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  ta.value = value;
  document.body.appendChild(ta);
  return ta;
}

describe('Cmd+K and the Discard draft command', () => {
  it('Cmd+K opens the palette even when the composer holds a draft', () => {
    const ta = composerStandIn('half-written reply');
    renderHook(() => useKeyboard([], { current: ta }));

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
    );

    expect(useUIStore.getState().paletteOpen).toBe(true);
    expect(discardSpy).not.toHaveBeenCalled();
    ta.remove();
  });

  it('Cmd+K → type "discar" → Enter discards the draft', async () => {
    const ta = composerStandIn('half-written reply');
    renderHook(() => useKeyboard([], { current: ta }));
    render(<CommandPalette conversations={[]} composeRef={{ current: ta }} />);

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
    );
    const input = await screen.findByPlaceholderText('Type a command...');

    await userEvent.type(input, 'discar');
    // The filter narrowed the list to the draft command.
    expect(screen.getByText('Discard draft')).toBeInTheDocument();
    expect(screen.queryByText('Archive conversation')).toBeNull();

    await userEvent.keyboard('{Enter}');

    expect(discardSpy).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().paletteOpen).toBe(false);
    expect(useUIStore.getState().toast?.message).toBe('Draft discarded');
    ta.remove();
  });

  it('offers no Discard draft command when the composer is empty', () => {
    const ta = composerStandIn('  \n ');
    useUIStore.setState({ paletteOpen: true });
    render(<CommandPalette conversations={[]} composeRef={{ current: ta }} />);

    expect(screen.queryByText('Discard draft')).toBeNull();
    expect(screen.getByText('Archive conversation')).toBeInTheDocument();
    ta.remove();
  });

  it('offers the command for an attachments-only draft', () => {
    const ta = composerStandIn('');
    ta.setAttribute('data-has-attachments', '');
    useUIStore.setState({ paletteOpen: true });
    render(<CommandPalette conversations={[]} composeRef={{ current: ta }} />);

    expect(screen.getByText('Discard draft')).toBeInTheDocument();
    ta.remove();
  });

  it('hides the command in the new-message composer', () => {
    const ta = composerStandIn('note to a new recipient');
    useUIStore.setState({ paletteOpen: true, composeNewActive: true });
    render(<CommandPalette conversations={[]} composeRef={{ current: ta }} />);

    expect(screen.queryByText('Discard draft')).toBeNull();
    ta.remove();
  });
});

describe('inflow:discard-draft clears the composer', () => {
  const composeTextarea = () =>
    document.querySelector('[data-compose-input]') as HTMLTextAreaElement;

  it('clears a restored draft: textarea, stored row, and the row badge event', async () => {
    await testDb.draftAttachments.put({
      conversationId: '2-conv-a',
      text: 'half-written reply',
      files: [],
      names: [],
      types: [],
    });
    const draftChangeSpy = vi.fn((e: Event) => (e as CustomEvent).detail);
    document.addEventListener('inflow:draft-change', draftChangeSpy);

    render(<ComposeBox conversationId="2-conv-a" />);
    await waitFor(() => expect(composeTextarea().value).toBe('half-written reply'));

    act(() => {
      document.dispatchEvent(new CustomEvent('inflow:discard-draft'));
    });

    expect(composeTextarea().value).toBe('');
    await waitFor(async () => {
      expect(await testDb.draftAttachments.get('2-conv-a')).toBeUndefined();
    });
    expect(draftChangeSpy.mock.results.map((r) => r.value)).toContain('2-conv-a');
    document.removeEventListener('inflow:draft-change', draftChangeSpy);
  });

  it('does not resurrect discarded text that was typed but never saved', async () => {
    render(<ComposeBox conversationId="2-conv-a" />);
    await waitFor(() => expect(composeTextarea()).toBeTruthy());

    // Type and discard within the same save interval: the text lives only in
    // the composer's state/refs, so a stale ref would re-save it on the next
    // 1s tick after the discard.
    await userEvent.type(composeTextarea(), 'doomed draft');
    act(() => {
      document.dispatchEvent(new CustomEvent('inflow:discard-draft'));
    });
    expect(composeTextarea().value).toBe('');

    // Outlive the periodic saver's next tick, then check nothing came back.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1300));
    });
    expect(composeTextarea().value).toBe('');
    expect(await testDb.draftAttachments.get('2-conv-a')).toBeUndefined();
  });
});
