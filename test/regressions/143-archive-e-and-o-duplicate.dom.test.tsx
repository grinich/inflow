// @vitest-environment jsdom
// Bug: in the Archived tab, `E` and `O` did the same thing.
//
// #137 made the O slot category-aware: a conversation whose category is
// SECONDARY_INBOX offers "Move to Focused" instead of "Move to Other". But a
// conversation ARCHIVED out of Other keeps that category while sitting in
// Archive, where the E slot already restores to Focused. So for those, every
// surface rendered two identical "Move to Focused" entries and O did nothing
// E didn't.
//
// The toggle only makes sense for a conversation actually sitting in Other. In
// Archive the O slot restores to Other, leaving E and O as the two
// complementary ways back out. `otherSlotTarget` owns the rule so the palette,
// the context menu, the thread header and the `o` shortcut cannot drift.
import '../dom-setup';
import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let testDb: any;
vi.mock('@/db/database', async (importOriginal) => ({
  ...((await importOriginal()) as any),
  get db() {
    return testDb;
  },
}));

const sendBridgeMessage = vi.fn(async () => ({ success: true }));
vi.mock('@/lib/bridge', () => ({
  sendBridgeMessage: (...args: any[]) => sendBridgeMessage(...args),
}));
vi.mock('@/lib/debug-log', () => ({ debugLog: vi.fn() }));

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

import { createRef } from 'react';
import { render, renderHook, fireEvent, waitFor } from '@testing-library/react';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { ConversationContextMenu } from '@/components/conversations/ConversationContextMenu';
import { ThreadHeader } from '@/components/thread/ThreadHeader';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useUIStore } from '@/store/ui-store';
import { otherSlotTarget } from '@/lib/conversation-move';
import { makeConversation } from '../fixtures/factories';
import type { Conversation } from '@/types/conversation';

/** Archived out of Other: the case where E and O collided. */
const archivedFromOther = () =>
  makeConversation({ category: 'SECONDARY_INBOX', archived: 1 });

beforeEach(async () => {
  testDb = new Dexie(`TestDB_archive_eo_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockClear();
  useUIStore.setState({
    inboxTab: 'archived',
    paletteOpen: false,
    selectedConversationId: null,
    selectedIndex: 0,
  });
});

afterEach(async () => {
  testDb.close();
  await Dexie.delete(testDb.name);
});

describe('regression #143: E and O are distinct in the Archived tab', () => {
  describe('the rule itself', () => {
    it('sends the O slot to Other from Archive, whatever the category', () => {
      expect(otherSlotTarget({ category: 'SECONDARY_INBOX' }, 'archived')).toBe('other');
      expect(otherSlotTarget({ category: 'PRIMARY_INBOX' }, 'archived')).toBe('other');
    });

    it('keeps the Focused/Other toggle everywhere else', () => {
      expect(otherSlotTarget({ category: 'SECONDARY_INBOX' }, 'other')).toBe('focused');
      expect(otherSlotTarget({ category: 'PRIMARY_INBOX' }, 'focused')).toBe('other');
    });
  });

  describe('command palette', () => {
    async function renderPalette(conv: Conversation) {
      await testDb.conversations.put(conv);
      useUIStore.setState({ paletteOpen: true, selectedConversationId: conv.id });
      return render(
        <CommandPalette conversations={[conv]} composeRef={createRef<HTMLTextAreaElement>()} />
      );
    }

    it('lists "Move to Focused" once, not twice', async () => {
      const { queryAllByText, getByText } = await renderPalette(archivedFromOther());

      expect(queryAllByText('Move to Focused')).toHaveLength(1);
      expect(getByText('Move to Other')).toBeTruthy();
    });

    it('actually moves to Other when O is chosen', async () => {
      const conv = archivedFromOther();
      const { getByText } = await renderPalette(conv);

      fireEvent.click(getByText('Move to Other'));

      await waitFor(async () => {
        const stored = await testDb.conversations.get(conv.id);
        expect(stored.category).toBe('SECONDARY_INBOX');
        expect(stored.archived).toBe(0);
      });
      await waitFor(async () => {
        const actions = await testDb.pendingActions.toArray();
        expect(actions.filter((a: any) => a.status === 'pending')).toEqual([]);
      });
    });
  });

  describe('thread-list context menu', () => {
    it('lists "Move to Focused" once, not twice', async () => {
      const conv = archivedFromOther();
      await testDb.conversations.put(conv);
      const { queryAllByText, getByText } = render(
        <ConversationContextMenu
          conversation={conv}
          x={0}
          y={0}
          onClose={() => {}}
        />
      );

      expect(queryAllByText('Move to Focused')).toHaveLength(1);
      expect(getByText('Move to Other')).toBeTruthy();
    });
  });

  describe('thread header', () => {
    it('lists "Move to Focused" once, not twice', async () => {
      const conv = archivedFromOther();
      await testDb.conversations.put(conv);
      const { queryAllByText, getByText, container } = render(<ThreadHeader conversation={conv} />);

      // Open the dropdown next to the E button.
      const toggle = container.querySelectorAll('button');
      fireEvent.click(toggle[toggle.length - 1]);

      expect(queryAllByText('Move to Focused')).toHaveLength(1);
      expect(getByText('Move to Other')).toBeTruthy();
    });
  });

  describe('o shortcut', () => {
    it('moves to Other rather than repeating what E does', async () => {
      const conv = archivedFromOther();
      await testDb.conversations.put(conv);
      useUIStore.setState({ selectedConversationId: conv.id });

      renderHook(() => useKeyboard([conv], createRef<HTMLTextAreaElement>()));
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'o', bubbles: true, cancelable: true })
      );

      await waitFor(() => {
        expect(sendBridgeMessage).toHaveBeenCalledWith({
          type: 'MOVE_TO_OTHER',
          conversationId: conv.id,
        });
      });
      await waitFor(async () => {
        const actions = await testDb.pendingActions.toArray();
        expect(actions.filter((a: any) => a.status === 'pending')).toEqual([]);
      });
    });
  });
});
