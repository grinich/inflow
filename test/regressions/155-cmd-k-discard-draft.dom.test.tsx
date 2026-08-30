// @vitest-environment jsdom
// Cmd+K discards the unsent draft on the open thread: with text or attachments
// in the thread composer it clears the draft (in-memory state AND the stored
// draftAttachments row — deleting only the row would let the 1s periodic saver
// write the old text right back); with no draft it keeps its long-standing
// binding, the command palette. It must still close an open palette, and the
// new-message composer keeps the palette binding (its draft lifecycle is its
// own).
//
// (Numbered past 146–154, which the network-view branch's renumbered network
// tests occupy, so the merge doesn't need another renumber.)
import '../dom-setup';

import Dexie from 'dexie';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderHook } from '@testing-library/react';
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

import { useKeyboard } from '@/hooks/useKeyboard';
import { ComposeBox } from '@/components/thread/ComposeBox';
import { useUIStore } from '@/store/ui-store';

beforeEach(async () => {
  testDb = new Dexie(`CmdKDiscard_${Date.now()}_${Math.random()}`);
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
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

function pressCmdK() {
  const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true });
  document.body.dispatchEvent(ev);
  return ev;
}

describe('Cmd+K routing in useKeyboard', () => {
  let discardSpy: ReturnType<typeof vi.fn>;
  let ta: HTMLTextAreaElement;

  beforeEach(() => {
    discardSpy = vi.fn();
    document.addEventListener('inflow:discard-draft', discardSpy);
    ta = document.createElement('textarea');
    document.body.appendChild(ta);
  });

  afterEach(() => {
    document.removeEventListener('inflow:discard-draft', discardSpy);
    ta.remove();
  });

  function mountKeyboard(current: HTMLTextAreaElement | null = null) {
    return renderHook(() => useKeyboard([], { current }));
  }

  it('discards instead of opening the palette when the composer holds text', () => {
    ta.value = 'half-written reply';
    mountKeyboard(ta);

    pressCmdK();

    expect(discardSpy).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().paletteOpen).toBe(false);
    expect(useUIStore.getState().toast?.message).toBe('Draft discarded');
  });

  it('opens the palette when the composer is empty', () => {
    ta.value = '';
    mountKeyboard(ta);

    pressCmdK();

    expect(discardSpy).not.toHaveBeenCalled();
    expect(useUIStore.getState().paletteOpen).toBe(true);
  });

  it('treats whitespace-only text as no draft', () => {
    ta.value = '   \n ';
    mountKeyboard(ta);

    pressCmdK();

    expect(discardSpy).not.toHaveBeenCalled();
    expect(useUIStore.getState().paletteOpen).toBe(true);
  });

  it('discards an attachments-only draft via the data attribute', () => {
    ta.value = '';
    ta.setAttribute('data-has-attachments', '');
    mountKeyboard(ta);

    pressCmdK();

    expect(discardSpy).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().paletteOpen).toBe(false);
  });

  it('still closes an open palette even with a draft present', () => {
    ta.value = 'half-written reply';
    useUIStore.setState({ paletteOpen: true });
    mountKeyboard(ta);

    pressCmdK();

    expect(discardSpy).not.toHaveBeenCalled();
    expect(useUIStore.getState().paletteOpen).toBe(false);
  });

  it('keeps the palette binding in the new-message composer', () => {
    ta.value = 'note to a new recipient';
    useUIStore.setState({ composeNewActive: true });
    mountKeyboard(ta);

    pressCmdK();

    expect(discardSpy).not.toHaveBeenCalled();
    expect(useUIStore.getState().paletteOpen).toBe(true);
  });

  it('opens the palette when no composer is mounted', () => {
    mountKeyboard(null);

    pressCmdK();

    expect(discardSpy).not.toHaveBeenCalled();
    expect(useUIStore.getState().paletteOpen).toBe(true);
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
