// @vitest-environment jsdom
// Feature: swiping a conversation row acts on it — swipe right (trackpad
// wheel deltaX < 0 / touch drag right) stars, swipe left archives (or moves
// to Focused when viewing the Archive tab). The gesture only captures
// clearly-horizontal wheel input so vertical list scrolling is untouched,
// and releasing below the travel threshold fires nothing. The action only
// commits on a lift signal (decaying momentum deltas on trackpads, touchend
// on touch): pausing mid-swipe with fingers resting (wheel silence after a
// loud tail) holds the row, and if no lift signal ever arrives the swipe
// springs back WITHOUT acting — ambiguity must never commit.
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

import { render, fireEvent, waitFor } from '@testing-library/react';
import { ConversationList } from '@/components/conversations/ConversationList';
import { SWIPE_THRESHOLD } from '@/components/conversations/SwipeableRow';
import { useUIStore } from '@/store/ui-store';
import { makeConversation } from '../fixtures/factories';
import type { Conversation } from '@/types/conversation';
import type { InboxTab } from '@/store/ui-store';

beforeEach(async () => {
  testDb = new Dexie(`TestDB_swipe_${Date.now()}_${Math.random()}`);
  applySchema(testDb);
  await testDb.open();
  sendBridgeMessage.mockClear();
  useUIStore.setState({ inboxTab: 'focused', selectedConversationId: null });
});

afterEach(async () => {
  if (testDb) {
    // Let in-flight optimistic actions finish their confirm/rollback writes
    // before closing, or they reject with DatabaseClosedError after the test.
    await waitFor(async () => {
      const pending = await testDb.pendingActions.where('status').equals('pending').count();
      expect(pending).toBe(0);
    });
    testDb.close();
    await Dexie.delete(testDb.name);
  }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderRow(conv: Conversation, tab: InboxTab = 'focused', compact = false) {
  useUIStore.setState({ inboxTab: tab });
  await testDb.conversations.put(conv);
  const { container } = render(
    <ConversationList conversations={[conv]} category="PRIMARY_INBOX" compact={compact} />
  );
  return container.querySelector(`[data-conversation-id="${conv.id}"]`)! as HTMLElement;
}

/**
 * Emit wheel events adding up to `travel` px of swipe (positive = rightward).
 * Ends with a decaying momentum tail by default — the lift signal that lets
 * the gesture commit. Pass `lift: false` to simulate fingers stopping and
 * resting on the trackpad instead (loud tail, then silence).
 */
function wheelSwipe(el: HTMLElement, travel: number, { lift = true } = {}) {
  // Natural scrolling: rightward finger travel emits negative deltaX.
  const dir = Math.sign(travel);
  for (let sent = 0; sent < Math.abs(travel); sent += 40) {
    fireEvent.wheel(el, { deltaX: -dir * 40, deltaY: 0 });
  }
  if (lift) {
    for (const d of [12, 6, 3, 1]) fireEvent.wheel(el, { deltaX: -dir * d, deltaY: 0 });
  }
}

describe('regression #99: swipe actions on conversation rows', () => {
  it('swipe right past the threshold stars the conversation', async () => {
    const conv = makeConversation();
    const row = await renderRow(conv);

    wheelSwipe(row, SWIPE_THRESHOLD + 40);
    await waitFor(
      async () => expect((await testDb.conversations.get(conv.id)).starred).toBe(1),
      { timeout: 2000 }
    );
    await waitFor(() => {
      expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'STAR', conversationId: conv.id });
    });
  });

  it('swipe left past the threshold archives after the slide-out', async () => {
    const conv = makeConversation();
    const row = await renderRow(conv);

    wheelSwipe(row, -(SWIPE_THRESHOLD + 40));
    await waitFor(
      async () => {
        const stored = await testDb.conversations.get(conv.id);
        expect(stored.archived).toBe(1);
        expect(stored.category).toBe('ARCHIVE');
      },
      { timeout: 2000 }
    );
  });

  it('swipe left in the Archive tab moves back to Focused instead', async () => {
    const conv = makeConversation({ archived: 1, category: 'ARCHIVE' });
    const row = await renderRow(conv, 'archived');

    wheelSwipe(row, -(SWIPE_THRESHOLD + 40));
    await waitFor(
      async () => {
        const stored = await testDb.conversations.get(conv.id);
        expect(stored.archived).toBe(0);
        expect(stored.category).toBe('PRIMARY_INBOX');
      },
      { timeout: 2000 }
    );
  });

  it('releasing below the threshold springs back without firing', async () => {
    const conv = makeConversation();
    const row = await renderRow(conv);

    // One 40px step + the 22px lift tail = 62px, well below the 88px threshold
    wheelSwipe(row, 40);
    await sleep(600); // past END_DEBOUNCE + settle
    const stored = await testDb.conversations.get(conv.id);
    expect(stored.starred ?? 0).toBe(0);
    expect(stored.archived).toBe(0);
  });

  it('row translates while dragging and the correct pane is revealed', async () => {
    const conv = makeConversation();
    const row = await renderRow(conv);
    const swipeRoot = row.closest('[data-swipe-root]')! as HTMLElement;
    const content = row.parentElement! as HTMLElement;

    fireEvent.wheel(row, { deltaX: -60, deltaY: 0 });
    await waitFor(() => {
      expect(content.style.transform).toBe('translateX(60px)');
    });
    // Rightward drag reveals the star pane (first pane), hides the archive pane
    const panes = swipeRoot.querySelectorAll('[aria-hidden]');
    expect((panes[0] as HTMLElement).style.opacity).not.toBe('0');
    expect((panes[1] as HTMLElement).style.opacity).toBe('0');
    expect(panes[0].textContent).toContain('Star');
    expect(panes[1].textContent).toContain('Archive');
  });

  it('vertical wheel scrolling never starts a swipe', async () => {
    const conv = makeConversation();
    const row = await renderRow(conv);
    const content = row.parentElement! as HTMLElement;

    fireEvent.wheel(row, { deltaX: -3, deltaY: 40 });
    fireEvent.wheel(row, { deltaX: -3, deltaY: 40 });
    await sleep(250);
    expect(content.style.transform).toBe('');
    const stored = await testDb.conversations.get(conv.id);
    expect(stored.starred ?? 0).toBe(0);
    expect(stored.archived).toBe(0);
  });

  it('compact rail rows are not wrapped in swipe handling', async () => {
    const conv = makeConversation();
    const row = await renderRow(conv, 'focused', true);
    expect(row.closest('[data-swipe-root]')).toBeNull();
  });

  it('pausing mid-swipe with fingers resting does not commit; a momentum tail does', async () => {
    const conv = makeConversation();
    const row = await renderRow(conv);

    // Loud stop: full-magnitude deltas past the threshold, then silence —
    // fingers came to rest on the trackpad without lifting.
    wheelSwipe(row, -(SWIPE_THRESHOLD + 40), { lift: false });
    await sleep(250); // well past END_DEBOUNCE — the old behavior committed here
    expect((await testDb.conversations.get(conv.id)).archived).toBe(0);

    // Decaying deltas are the momentum tail that follows an actual lift.
    for (const d of [8, 5, 3, 1]) fireEvent.wheel(row, { deltaX: d, deltaY: 0 });
    await waitFor(
      async () => expect((await testDb.conversations.get(conv.id)).archived).toBe(1),
      { timeout: 2000 }
    );
  });

  it('a held swipe that never shows a lift signal springs back without acting', async () => {
    const conv = makeConversation();
    const row = await renderRow(conv);
    const content = row.parentElement! as HTMLElement;

    // Loud tail, then permanent silence — fingers rested and were lifted
    // invisibly (or never lifted). No lift signal means no action, ever.
    wheelSwipe(row, -(SWIPE_THRESHOLD + 40), { lift: false });
    await sleep(1900); // END_DEBOUNCE + HOLD_CANCEL_MS + settle-back
    const stored = await testDb.conversations.get(conv.id);
    expect(stored.archived).toBe(0);
    expect(stored.category).toBe('PRIMARY_INBOX');
    expect(content.style.transform).toBe(''); // sprang back and reset
  });

  it('touch drag right stars the conversation', async () => {
    const conv = makeConversation();
    const row = await renderRow(conv);

    fireEvent.touchStart(row, { touches: [{ clientX: 50, clientY: 100 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 80, clientY: 102 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 50 + SWIPE_THRESHOLD + 30, clientY: 104 }] });
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 50 + SWIPE_THRESHOLD + 30, clientY: 104 }] });

    await waitFor(
      async () => expect((await testDb.conversations.get(conv.id)).starred).toBe(1),
      { timeout: 2000 }
    );
  });
});
