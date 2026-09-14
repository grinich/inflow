import { useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { WheelGestures } from 'wheel-gestures';
import type { WheelEventState } from 'wheel-gestures';

/** Horizontal travel (px) required to arm the action. */
export const SWIPE_THRESHOLD = 88;
/** Extra travel available past the threshold (asymptotic rubber band). */
const MAX_OVERDRAG = 56;
/** Accumulated movement (px) before a gesture's axis is locked in. */
const AXIS_LOCK = 6;
/** Minimum travel (px) before a flick can commit — less is a stray nudge. */
const FLICK_MIN_TRAVEL = 40;
/** Release speed (px/ms) that counts as a flick: ~600px/s, the same order as
 *  UIKit's velocity cut-off for swipe actions. */
const FLICK_VELOCITY = 0.6;
/** Hard cap on tracked travel, so a long flick can't build unbounded offset. */
const MAX_TRAVEL = SWIPE_THRESHOLD + 600;
/** Slide-out duration for a committed leftward swipe. */
const EXIT_MS = 220;
/** Vertical collapse that follows the slide-out — the filled row shrinks
 *  away rather than reverting to a normal row on its way out. */
const COLLAPSE_MS = 180;
/** Spring-back duration when a swipe is released or completed in place. */
const SETTLE_MS = 350;
/** How long an unarmed part-way drag waits, parked, before bouncing closed.
 *  Long enough to survive a pause mid-drag, short enough that a row left
 *  half-open by a gentle lift doesn't look stuck. */
const PARK_TIMEOUT_MS = 900;

/** What the module-level gesture tracker drives on the row it has claimed. */
interface RowController {
  /** A swipe has claimed this row. Returns the offset to continue from — 0,
   *  or where the row is parked if a previous drag stopped part-way. */
  begin: () => number;
  /** Absolute user-driven travel so far (+right / -left). */
  move: (travel: number) => void;
  /** Fingers are proven off: commit the armed action, or spring back. */
  release: (commit: boolean) => void;
  /** The stream stopped without proving a lift: park where we are, firing
   *  nothing. Past the threshold that means resting open with the action
   *  revealed; short of it the row waits a beat, then bounces closed. */
  hold: () => void;
  /** Put a parked row away without acting. */
  close: () => void;
  /** Is this node inside the row? (Used to spot clicks landing elsewhere.) */
  contains: (node: Node) => boolean;
  /** True while a release animation owns the row — it can't be re-claimed. */
  busy: () => boolean;
}

const rows = new Map<Element, RowController>();

/** At most one row sits parked mid-gesture at a time, as on iOS. */
let parkedRow: RowController | null = null;

const closeParkedRow = (except?: RowController) => {
  if (parkedRow && parkedRow !== except) parkedRow.close();
};

/** A press anywhere outside the parked row puts it away, like tapping off a
 *  revealed iOS row. Presses inside it are left to the row's own handlers —
 *  the pane commits, the content closes and swallows the click. */
const onDocumentPointerDown = (e: Event) => {
  const target = e.target;
  if (parkedRow && (!(target instanceof Node) || !parkedRow.contains(target))) closeParkedRow();
};

/**
 * The one in-flight wheel gesture. A trackpad produces at most one at a time
 * and wheel-gestures reports its start and end, so this state lives at module
 * level rather than per row: a vertical scroll that slides a different row
 * under the cursor mid-stream is still the same gesture, and so cannot start
 * a swipe on the row that just arrived.
 */
const gesture = {
  owner: null as RowController | null,
  axis: '' as '' | 'x' | 'y',
  /** User-driven travel only — inertia is excluded (see onWheel). */
  travel: 0,
  released: false,
};

function resetGesture() {
  gesture.owner = null;
  gesture.axis = '';
  gesture.travel = 0;
  gesture.released = false;
}

const rowFor = (target: EventTarget | null | undefined): RowController | undefined => {
  if (!(target instanceof Element)) return undefined;
  const root = target.closest('[data-swipe-root]');
  return root ? rows.get(root) : undefined;
};

/**
 * Would releasing right now act? Distance is the primary rule, but a short
 * fast flick has to count too — that is the part of the iOS feel a pure
 * distance threshold misses, and it is why the old build could only be driven
 * by dragging the row the whole way. wheel-gestures measures release velocity
 * from merged scroll points, so a flick still moving at speed arms the action
 * from well short of the threshold. (Its own axisMovementProjection is tuned
 * for carousel snapping — hundreds of px — far too loose for an 88px gate.)
 *
 * Only ever consulted for a flung release — see onWheel for why a stream that
 * merely stopped may not act at all.
 */
const isFlick = (s: WheelEventState) => {
  const travel = gesture.travel;
  const velocity = s.axisVelocity[0];
  return (
    Math.abs(travel) >= FLICK_MIN_TRAVEL &&
    Math.sign(velocity) === Math.sign(travel) &&
    Math.abs(velocity) >= FLICK_VELOCITY
  );
};

/**
 * Single subscriber for every row's wheel stream.
 *
 * The hard part of a trackpad swipe is knowing when the fingers left the pad:
 * a `wheel` stream has no release event, and a gesture that pauses mid-drag
 * looks identical to one that ended. wheel-gestures answers it — natively
 * from `WheelEvent.momentum` (Chrome 151+), and from its own deceleration
 * analysis on older versions — so this handler only has to decide what a
 * release means, not detect one.
 */
const onWheel = (s: WheelEventState) => {
  if (s.isStart) resetGesture();

  // Inertia: the fingers have measurably left the pad. This is the ONLY
  // release this code trusts, and the only path that fires an action without
  // a click. Decide once and swallow the rest of the tail, so the commit
  // lands at the moment of release rather than several hundred milliseconds
  // into the decay.
  if (s.isMomentum) {
    if (gesture.owner && !gesture.released) {
      gesture.released = true;
      gesture.owner.release(Math.abs(gesture.travel) >= SWIPE_THRESHOLD || isFlick(s));
    }
    return;
  }

  if (!gesture.axis) {
    const [mx, my] = s.axisMovement;
    if (Math.abs(mx) < AXIS_LOCK && Math.abs(my) < AXIS_LOCK) return;
    gesture.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (gesture.axis === 'x') {
      const row = rowFor(s.event.target);
      if (row && !row.busy()) {
        closeParkedRow(row);
        gesture.owner = row;
        gesture.travel = row.begin();
      } else {
        closeParkedRow();
      }
    } else {
      closeParkedRow();
    }
  }
  if (gesture.axis !== 'x' || !gesture.owner || gesture.released) return;

  // Every event of an owned swipe belongs to it, vertical component included,
  // or the list scrolls under the gesture. (preventWheelAction only judges
  // each event's own dominant axis, so a diagonal one would slip through.)
  s.event.preventDefault?.();

  gesture.travel = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, gesture.travel + s.axisDelta[0]));
  gesture.owner.move(gesture.travel);

  // The stream fell silent with no inertia behind it. That is NOT a release:
  // a wheel stream goes quiet the instant the fingers stop moving, whether
  // they lifted or are still resting on the pad, and the two are
  // indistinguishable. Acting here archives rows out from under fingers that
  // never left the trackpad, so it must not.
  //
  // So the row just parks where it is and waits. Nothing fires, and nothing
  // springs back either: snapping home would throw away a drag whose fingers
  // are very likely still on the pad, and moving again has to carry on from
  // where it stopped rather than restart from zero. Past the threshold the
  // parked row rests open with its action revealed as a button; short of it
  // it sits there mid-drag and then bounces closed (see hold), since a gentle
  // lift is indistinguishable from a pause and closing acts on nothing.
  if (s.isEnding) {
    gesture.released = true;
    gesture.owner.hold();
  }
};

let instance: ReturnType<typeof WheelGestures> | null = null;

const wheelGestures = () => {
  if (!instance) {
    // 'x': horizontal-dominant events belong to the swipe — and, left
    // unprevented, drive Chrome's Back/Forward overscroll, which then eats
    // the rest of the stream mid-gesture. Vertical ones fall through and
    // scroll the list.
    instance = WheelGestures({ preventWheelAction: 'x' });
    instance.on('wheel', onWheel);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
  }
  return instance;
};

/**
 * Tests only: drop the shared tracker and its instance, so a gesture left
 * in flight by one case can't be read as a continuation by the next. Rows
 * re-observe a fresh instance when they mount.
 */
export function _resetSwipeGestures() {
  instance?.disconnect();
  if (instance) document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  instance = null;
  rows.clear();
  parkedRow = null;
  resetGesture();
}

interface SwipeSide {
  icon: ReactNode;
  label: string;
  /** Background classes for the revealed pane, e.g. 'bg-green-600'. */
  className: string;
}

interface SwipeableRowProps {
  /** Revealed when dragging right (anchored to the left edge). */
  right: SwipeSide;
  /** Revealed when dragging left (anchored to the right edge). */
  left: SwipeSide;
  /** Fires on release past the threshold; the row springs back in place. */
  onSwipeRight: () => void;
  /** Fires after the row slides out — for actions that remove it from the list. */
  onSwipeLeft: () => void;
  children: ReactNode;
}

/**
 * Horizontal swipe-to-act wrapper for list rows. Trackpad wheel gestures are
 * read through wheel-gestures (see onWheel); touch drags are handled directly,
 * since touch already has a real release event. Mouse drags are deliberately
 * ignored so clicks and text behavior stay untouched. All motion is applied to
 * the DOM via refs — no re-renders during the gesture.
 *
 * Feel: content tracks the fingers 1:1 up to the threshold, then an
 * exponential rubber band takes over. Crossing the threshold pops the icon
 * with a back-out curve; release below the threshold springs back with a
 * slight overshoot; a committed left swipe accelerates off-screen.
 */
export function SwipeableRow({ right, left, onSwipeRight, onSwipeLeft, children }: SwipeableRowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const paneRightRef = useRef<HTMLDivElement>(null);
  const paneLeftRef = useRef<HTMLDivElement>(null);
  const iconRightRef = useRef<HTMLSpanElement>(null);
  const iconLeftRef = useRef<HTMLSpanElement>(null);

  // Latest-callback refs so the listeners (bound once) never go stale.
  const cb = useRef({ onSwipeRight, onSwipeLeft });
  cb.current = { onSwipeRight, onSwipeLeft };

  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) return;

    const st = {
      travel: 0,
      armed: false,
      settling: false, // a release animation is running — ignore input
      open: 0, // direction this row rests open in, or 0 when not open
      parked: false, // stopped mid-gesture, waiting — a drag resumes from here
      parkTimer: undefined as ReturnType<typeof setTimeout> | undefined,
      raf: 0,
      touchX: 0,
      touchY: 0,
      touchBase: 0, // offset the touch drag resumes from (non-zero when open)
      touchAxis: 0 as 0 | 1 | 2, // 0 undecided, 1 horizontal, 2 vertical
    };

    const pane = (dir: number) => (dir > 0 ? paneRightRef.current : paneLeftRef.current);
    const icon = (dir: number) => (dir > 0 ? iconRightRef.current : iconLeftRef.current);

    /** 1:1 up to the threshold, exponential rubber band beyond it. */
    const displayed = () => {
      const abs = Math.abs(st.travel);
      if (abs <= SWIPE_THRESHOLD) return st.travel;
      const over = MAX_OVERDRAG * (1 - Math.exp(-(abs - SWIPE_THRESHOLD) / 120));
      return Math.sign(st.travel) * (SWIPE_THRESHOLD + over);
    };

    const paint = () => {
      const off = displayed();
      const dir = Math.sign(off);
      const progress = Math.min(1, Math.abs(off) / SWIPE_THRESHOLD);
      content.style.transform = `translateX(${off}px)`;
      for (const d of [1, -1]) {
        const p = pane(d);
        const ic = icon(d);
        if (!p || !ic) continue;
        if (d !== dir) {
          p.style.opacity = '0';
          continue;
        }
        p.style.opacity = st.armed ? '1' : '0.85';
        ic.style.opacity = String(Math.min(1, progress * 1.4));
        if (!st.armed) {
          // Ease-out-cubic growth toward rest scale while tracking the drag.
          const eased = 1 - Math.pow(1 - progress, 3);
          ic.style.transform = `scale(${0.5 + 0.5 * eased})`;
        }
      }
    };

    const schedulePaint = () => {
      if (st.raf) return;
      st.raf = requestAnimationFrame(() => {
        st.raf = 0;
        paint();
      });
    };

    const setArmed = (armed: boolean) => {
      if (armed === st.armed) return;
      st.armed = armed;
      const ic = icon(Math.sign(st.travel));
      if (!ic) return;
      if (armed) {
        // Back-out pop: overshoots past full size then settles.
        ic.style.transition = 'transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1)';
        ic.style.transform = 'scale(1.12)';
      } else {
        // Retreated below the threshold — hand scale back to per-frame paint.
        ic.style.transition = '';
      }
    };

    const reset = () => {
      st.travel = 0;
      st.armed = false;
      st.settling = false;
      st.open = 0;
      st.parked = false;
      if (parkedRow === controller) parkedRow = null;
      root.style.transition = '';
      root.style.height = '';
      content.style.transition = '';
      content.style.transform = '';
      for (const d of [1, -1]) {
        const p = pane(d);
        const ic = icon(d);
        if (p) {
          p.style.opacity = '0';
          p.style.pointerEvents = '';
        }
        if (ic) {
          ic.style.transition = '';
          ic.style.transform = 'scale(0.5)';
          ic.style.opacity = '0';
        }
      }
    };

    const settleBack = () => {
      clearTimeout(st.parkTimer);
      st.settling = true;
      // Slight overshoot (y > 1 control point) so the return has some life.
      content.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1.2, 0.36, 1)`;
      content.style.transform = 'translateX(0px)';
      for (const d of [1, -1]) {
        const p = pane(d);
        if (p) p.style.opacity = '0'; // panes have transition-opacity — they fade
      }
      setTimeout(reset, SETTLE_MS);
    };

    const commit = (dir: number) => {
      if (st.settling) return;
      st.open = 0;
      if (parkedRow === controller) parkedRow = null;
      // A flick can arm from short of the distance threshold, where paint has
      // not popped the icon yet — pop it now so the row never acts while
      // still looking unarmed.
      setArmed(true);
      if (dir < 0) {
        // Commit left, in two beats. First the content accelerates off-screen,
        // leaving the row a full band of the action colour.
        st.settling = true;
        st.parked = false;
        content.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
        content.style.transform = `translateX(${-(root.offsetWidth || window.innerWidth)}px)`;
        setTimeout(() => {
          // Then the band collapses vertically and is gone. The normal row
          // must NEVER come back between the two — restoring it even for a
          // frame reads as a flash before the row disappears, which is what
          // resetting here used to do. iOS shrinks the filled row away.
          root.style.height = `${root.offsetHeight}px`;
          void root.offsetHeight; // flush, so the height below animates from here
          root.style.transition = `height ${COLLAPSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
          root.style.height = '0px';
          setTimeout(() => {
            cb.current.onSwipeLeft();
            reset();
          }, COLLAPSE_MS);
        }, EXIT_MS);
        return;
      }
      // Commit right fires in place (the row stays); either way, spring back.
      cb.current.onSwipeRight();
      settleBack();
    };

    const controller: RowController = {
      busy: () => st.settling,
      begin: () => {
        clearTimeout(st.parkTimer);
        content.style.transition = '';
        // A parked row carries on from where it sits — the fingers never left
        // the pad, so this is one continuous drag however long the pause was,
        // even though wheel-gestures reports it as a new gesture.
        if (!st.parked) st.travel = 0;
        st.parked = false;
        return st.travel;
      },
      move: (travel) => {
        st.travel = travel;
        setArmed(Math.abs(travel) >= SWIPE_THRESHOLD);
        schedulePaint();
      },
      release: (commit_) => {
        if (commit_) commit(Math.sign(st.travel));
        else settleBack();
      },
      hold: () => {
        const dir = Math.sign(st.travel);
        if (!dir) return;
        st.parked = true;
        parkedRow = controller;
        if (Math.abs(st.travel) < SWIPE_THRESHOLD) {
          // Short of the threshold there is nothing to reveal and nothing to
          // snap to: stay exactly where the drag stopped, untouched, and wait
          // for the drag to continue.
          //
          // But a gentle lift — no fling, so no inertia and, on macOS, no
          // further events of any kind — looks exactly like that pause, and a
          // row left hanging half-open forever is far worse than a long pause
          // losing its progress. So an unarmed park bounces closed after a
          // beat. That is safe precisely because closing fires nothing: a
          // timer may put the row away, but only a proven lift may act.
          st.open = 0;
          clearTimeout(st.parkTimer);
          st.parkTimer = setTimeout(() => {
            if (st.parked && !st.open) settleBack();
          }, PARK_TIMEOUT_MS);
          return;
        }
        // Armed: settle onto the detent and reveal the action as a button.
        st.open = dir;
        st.travel = dir * SWIPE_THRESHOLD;
        setArmed(true);
        content.style.transition = `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        content.style.transform = `translateX(${st.travel}px)`;
        const p = pane(dir);
        if (p) {
          p.style.opacity = '1';
          p.style.pointerEvents = 'auto';
        }
      },
      close: () => {
        if (!st.parked) return;
        settleBack();
      },
      contains: (node) => root.contains(node),
    };

    rows.set(root, controller);
    const unobserve = wheelGestures().observe(root);

    const onTouchStart = (e: TouchEvent) => {
      if (st.settling) return;
      const t = e.touches[0];
      st.touchX = t.clientX;
      st.touchY = t.clientY;
      st.touchAxis = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (st.settling) return;
      const t = e.touches[0];
      const dx = t.clientX - st.touchX;
      const dy = t.clientY - st.touchY;
      if (st.touchAxis === 0) {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return; // axis not clear yet
        st.touchAxis = Math.abs(dx) > Math.abs(dy) ? 1 : 2;
        if (st.touchAxis === 1) st.touchBase = controller.begin();
      }
      if (st.touchAxis !== 1) return;
      e.preventDefault();
      const travel = st.touchBase + dx;
      controller.move(Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, travel)));
    };

    const onTouchEnd = () => {
      // touchend IS a release — the lift is observable, unlike on a trackpad —
      // so distance alone decides and there is no need to rest open.
      if (st.touchAxis === 1) controller.release(Math.abs(st.travel) >= SWIPE_THRESHOLD);
      st.touchAxis = 0;
    };

    /** The revealed action is a real button once the row rests open. */
    const onPaneClick = (e: MouseEvent) => {
      if (!st.open) return;
      e.preventDefault();
      e.stopPropagation();
      commit(st.open);
    };

    /** Clicking the row itself while it is open puts it away — and must not
     *  also open the thread, so the click is swallowed on the way down. */
    const onContentClick = (e: MouseEvent) => {
      if (!st.open) return;
      e.preventDefault();
      e.stopPropagation();
      controller.close();
    };

    const panes = [paneRightRef.current, paneLeftRef.current];
    for (const p of panes) p?.addEventListener('click', onPaneClick);
    content.addEventListener('click', onContentClick, true);
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd);
    root.addEventListener('touchcancel', onTouchEnd);
    return () => {
      unobserve();
      rows.delete(root);
      // Virtualized rows unmount mid-scroll; don't leave the tracker — or the
      // open-row slot — pointing at a controller whose element is gone.
      if (gesture.owner === controller) resetGesture();
      if (parkedRow === controller) parkedRow = null;
      for (const p of panes) p?.removeEventListener('click', onPaneClick);
      content.removeEventListener('click', onContentClick, true);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', onTouchEnd);
      clearTimeout(st.parkTimer);
      if (st.raf) cancelAnimationFrame(st.raf);
    };
  }, []);

  const paneBase =
    'pointer-events-none absolute inset-0 flex items-center opacity-0 transition-opacity duration-150';
  const iconBase = 'flex flex-col items-center gap-1 text-white opacity-0';

  return (
    <div ref={rootRef} data-swipe-root className="relative touch-pan-y overflow-hidden">
      <div ref={paneRightRef} aria-hidden className={`${paneBase} justify-start pl-6 ${right.className}`}>
        <span ref={iconRightRef} className={iconBase} style={{ transform: 'scale(0.5)' }}>
          {right.icon}
          <span className="text-[10px] font-semibold leading-none">{right.label}</span>
        </span>
      </div>
      <div ref={paneLeftRef} aria-hidden className={`${paneBase} justify-end pr-6 ${left.className}`}>
        <span ref={iconLeftRef} className={iconBase} style={{ transform: 'scale(0.5)' }}>
          {left.icon}
          <span className="text-[10px] font-semibold leading-none">{left.label}</span>
        </span>
      </div>
      <div ref={contentRef} className="relative bg-surface">{children}</div>
    </div>
  );
}
