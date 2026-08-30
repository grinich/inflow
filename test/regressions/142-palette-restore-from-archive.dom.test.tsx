// @vitest-environment jsdom
// Bug: in the Archived tab the command palette offered no way to move a
// conversation back to Focused.
//
// The action was wired up — the palette's archive slot calls moveToFocused
// when inboxTab is 'archived', mirroring the 'e' shortcut — but the slot kept
// the label "Archive conversation". So in the Archive tab the palette listed
// an "Archive conversation" command that un-archives, and nothing that said
// "Move to Focused". cmdk filters on the item's label, so typing "focused"
// surfaced only "Go to Focused inbox" (navigation) and never the action.
//
// Every other surface already got this right: the 'e' shortcut, the thread
// header button ("Move to Focused" when in Archive), and the shortcuts overlay
// ("Archive / Move to Focused"). The palette was the sole holdout.
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
import { render, fireEvent, waitFor } from '@testing-library/react';
import { CommandPalette } from '@/components/command-palette/CommandPalette';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';
import type { Conversation } from '@/types/conversation';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_palette_archive_${Date.now()}_${Math.random()}`);
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
  if (testDb) {
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

async function renderPalette(conv: Conversation) {
  await testDb.conversations.put(conv);
  useUIStore.setState({ paletteOpen: true, selectedConversationId: conv.id });
  return render(
    <CommandPalette conversations={[conv]} composeRef={createRef<HTMLTextAreaElement>()} />
  );
}

/** An archived conversation that came from Focused — the common case. */
const archived = () => makeConversation({ category: 'PRIMARY_INBOX', archived: 1 });

describe('regression #142: restoring to Focused from the Archived tab', () => {
  it('offers "Move to Focused" rather than "Archive conversation"', async () => {
    const { getByText, queryByText } = await renderPalette(archived());

    expect(getByText('Move to Focused')).toBeTruthy();
    // "Archive conversation" in the Archive tab described the opposite of what
    // the command did.
    expect(queryByText('Archive conversation')).toBeFalsy();
  });

  it('is reachable by typing "focused"', async () => {
    // The actual reported symptom: searching the palette for the action found
    // only the navigation command.
    const { getByPlaceholderText, findAllByText } = await renderPalette(archived());

    fireEvent.change(getByPlaceholderText('Type a command...'), { target: { value: 'focused' } });

    const matches = await findAllByText(/Focused/);
    expect(matches.map((el) => el.textContent)).toContain('Move to Focused');
  });

  it('dispatches MOVE_TO_FOCUSED and un-archives', async () => {
    const conv = archived();
    const { getByText } = await renderPalette(conv);

    fireEvent.click(getByText('Move to Focused'));

    await waitFor(async () => {
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.category).toBe('PRIMARY_INBOX');
      expect(stored.archived).toBe(0);
    });
    await waitFor(() => {
      expect(sendBridgeMessage).toHaveBeenCalledWith({
        type: 'MOVE_TO_FOCUSED',
        conversationId: conv.id,
      });
    });
    // Let the fire-and-forget confirm write land before teardown closes the db.
    await waitFor(async () => {
      const actions = await testDb.pendingActions.toArray();
      expect(actions.filter((a: any) => a.status === 'pending')).toEqual([]);
    });
  });

  it('still says "Archive conversation" outside the Archived tab', async () => {
    useUIStore.setState({ inboxTab: 'focused' });
    const { getByText, queryByText } = await renderPalette(
      makeConversation({ category: 'PRIMARY_INBOX' })
    );

    expect(getByText('Archive conversation')).toBeTruthy();
    expect(queryByText('Move to Focused')).toBeFalsy();
  });
});
