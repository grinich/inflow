// @vitest-environment jsdom
// Feature: right-clicking a conversation row opens a context menu with
// Archive, Star, Move to Other, Mark as spam, and Delete. Archive/Star/Move
// fire the same optimistic actions as their keyboard shortcuts; Spam and
// Delete route through the confirm modals (spamConfirmId/deleteConfirmId).
// The menu closes on selection, Escape, and outside clicks, and its labels
// adapt to state (Remove star when starred, Move to Focused in Archive tab).
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

import { render, within, fireEvent, waitFor } from '@testing-library/react';
import { ConversationList } from '@/components/conversations/ConversationList';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';
import type { Conversation } from '@/types/conversation';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_ctxmenu_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockClear();
  useUIStore.setState({
    inboxTab: 'focused',
    spamConfirmId: null,
    deleteConfirmId: null,
    selectedConversationId: null,
  });
});

afterEach(async () => {
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function renderListWithMenu(conv: Conversation) {
  await testDb.conversations.put(conv);
  const utils = render(
    <ConversationList conversations={[conv]} category="PRIMARY_INBOX" />
  );
  const row = utils.container.querySelector(`[data-conversation-id="${conv.id}"]`)!;
  expect(row).toBeTruthy();
  fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
  return utils;
}

function menu() {
  return document.querySelector<HTMLElement>('[data-conversation-context-menu]');
}

describe('regression #98: conversation row context menu', () => {
  it('right-click opens the menu with all five actions', async () => {
    await renderListWithMenu(makeConversation());
    expect(menu()).toBeTruthy();
    for (const label of ['Archive', 'Star', 'Move to Other', 'Mark as spam', 'Delete']) {
      expect(within(menu()!).getByText(label)).toBeTruthy();
    }
  });

  it('Archive archives optimistically and closes the menu', async () => {
    const conv = makeConversation();
    await renderListWithMenu(conv);

    fireEvent.click(within(menu()!).getByText('Archive'));
    expect(menu()).toBeFalsy();

    await waitFor(async () => {
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.archived).toBe(1);
      expect(stored.category).toBe('ARCHIVE');
    });
    await waitFor(() => {
      expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'ARCHIVE', conversationId: conv.id });
    });
  });

  it('Star stars the conversation; starred rows offer Remove star instead', async () => {
    const conv = makeConversation();
    const { unmount } = await renderListWithMenu(conv);

    fireEvent.click(within(menu()!).getByText('Star'));
    await waitFor(async () => {
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.starred).toBe(1);
    });
    unmount();

    const starred = makeConversation({ starred: 1 });
    await testDb.conversations.put(starred);
    const utils = render(
      <ConversationList conversations={[starred]} category="PRIMARY_INBOX" />
    );
    const row = utils.container.querySelector(`[data-conversation-id="${starred.id}"]`)!;
    fireEvent.contextMenu(row, { clientX: 50, clientY: 50 });
    expect(within(menu()!).getByText('Remove star')).toBeTruthy();
    expect(within(menu()!).queryByText(/^Star$/)).toBeFalsy();
  });

  it('Move to Other moves the conversation to SECONDARY_INBOX', async () => {
    const conv = makeConversation();
    await renderListWithMenu(conv);

    fireEvent.click(within(menu()!).getByText('Move to Other'));
    await waitFor(async () => {
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.category).toBe('SECONDARY_INBOX');
    });
  });

  it('Mark as spam and Delete open their confirm modals instead of acting directly', async () => {
    const conv = makeConversation();
    await renderListWithMenu(conv);

    fireEvent.click(within(menu()!).getByText('Mark as spam'));
    expect(useUIStore.getState().spamConfirmId).toBe(conv.id);
    // No immediate category change — the modal confirms first
    const stored = await testDb.conversations.get(conv.id);
    expect(stored.category).toBe('PRIMARY_INBOX');

    const row = document.querySelector(`[data-conversation-id="${conv.id}"]`)!;
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    fireEvent.click(within(menu()!).getByText('Delete'));
    expect(useUIStore.getState().deleteConfirmId).toBe(conv.id);
    expect(await testDb.conversations.get(conv.id)).toBeTruthy();
  });

  it('shows Move to Focused instead of Archive when viewing the Archive tab', async () => {
    useUIStore.setState({ inboxTab: 'archived' });
    const conv = makeConversation({ archived: 1, category: 'ARCHIVE' });
    await renderListWithMenu(conv);

    expect(within(menu()!).getByText('Move to Focused')).toBeTruthy();
    expect(within(menu()!).queryByText(/^Archive$/)).toBeFalsy();

    fireEvent.click(within(menu()!).getByText('Move to Focused'));
    await waitFor(async () => {
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.archived).toBe(0);
      expect(stored.category).toBe('PRIMARY_INBOX');
    });
  });

  it('closes on Escape and on outside mousedown without firing an action', async () => {
    const conv = makeConversation();
    await renderListWithMenu(conv);
    expect(menu()).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(menu()).toBeFalsy();

    const row = document.querySelector(`[data-conversation-id="${conv.id}"]`)!;
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    expect(menu()).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeFalsy();

    const actionCalls = sendBridgeMessage.mock.calls.filter(
      ([msg]: any[]) => !['GET_SYNC_PROGRESS', 'GET_SSE_STATUS'].includes(msg.type)
    );
    expect(actionCalls).toEqual([]);
    const stored = await testDb.conversations.get(conv.id);
    expect(stored.archived).toBe(0);
    expect(stored.starred ?? 0).toBe(0);
  });
});
