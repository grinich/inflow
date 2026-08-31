// @vitest-environment jsdom
/**
 * Feature: right-clicking a message in the thread opens a context menu with
 * "Mark as unread" (read thread) / "Mark as read" (unread thread), firing the
 * same optimistic actions as the U shortcut. Marking unread this way must
 * survive ThreadView's 2s auto-read dwell timer — markUnread now dispatches
 * inflow:manual-unread itself, which also fixes the header-menu and command-
 * palette paths that previously got silently re-marked read.
 *
 * The conversation-row context menu gains the same Mark as read/unread item.
 */
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

vi.mock('@/hooks/useCachedImage', () => ({
  useCachedImage: (url?: string) => url,
  preloadImages: () => () => {},
}));

// Header and composer pull in unrelated machinery; the menu lives on the
// message list itself.
vi.mock('@/components/thread/ThreadHeader', () => ({ ThreadHeader: () => null }));
vi.mock('@/components/thread/ComposeBox', () => ({ ComposeBox: () => null }));

import { createRef } from 'react';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import { ThreadView } from '@/components/thread/ThreadView';
import { ConversationList } from '@/components/conversations/ConversationList';
import { useUIStore } from '@/store/ui-store';
import { makeConversation, makeMessage } from '../fixtures/factories';
import type { Conversation } from '@/types/conversation';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_msgmenu_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockClear();
  useUIStore.setState({
    inboxTab: 'focused',
    selectedConversationId: null,
  });
});

afterEach(async () => {
  vi.useRealTimers();
  if (testDb) {
    // Drain the fire-and-forget bridge confirmations before closing the db —
    // an action's .then() still updating pendingActions after close rejects
    // with an unhandled DatabaseClosedError under parallel suite load.
    await waitFor(async () => {
      const actions = await testDb.pendingActions.toArray();
      expect(actions.filter((a: any) => a.status === 'pending')).toEqual([]);
    });
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

function messageMenu() {
  return document.querySelector<HTMLElement>('[data-message-context-menu]');
}

function rowMenu() {
  return document.querySelector<HTMLElement>('[data-conversation-context-menu]');
}

async function renderThread(conv: Conversation, body = 'hello from the thread', waitText = body) {
  await testDb.conversations.put(conv);
  await testDb.messages.put(makeMessage({ conversationId: conv.id, body }));
  const utils = render(
    <ThreadView conversation={conv} composeRef={createRef<HTMLTextAreaElement>()} />
  );
  // Messages arrive via the live query — wait for the bubble to exist.
  // (waitText differs from body when Linkify splits it across nodes.)
  await screen.findByText(waitText);
  return utils;
}

describe('regression #175: message context menu marks read/unread', () => {
  it('right-clicking a message in a read thread offers Mark as unread, which sticks past the auto-read dwell', async () => {
    const conv = makeConversation({ read: 1 });
    const { container, rerender } = await renderThread(conv);

    const bubble = container.querySelector('[data-message-id]')!;
    fireEvent.contextMenu(bubble, { clientX: 120, clientY: 120 });
    expect(messageMenu()).toBeTruthy();

    fireEvent.click(within(messageMenu()!).getByText('Mark as unread'));
    expect(messageMenu()).toBeFalsy();

    await waitFor(async () => {
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.read).toBe(0);
    });
    await waitFor(() => {
      expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MARK_UNREAD', conversationId: conv.id });
    });

    // The live query flips the prop to read: 0 in the real app — without the
    // manual-unread suppression the auto-read effect would arm its 2s dwell
    // timer and undo the action.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    rerender(
      <ThreadView conversation={{ ...conv, read: 0 }} composeRef={createRef<HTMLTextAreaElement>()} />
    );
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 50));

    const markReadCalls = sendBridgeMessage.mock.calls.filter(
      ([msg]: any[]) => msg.type === 'MARK_READ'
    );
    expect(markReadCalls).toEqual([]);
    const stored = await testDb.conversations.get(conv.id);
    expect(stored.read).toBe(0);
  });

  it('right-clicking a message in an unread thread offers Mark as read', async () => {
    const conv = makeConversation({ read: 0 });
    const { container } = await renderThread(conv, 'unread thread message');

    const bubble = container.querySelector('[data-message-id]')!;
    fireEvent.contextMenu(bubble, { clientX: 80, clientY: 80 });
    expect(within(messageMenu()!).queryByText('Mark as unread')).toBeFalsy();

    fireEvent.click(within(messageMenu()!).getByText('Mark as read'));
    await waitFor(async () => {
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.read).toBe(1);
    });
    await waitFor(() => {
      expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MARK_READ', conversationId: conv.id });
    });
  });

  it('keeps the native menu on links inside a message', async () => {
    const conv = makeConversation({ read: 1 });
    await renderThread(conv, 'see https://example.com for details', 'https://example.com');

    const link = screen.getByText('https://example.com');
    expect(link.tagName).toBe('A');
    fireEvent.contextMenu(link, { clientX: 60, clientY: 60 });
    expect(messageMenu()).toBeFalsy();
  });

  it('closes on Escape and outside mousedown without firing an action', async () => {
    const conv = makeConversation({ read: 1 });
    const { container } = await renderThread(conv, 'dismissal target');

    const bubble = container.querySelector('[data-message-id]')!;
    fireEvent.contextMenu(bubble, { clientX: 100, clientY: 100 });
    expect(messageMenu()).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(messageMenu()).toBeFalsy();

    fireEvent.contextMenu(bubble, { clientX: 100, clientY: 100 });
    expect(messageMenu()).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(messageMenu()).toBeFalsy();

    const actionCalls = sendBridgeMessage.mock.calls.filter(
      ([msg]: any[]) => ['MARK_READ', 'MARK_UNREAD'].includes(msg.type)
    );
    expect(actionCalls).toEqual([]);
    const stored = await testDb.conversations.get(conv.id);
    expect(stored.read).toBe(1);
  });

  it('conversation row context menu toggles read state too', async () => {
    const conv = makeConversation({ read: 1 });
    await testDb.conversations.put(conv);
    const { container, unmount } = render(
      <ConversationList conversations={[conv]} category="PRIMARY_INBOX" />
    );
    const row = container.querySelector(`[data-conversation-id="${conv.id}"]`)!;
    fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    fireEvent.click(within(rowMenu()!).getByText('Mark as unread'));

    await waitFor(async () => {
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.read).toBe(0);
    });
    await waitFor(() => {
      expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'MARK_UNREAD', conversationId: conv.id });
    });
    unmount();

    // Unread rows offer Mark as read instead.
    const unreadConv = makeConversation({ read: 0 });
    await testDb.conversations.put(unreadConv);
    const utils = render(
      <ConversationList conversations={[unreadConv]} category="PRIMARY_INBOX" />
    );
    const unreadRow = utils.container.querySelector(`[data-conversation-id="${unreadConv.id}"]`)!;
    fireEvent.contextMenu(unreadRow, { clientX: 100, clientY: 100 });
    expect(within(rowMenu()!).queryByText('Mark as unread')).toBeFalsy();
    fireEvent.click(within(rowMenu()!).getByText('Mark as read'));

    await waitFor(async () => {
      const stored = await testDb.conversations.get(unreadConv.id);
      expect(stored.read).toBe(1);
    });
  });
});
