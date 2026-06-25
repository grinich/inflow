// @vitest-environment jsdom
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

describe('useKeyboard "!" mark-as-spam shortcut (layout independence)', () => {
  const conversations = [makeConversation({ id: '2-conv-spam-1' }), makeConversation({ id: '2-conv-spam-2' })];

  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({
      selectedIndex: 0,
      selectedConversationId: '2-conv-spam-1',
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
  });

  function renderKeyboard() {
    return renderHook(() => useKeyboard(conversations, createRef<HTMLTextAreaElement>()));
  }

  it('AZERTY: bare "!" (no Shift) opens the spam confirmation', () => {
    renderKeyboard();
    const ev = pressOn(window, '!');
    expect(useUIStore.getState().spamConfirmId).toBe('2-conv-spam-1');
    expect(ev.defaultPrevented).toBe(true);
  });

  it('QWERTY: Shift+"!" still opens the spam confirmation', () => {
    renderKeyboard();
    pressOn(window, '!', { shiftKey: true });
    expect(useUIStore.getState().spamConfirmId).toBe('2-conv-spam-1');
  });

  it('Cmd+! / Ctrl+! are not hijacked', () => {
    renderKeyboard();
    const cmd = pressOn(window, '!', { metaKey: true });
    const ctrl = pressOn(window, '!', { ctrlKey: true });
    expect(useUIStore.getState().spamConfirmId).toBeNull();
    expect(cmd.defaultPrevented).toBe(false);
    expect(ctrl.defaultPrevented).toBe(false);
  });
});
