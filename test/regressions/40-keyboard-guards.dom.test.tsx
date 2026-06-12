// @vitest-environment jsdom
// Regression: global keyboard shortcuts must not fire from the wrong context.
//
// Bug 1: the Enter / Cmd+Enter send dispatch matched ANY textarea (or any input
// for Cmd+Enter), so pressing Enter while editing a message in MessageBubble's
// inline edit box sent the unrelated compose draft — and Cmd+Enter saved the
// edit AND sent the draft AND archived the conversation.
//
// Bug 2: single-letter action shortcuts (o/e/u/j///1-4/r) lacked
// !metaKey/!ctrlKey guards, so browser combos like Cmd+E (archive!), Ctrl+U
// (mark unread), Cmd+O (move to Other) silently mutated conversations.
import '../dom-setup';

import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';

const mockActions = {
  archiveConversation: vi.fn(),
  moveToOther: vi.fn(),
  moveToFocused: vi.fn(),
  markRead: vi.fn(),
  markUnread: vi.fn(),
  starConversation: vi.fn(),
};

vi.mock('@/hooks/useOptimisticAction', () => ({
  useOptimisticAction: () => mockActions,
}));

vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/db/database', () => ({
  db: { profiles: { get: vi.fn().mockResolvedValue(undefined) } },
}));

function pressOn(el: HTMLElement | Window, key: string, mods: Partial<KeyboardEventInit> = {}) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
  (el instanceof Window ? el.document.body : el).dispatchEvent(ev);
  return ev;
}

describe('useKeyboard context and modifier guards', () => {
  const conversations = [makeConversation({ id: '2-conv-kb-1' }), makeConversation({ id: '2-conv-kb-2' })];
  let sendSpy: ReturnType<typeof vi.fn>;
  let sendArchiveSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({
      selectedIndex: 0,
      selectedConversationId: '2-conv-kb-1',
      inboxTab: 'focused',
      paletteOpen: false,
      shortcutOverlayOpen: false,
      searchQuery: '',
      deleteConfirmId: null,
      spamConfirmId: null,
      aiSetupOpen: false,
      lightboxImageUrl: null,
      composeActive: false,
      composeNewActive: false,
    });
    sendSpy = vi.fn();
    sendArchiveSpy = vi.fn();
    document.addEventListener('inflow:send', sendSpy);
    document.addEventListener('inflow:send-and-archive', sendArchiveSpy);
  });

  afterEach(() => {
    document.removeEventListener('inflow:send', sendSpy);
    document.removeEventListener('inflow:send-and-archive', sendArchiveSpy);
  });

  function renderKeyboard() {
    return renderHook(() => useKeyboard(conversations, createRef<HTMLTextAreaElement>()));
  }

  it('Enter in the compose textarea dispatches inflow:send', () => {
    renderKeyboard();
    const ta = document.createElement('textarea');
    ta.setAttribute('data-compose-input', '');
    document.body.appendChild(ta);
    pressOn(ta, 'Enter');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    ta.remove();
  });

  it('Enter in a non-compose textarea (message edit box) does NOT dispatch inflow:send', () => {
    renderKeyboard();
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    const ev = pressOn(ta, 'Enter');
    expect(sendSpy).not.toHaveBeenCalled();
    // Must not preventDefault either — Enter should insert a newline in the edit box
    expect(ev.defaultPrevented).toBe(false);
    ta.remove();
  });

  it('Cmd+Enter in a non-compose textarea does NOT dispatch inflow:send-and-archive', () => {
    renderKeyboard();
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    pressOn(ta, 'Enter', { metaKey: true });
    expect(sendArchiveSpy).not.toHaveBeenCalled();
    ta.remove();
  });

  it('Cmd+Enter in the compose textarea dispatches inflow:send-and-archive', () => {
    renderKeyboard();
    const ta = document.createElement('textarea');
    ta.setAttribute('data-compose-input', '');
    document.body.appendChild(ta);
    pressOn(ta, 'Enter', { metaKey: true });
    expect(sendArchiveSpy).toHaveBeenCalledTimes(1);
    ta.remove();
  });

  it('bare e archives, but Cmd+E / Ctrl+E do not', () => {
    renderKeyboard();
    pressOn(window, 'e');
    expect(mockActions.archiveConversation).toHaveBeenCalledTimes(1);
    mockActions.archiveConversation.mockClear();

    const cmdE = pressOn(window, 'e', { metaKey: true });
    const ctrlE = pressOn(window, 'e', { ctrlKey: true });
    expect(mockActions.archiveConversation).not.toHaveBeenCalled();
    expect(cmdE.defaultPrevented).toBe(false);
    expect(ctrlE.defaultPrevented).toBe(false);
  });

  it('bare o moves to Other, but Cmd+O does not', () => {
    renderKeyboard();
    pressOn(window, 'o');
    expect(mockActions.moveToOther).toHaveBeenCalledTimes(1);
    mockActions.moveToOther.mockClear();

    const ev = pressOn(window, 'o', { metaKey: true });
    expect(mockActions.moveToOther).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('bare u toggles read state, but Ctrl+U does not', () => {
    renderKeyboard();
    pressOn(window, 'u');
    expect(mockActions.markUnread.mock.calls.length + mockActions.markRead.mock.calls.length).toBe(1);
    mockActions.markUnread.mockClear();
    mockActions.markRead.mockClear();

    const ev = pressOn(window, 'u', { ctrlKey: true });
    expect(mockActions.markUnread).not.toHaveBeenCalled();
    expect(mockActions.markRead).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it('Cmd+J / Cmd+1 / Cmd+/ / Cmd+R are not hijacked', () => {
    renderKeyboard();
    const j = pressOn(window, 'j', { metaKey: true });
    const one = pressOn(window, '1', { metaKey: true });
    const slash = pressOn(window, '/', { metaKey: true });
    const r = pressOn(window, 'r', { metaKey: true });
    expect(j.defaultPrevented).toBe(false);
    expect(one.defaultPrevented).toBe(false);
    expect(slash.defaultPrevented).toBe(false);
    expect(r.defaultPrevented).toBe(false);
    expect(useUIStore.getState().inboxTab).toBe('focused');
  });
});
