// @vitest-environment jsdom
// Feature: swiping a conversation row acts on it — swipe right (trackpad
// wheel deltaX < 0 / touch drag right) stars, swipe left archives (or moves
// to Focused when viewing the Archive tab).
//
// Gesture detection is delegated to wheel-gestures. The one release signal
// this code trusts is inertia — `WheelEvent.momentum` (Chrome 151+), or the
// library's deceleration analysis below that — because it is the only thing
// that proves the fingers actually left the trackpad. On that release,
// travel past the threshold commits, and so does a shorter drag still moving
// at flick speed.
//
// A stream that merely falls silent is NOT a release: wheel events stop the
// instant the fingers stop moving, lifted or not, so acting there would
// archive rows out from under fingers still resting on the pad. Such a
// gesture parks the row where it stopped and waits — nothing fires, and
// moving again carries on from that offset. Past the threshold the parked row
// rests open with its action revealed as a button, indefinitely. Short of it
// the row waits a beat and then bounces closed: a gentle lift produces no
// inertia and, on macOS, no events at all, so nothing would ever arrive to
// close it. A timer may put a row away because closing acts on nothing; only
// a proven lift may fire an action.
//
// A committed archive never reverts to a normal row on its way out: the
// content slides off, and the filled band collapses vertically, as on iOS.
//
// Timestamps matter: wheel-gestures derives velocity and its end-of-gesture
// timeout from `event.timeStamp`, so these tests dispatch events with
// explicit, realistic spacing rather than firing a synchronous burst.
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
import { SWIPE_THRESHOLD, _resetSwipeGestures } from '@/components/conversations/SwipeableRow';
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
  // Drop any gesture the previous case left in flight, so the first event
  // here is a genuine gesture start.
  _resetSwipeGestures();
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

/**
 * Dispatch one wheel event with a controlled timeStamp (jsdom stamps events
 * from the real clock, which makes a synchronous burst look infinitely fast)
 * and an optional native `momentum` flag. Returns false when the event was
 * preventDefault'ed, like fireEvent does.
 */
function wheel(
  el: HTMLElement,
  { deltaX = 0, deltaY = 0, at, momentum }: { deltaX?: number; deltaY?: number; at: number; momentum?: boolean }
) {
  const ev = new WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'timeStamp', { value: at });
  if (momentum !== undefined) Object.defineProperty(ev, 'momentum', { value: momentum });
  return el.dispatchEvent(ev);
}

/**
 * A trackpad drag: `count` events of `px` travel each, `every` ms apart.
 * Natural scrolling means rightward finger travel emits negative deltaX, so
 * positive `px` here is rightward movement of the row.
 */
function drag(
  el: HTMLElement,
  { px, count, every = 8, from = 1000 }: { px: number; count: number; every?: number; from?: number }
) {
  for (let i = 0; i < count; i++) {
    wheel(el, { deltaX: -px, at: from + i * every, momentum: false });
  }
  return from + (count - 1) * every;
}

/** The native inertia event that follows a real finger lift. */
function lift(el: HTMLElement, { px, at }: { px: number; at: number }) {
  wheel(el, { deltaX: -px, at: at + 8, momentum: true });
}

async function renderRows(convs: Conversation[], tab: InboxTab = 'focused', compact = false) {
  useUIStore.setState({ inboxTab: tab });
  await testDb.conversations.bulkPut(convs);
  const { container } = render(
    <ConversationList conversations={convs} category="PRIMARY_INBOX" compact={compact} />
  );
  return convs.map(
    (c) => container.querySelector(`[data-conversation-id="${c.id}"]`)! as HTMLElement
  );
}

async function renderRow(conv: Conversation, tab: InboxTab = 'focused', compact = false) {
  const [row] = await renderRows([conv], tab, compact);
  return row;
}

describe('regression #99: swipe actions on conversation rows', () => {
  describe('committing on a native finger lift (Chrome 151+)', () => {
    it('a swipe right past the threshold stars the conversation', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      lift(row, { px: 20, at: drag(row, { px: 40, count: 3 }) }); // 120px
      await waitFor(
        async () => expect((await testDb.conversations.get(conv.id)).starred).toBe(1),
        { timeout: 2000 }
      );
      await waitFor(() => {
        expect(sendBridgeMessage).toHaveBeenCalledWith({ type: 'STAR', conversationId: conv.id });
      });
    });

    it('a swipe left past the threshold archives after the slide-out', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      lift(row, { px: -20, at: drag(row, { px: -40, count: 3 }) });
      await waitFor(
        async () => {
          const stored = await testDb.conversations.get(conv.id);
          expect(stored.archived).toBe(1);
          expect(stored.category).toBe('ARCHIVE');
        },
        { timeout: 2000 }
      );
    });

    it('the archived row collapses away without flashing back to normal', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const swipeRoot = row.closest('[data-swipe-root]')! as HTMLElement;
      const content = row.parentElement! as HTMLElement;

      lift(row, { px: -20, at: drag(row, { px: -40, count: 3 }) });

      // Once the content has slid off, the row is a full band of the action
      // colour and must stay that way: restoring the normal row before the
      // list drops it reads as a flash. It collapses vertically instead.
      await waitFor(() => expect(swipeRoot.style.height).toBe('0px'));
      expect(content.style.transform).not.toBe(''); // content still off-screen
      const archivePane = swipeRoot.querySelectorAll('[aria-hidden]')[1] as HTMLElement;
      expect(archivePane.style.opacity).toBe('1'); // still green

      await waitFor(
        async () => expect((await testDb.conversations.get(conv.id)).archived).toBe(1),
        { timeout: 2000 }
      );
    });

    it('a swipe left in the Archive tab moves back to Focused instead', async () => {
      const conv = makeConversation({ archived: 1, category: 'ARCHIVE' });
      const row = await renderRow(conv, 'archived');

      lift(row, { px: -20, at: drag(row, { px: -40, count: 3 }) });
      await waitFor(
        async () => {
          const stored = await testDb.conversations.get(conv.id);
          expect(stored.archived).toBe(0);
          expect(stored.category).toBe('PRIMARY_INBOX');
        },
        { timeout: 2000 }
      );
    });

    it('a short fast flick commits from short of the threshold', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      // 48px of travel — well under the 88px gate — at 1.5px/ms. On a phone
      // this flick acts; requiring the full distance is what made the old
      // build feel like it was ignoring you.
      lift(row, { px: 12, at: drag(row, { px: 12, count: 4 }) });
      await waitFor(
        async () => expect((await testDb.conversations.get(conv.id)).starred).toBe(1),
        { timeout: 2000 }
      );
    });

    it('a committing flick pops the armed icon it never reached by distance', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const swipeRoot = row.closest('[data-swipe-root]')! as HTMLElement;
      const starIcon = swipeRoot.querySelectorAll('[aria-hidden]')[0].firstElementChild as HTMLElement;

      // Paint only pops the icon past 88px, so a 48px flick would otherwise
      // act on a row that still looks unarmed.
      lift(row, { px: 12, at: drag(row, { px: 12, count: 4 }) });
      expect(starIcon.style.transform).toBe('scale(1.12)');
    });

    it('a slow drag short of the threshold acts on nothing', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      // 32px at 0.32px/ms: neither far enough nor fast enough.
      lift(row, { px: 8, at: drag(row, { px: 8, count: 4, every: 25 }) });
      await sleep(600);
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.starred ?? 0).toBe(0);
      expect(stored.archived).toBe(0);
    });
  });

  describe('a stream that only stops is never a release', () => {
    // The wheel stream falls silent the instant the fingers stop moving —
    // whether they lifted or are still resting on the pad. Nothing here may
    // fire an action, because the fingers may well still be down.

    it('a drag past the threshold that stops does not archive, however long it waits', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      // 112px dragged by hand at 0.4px/ms, then the fingers stop dead. No
      // inertia ever follows. This must never archive.
      drag(row, { px: -8, count: 14, every: 20 });
      await sleep(2000);
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.archived).toBe(0);
      expect(stored.category).toBe('PRIMARY_INBOX');
    });

    it('it rests open at the threshold with the action revealed instead', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const swipeRoot = row.closest('[data-swipe-root]')! as HTMLElement;
      const content = row.parentElement! as HTMLElement;

      drag(row, { px: -8, count: 14, every: 20 });
      await waitFor(() => {
        expect(content.style.transform).toBe(`translateX(-${SWIPE_THRESHOLD}px)`);
      });
      const archivePane = swipeRoot.querySelectorAll('[aria-hidden]')[1] as HTMLElement;
      expect(archivePane.style.opacity).toBe('1');
      expect(archivePane.style.pointerEvents).toBe('auto'); // clickable now
    });

    it('clicking the revealed action on an open row archives', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const swipeRoot = row.closest('[data-swipe-root]')! as HTMLElement;

      drag(row, { px: -8, count: 14, every: 20 });
      const archivePane = swipeRoot.querySelectorAll('[aria-hidden]')[1] as HTMLElement;
      await waitFor(() => expect(archivePane.style.pointerEvents).toBe('auto'));

      fireEvent.click(archivePane);
      await waitFor(
        async () => {
          const stored = await testDb.conversations.get(conv.id);
          expect(stored.archived).toBe(1);
          expect(stored.category).toBe('ARCHIVE');
        },
        { timeout: 2000 }
      );
    });

    it('clicking an open row closes it instead of opening the thread', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const content = row.parentElement! as HTMLElement;

      drag(row, { px: -8, count: 14, every: 20 });
      // Wait for the resting position, not merely a non-zero one — mid-drag
      // the row is already translated but not yet open.
      await waitFor(() =>
        expect(content.style.transform).toBe(`translateX(-${SWIPE_THRESHOLD}px)`)
      );

      fireEvent.click(row);
      expect(useUIStore.getState().selectedConversationId).toBeNull();
      await waitFor(() => expect(content.style.transform).toBe(''));
      expect((await testDb.conversations.get(conv.id)).archived).toBe(0);
    });

    it('a press outside an open row puts it away', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const content = row.parentElement! as HTMLElement;

      drag(row, { px: -8, count: 14, every: 20 });
      // Wait for the resting position, not merely a non-zero one — mid-drag
      // the row is already translated but not yet open.
      await waitFor(() =>
        expect(content.style.transform).toBe(`translateX(-${SWIPE_THRESHOLD}px)`)
      );

      fireEvent.pointerDown(document.body);
      await waitFor(() => expect(content.style.transform).toBe(''));
      expect((await testDb.conversations.get(conv.id)).archived).toBe(0);
    });

    it('a short drag that stops waits where it stopped', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const content = row.parentElement! as HTMLElement;

      // 40px by hand, then the fingers stop but stay on the pad. Springing
      // home immediately throws away a drag still in progress.
      drag(row, { px: -8, count: 5, every: 20 });
      await waitFor(() => expect(content.style.transform).toBe('translateX(-40px)'));
      await sleep(400); // past the end-of-gesture timeout, inside the park window
      expect(content.style.transform).toBe('translateX(-40px)'); // still waiting
    });

    it('...then bounces closed, because a gentle lift looks just like a pause', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const content = row.parentElement! as HTMLElement;

      // Fingers off after a partial slide produce no inertia and, on macOS,
      // no further events at all — so nothing will ever arrive to close this
      // row. Waiting forever leaves it visibly stuck half-open. Closing acts
      // on nothing, so it is allowed to happen on a timer.
      drag(row, { px: -8, count: 5, every: 20 });
      await waitFor(() => expect(content.style.transform).toBe('translateX(-40px)'));
      await waitFor(() => expect(content.style.transform).toBe(''), { timeout: 3000 });
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.archived).toBe(0);
      expect(stored.category).toBe('PRIMARY_INBOX');
    });

    it('an armed row rests open indefinitely — it is a deliberate state', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const content = row.parentElement! as HTMLElement;

      // Past the threshold the row is showing a button, not a half-finished
      // drag, so it waits for a click rather than timing out.
      drag(row, { px: -8, count: 14, every: 20 });
      await waitFor(() =>
        expect(content.style.transform).toBe(`translateX(-${SWIPE_THRESHOLD}px)`)
      );
      await sleep(1600); // well past the unarmed park window
      expect(content.style.transform).toBe(`translateX(-${SWIPE_THRESHOLD}px)`);
      expect((await testDb.conversations.get(conv.id)).archived).toBe(0);
    });

    it('moving again continues the drag from where it parked', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const content = row.parentElement! as HTMLElement;

      drag(row, { px: -8, count: 5, every: 20 }); // 40px, then stop
      await waitFor(() => expect(content.style.transform).toBe('translateX(-40px)'));
      await sleep(400); // the library ends its gesture; ours is still waiting

      // The same finger drag resumes. It must pick up at 40px, not restart —
      // 40 already down plus 48 more crosses the threshold and arms the row.
      drag(row, { px: -8, count: 6, every: 20, from: 5000 });
      await waitFor(() =>
        expect(content.style.transform).toBe(`translateX(-${SWIPE_THRESHOLD}px)`)
      );
      expect((await testDb.conversations.get(conv.id)).archived).toBe(0);
    });

    it('a fast drag that stops short of the threshold does not act on stale speed', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      // 50px at 1.5px/ms, then the fingers stop and the stream dies with no
      // inertia behind it. The flick rule must not read that leftover
      // velocity: nothing was flung, and the row still looks unarmed.
      drag(row, { px: -12.5, count: 4 });
      await sleep(900);
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.archived).toBe(0);
      expect(stored.category).toBe('PRIMARY_INBOX');
    });
  });

  describe('without a native momentum flag (older Chrome)', () => {
    // Captured from a real macOS trackpad (2026-09-08): a 1165px swipe whose
    // inertia decays over 40 events. wheel-gestures recognises the
    // deceleration pattern and reports isMomentum itself.
    const REAL_MOMENTUM_TAIL = [
      62, 54, 48, 43, 38, 34, 30, 27, 24, 21, 19, 17, 15, 13, 12, 10, 9, 8, 7, 6,
      5, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1,
    ];

    it('a decaying trackpad tail still archives', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      let at = 1000;
      for (let i = 0; i < 12; i++) wheel(row, { deltaX: 40, at: (at += 8) });
      for (const d of REAL_MOMENTUM_TAIL) wheel(row, { deltaX: d, at: (at += 8) });
      await waitFor(
        async () => {
          const stored = await testDb.conversations.get(conv.id);
          expect(stored.archived).toBe(1);
          expect(stored.category).toBe('ARCHIVE');
        },
        { timeout: 2000 }
      );
    });
  });

  describe('axis handling', () => {
    it('the row translates while dragging and reveals the matching pane', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const swipeRoot = row.closest('[data-swipe-root]')! as HTMLElement;
      const content = row.parentElement! as HTMLElement;

      wheel(row, { deltaX: -60, at: 1000 });
      await waitFor(() => {
        expect(content.style.transform).toBe('translateX(60px)');
      });
      // Rightward drag reveals the star pane (first pane), hides the archive pane
      const panes = swipeRoot.querySelectorAll('[aria-hidden]');
      expect((panes[0] as HTMLElement).style.opacity).not.toBe('0');
      expect((panes[1] as HTMLElement).style.opacity).toBe('0');
      expect(panes[0].textContent).toContain('Star');
      expect(panes[1].textContent).toContain('Archive');
      // Star pane is yellow-gold, archive pane is green
      expect((panes[0] as HTMLElement).className).toContain('bg-amber-500');
      expect((panes[1] as HTMLElement).className).toContain('bg-green-600');
    });

    it('horizontal events are swallowed even before a gesture qualifies', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const content = row.parentElement! as HTMLElement;

      // A 2px horizontal-dominant event is too small to lock the axis, but if
      // it reaches Chrome it can engage Back/Forward overscroll navigation,
      // which then eats the rest of the stream (star swipes stall mid-gesture).
      expect(wheel(row, { deltaX: -2, at: 1000 })).toBe(false); // preventDefault'ed
      expect(content.style.transform).toBe(''); // and no gesture started
    });

    it('the app disables Chrome horizontal history-swipe navigation', async () => {
      const fs = await import('node:fs');
      const css = fs.readFileSync('entrypoints/app/global.css', 'utf8');
      expect(css).toMatch(/overscroll-behavior-x:\s*none/);
    });

    it('vertical wheel scrolling never starts a swipe', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const content = row.parentElement! as HTMLElement;

      wheel(row, { deltaX: -3, deltaY: 40, at: 1000 });
      wheel(row, { deltaX: -3, deltaY: 40, at: 1008 });
      await sleep(250);
      expect(content.style.transform).toBe('');
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.starred ?? 0).toBe(0);
      expect(stored.archived).toBe(0);
    });

    it('a diagonal event mid-vertical-scroll does not start a swipe', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      const content = row.parentElement! as HTMLElement;

      // The axis is locked for the whole gesture, so a horizontal-dominant
      // event arriving mid-scroll keeps scrolling however many follow it.
      let at = 1000;
      wheel(row, { deltaX: 2, deltaY: 40, at: (at += 8) });
      wheel(row, { deltaX: 3, deltaY: 40, at: (at += 8) });
      wheel(row, { deltaX: 40, deltaY: 10, at: (at += 8) });
      wheel(row, { deltaX: 40, deltaY: 5, at: (at += 8) });
      expect(content.style.transform).toBe('');

      // Once the scroll gesture ends, a fresh horizontal one swipes normally.
      await sleep(600);
      wheel(row, { deltaX: -60, at: 3000 });
      await waitFor(() => expect(content.style.transform).not.toBe(''));
    });

    it('vertical deltas are captured, not scrolled, while a swipe is active', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      wheel(row, { deltaX: -40, at: 1000 }); // gesture starts, axis locks to x
      // Mid-gesture the fingers drift vertically — the event must belong to
      // the swipe (preventDefault) so the list can't scroll under it.
      expect(wheel(row, { deltaX: -5, deltaY: 30, at: 1008 })).toBe(false);
    });

    it('a scroll that slides a new row under the cursor cannot swipe it', async () => {
      const [rowA, rowB] = await renderRows([makeConversation(), makeConversation()]);
      const contentB = rowB.parentElement! as HTMLElement;

      // Vertical stream over row A; the list scrolls, so row B arrives under
      // the cursor and receives the rest of the same gesture. One gesture,
      // one axis — row B must not start swiping.
      let at = 1000;
      wheel(rowA, { deltaX: 1, deltaY: 40, at: (at += 8) });
      wheel(rowA, { deltaX: 2, deltaY: 40, at: (at += 8) });
      for (let i = 0; i < 4; i++) wheel(rowB, { deltaX: 40, deltaY: 12, at: (at += 8) });
      await sleep(250);
      expect(contentB.style.transform).toBe('');
    });
  });

  describe('layout and lifecycle', () => {
    it('compact rail rows are not wrapped in swipe handling', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv, 'focused', true);
      expect(row.closest('[data-swipe-root]')).toBeNull();
    });

    it('the list scroll container blocks horizontal scrolling', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);
      // overflow-y-auto makes overflow-x compute to auto unless explicitly
      // hidden — uncaptured deltaX would then scroll the whole list sideways.
      const scroller = row.closest('.overflow-y-auto')! as HTMLElement;
      expect(scroller.className).toContain('overflow-x-hidden');
    });

    it('leftover inertia during the settle animation is swallowed', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      lift(row, { px: 20, at: drag(row, { px: 40, count: 3 }) }); // commits star
      await waitFor(
        async () => expect((await testDb.conversations.get(conv.id)).starred).toBe(1),
        { timeout: 2000 }
      );
      // Stragglers arriving mid-settle must be preventDefault'ed, not left for
      // the browser to horizontally scroll an ancestor with.
      expect(wheel(row, { deltaX: -20, at: 1100, momentum: true })).toBe(false);
    });
  });

  describe('touch', () => {
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

    it('a touch drag below the threshold springs back without acting', async () => {
      const conv = makeConversation();
      const row = await renderRow(conv);

      fireEvent.touchStart(row, { touches: [{ clientX: 50, clientY: 100 }] });
      fireEvent.touchMove(row, { touches: [{ clientX: 90, clientY: 101 }] });
      fireEvent.touchEnd(row, { changedTouches: [{ clientX: 90, clientY: 101 }] });

      await sleep(500);
      const stored = await testDb.conversations.get(conv.id);
      expect(stored.starred ?? 0).toBe(0);
      expect(stored.archived).toBe(0);
    });
  });
});
