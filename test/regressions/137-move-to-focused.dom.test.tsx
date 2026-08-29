// @vitest-environment jsdom
// Bug: a conversation in Other had no way back to Focused — the command
// palette, the thread-list context menu, the thread-header dropdown, and the
// 'o' shortcut all offered only "Move to Other", even when the conversation
// was already in the Other section.
//
// Fix: all four surfaces are category-aware. When the conversation's category
// is SECONDARY_INBOX the slot becomes "Move to Focused" (dispatching
// MOVE_TO_FOCUSED via the existing moveToFocused optimistic action); any other
// category keeps "Move to Other". Archive and Spam keep their dedicated
// routes back to Focused (the E/Archive slot and "Mark as Not Spam").
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

import { createRef } from 'react';
import { render, renderHook, within, fireEvent, waitFor } from '@testing-library/react';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { ConversationList } from '@/components/conversations/ConversationList';
import { ThreadHeader } from '@/components/thread/ThreadHeader';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';
import type { Conversation } from '@/types/conversation';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_movefocused_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockClear();
  useUIStore.setState({
    inboxTab: 'focused',
    paletteOpen: false,
    selectedConversationId: null,
    selectedIndex: 0,
  });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function expectMoved(convId: string, category: string, bridgeType: string) {
  await waitFor(async () => {
    const stored = await testDb.conversations.get(convId);
    expect(stored.category).toBe(category);
    expect(stored.archived).toBe(0);
  });
  await waitFor(() => {
    expect(sendBridgeMessage).toHaveBeenCalledWith({ type: bridgeType, conversationId: convId });
  });
  // Wait for the fire-and-forget confirm write too, so teardown never closes
  // the db under the action's .then() (unhandled DatabaseClosedError).
  await waitFor(async () => {
    const actions = await testDb.pendingActions.toArray();
    expect(actions.filter((a: any) => a.status === 'pending')).toEqual([]);
  });
}

describe('regression #137: moving an Other conversation back to Focused', () => {
  describe('command palette', () => {
    async function renderPalette(conv: Conversation) {
      await testDb.conversations.put(conv);
      useUIStore.setState({ paletteOpen: true, selectedConversationId: conv.id });
      return render(
        <CommandPalette conversations={[conv]} composeRef={createRef<HTMLTextAreaElement>()} />
      );
    }

    it('shows "Move to Focused" for an Other conversation and dispatches MOVE_TO_FOCUSED', async () => {
      const conv = makeConversation({ category: 'SECONDARY_INBOX' });
      const { getByText, queryByText } = await renderPalette(conv);

      expect(getByText('Move to Focused')).toBeTruthy();
      expect(queryByText('Move to Other')).toBeFalsy();

      fireEvent.click(getByText('Move to Focused'));
      await expectMoved(conv.id, 'PRIMARY_INBOX', 'MOVE_TO_FOCUSED');
    });

    it('shows "Move to Other" for a Focused conversation and dispatches MOVE_TO_OTHER', async () => {
      const conv = makeConversation({ category: 'PRIMARY_INBOX' });
      const { getByText, queryByText } = await renderPalette(conv);

      expect(getByText('Move to Other')).toBeTruthy();
      expect(queryByText('Move to Focused')).toBeFalsy();

      fireEvent.click(getByText('Move to Other'));
      await expectMoved(conv.id, 'SECONDARY_INBOX', 'MOVE_TO_OTHER');
    });

    it('keeps "Move to Other" for an archived conversation (Focused is the E/Archive slot)', async () => {
      useUIStore.setState({ inboxTab: 'archived' });
      const conv = makeConversation({ archived: 1, category: 'ARCHIVE' });
      const { getByText } = await renderPalette(conv);
      expect(getByText('Move to Other')).toBeTruthy();
    });
  });

  describe('thread-header dropdown', () => {
    function openDropdown(container: HTMLElement) {
      const chevron = Array.from(container.querySelectorAll('button')).find((b) =>
        b.querySelector('polyline[points="6 9 12 15 18 9"]')
      )!;
      expect(chevron).toBeTruthy();
      fireEvent.click(chevron);
    }

    it('shows "Move to Focused" for an Other conversation and moves it', async () => {
      useUIStore.setState({ inboxTab: 'other' });
      const conv = makeConversation({ category: 'SECONDARY_INBOX' });
      await testDb.conversations.put(conv);
      const { container, getByText, queryByText } = render(<ThreadHeader conversation={conv} />);

      openDropdown(container);
      expect(getByText('Move to Focused')).toBeTruthy();
      expect(queryByText('Move to Other')).toBeFalsy();

      fireEvent.click(getByText('Move to Focused'));
      await expectMoved(conv.id, 'PRIMARY_INBOX', 'MOVE_TO_FOCUSED');
    });

    it('shows "Move to Other" for a Focused conversation', async () => {
      const conv = makeConversation({ category: 'PRIMARY_INBOX' });
      await testDb.conversations.put(conv);
      const { container, getByText, queryByText } = render(<ThreadHeader conversation={conv} />);

      openDropdown(container);
      expect(getByText('Move to Other')).toBeTruthy();
      expect(queryByText('Move to Focused')).toBeFalsy();

      fireEvent.click(getByText('Move to Other'));
      await expectMoved(conv.id, 'SECONDARY_INBOX', 'MOVE_TO_OTHER');
    });
  });

  describe('thread-list context menu', () => {
    it('shows "Move to Focused" for an Other conversation and moves it', async () => {
      useUIStore.setState({ inboxTab: 'other' });
      const conv = makeConversation({ category: 'SECONDARY_INBOX' });
      await testDb.conversations.put(conv);
      const { container } = render(
        <ConversationList conversations={[conv]} category="SECONDARY_INBOX" />
      );
      const row = container.querySelector(`[data-conversation-id="${conv.id}"]`)!;
      fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });

      const menu = document.querySelector<HTMLElement>('[data-conversation-context-menu]')!;
      expect(within(menu).getByText('Move to Focused')).toBeTruthy();
      expect(within(menu).queryByText('Move to Other')).toBeFalsy();

      fireEvent.click(within(menu).getByText('Move to Focused'));
      await expectMoved(conv.id, 'PRIMARY_INBOX', 'MOVE_TO_FOCUSED');
    });
  });

  describe("keyboard 'o' shortcut", () => {
    it('moves an Other conversation back to Focused', async () => {
      const conv = makeConversation({ category: 'SECONDARY_INBOX' });
      await testDb.conversations.put(conv);
      useUIStore.setState({ inboxTab: 'other', selectedConversationId: conv.id });
      renderHook(() => useKeyboard([conv], createRef<HTMLTextAreaElement>()));

      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'o', bubbles: true, cancelable: true })
      );
      await expectMoved(conv.id, 'PRIMARY_INBOX', 'MOVE_TO_FOCUSED');
    });

    it('still moves a Focused conversation to Other', async () => {
      const conv = makeConversation({ category: 'PRIMARY_INBOX' });
      await testDb.conversations.put(conv);
      useUIStore.setState({ selectedConversationId: conv.id });
      renderHook(() => useKeyboard([conv], createRef<HTMLTextAreaElement>()));

      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'o', bubbles: true, cancelable: true })
      );
      await expectMoved(conv.id, 'SECONDARY_INBOX', 'MOVE_TO_OTHER');
    });
  });
});
