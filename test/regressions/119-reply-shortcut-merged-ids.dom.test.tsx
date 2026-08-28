// @vitest-environment jsdom
/**
 * Regression: the `r` (reply) shortcut was the one markRead call site that
 * dropped mergedIds.
 *
 * Regression 71 established that every markRead must pass the display-merge's
 * mergedIds — the twin isn't in the list, so nothing else can ever clear its
 * unread flag. j/k navigation and the `u` toggle all pass conv.mergedIds; the
 * `r` handler passed only the id. Pressing `r` on a display-merged
 * conversation marked only the primary read, and the next useConversations
 * merge re-surfaced the twin's unread onto the row — unread again right after
 * you started replying.
 */
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

function press(key: string, mods: Partial<KeyboardEventInit> = {}) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods });
  document.body.dispatchEvent(ev);
  return ev;
}

it('`r` passes the selected conversation mergedIds to markRead', () => {
  const merged = makeConversation({ id: '2-merged-primary', read: 0 });
  (merged as any).mergedIds = ['2-merged-twin'];
  const conversations = [merged];

  useUIStore.setState({
    selectedIndex: 0,
    selectedConversationId: '2-merged-primary',
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

  const composeRef = createRef<HTMLTextAreaElement>();
  renderHook(() => useKeyboard(conversations as any, composeRef));

  press('r');

  expect(mockActions.markRead).toHaveBeenCalledWith('2-merged-primary', ['2-merged-twin']);
});
