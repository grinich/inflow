import { useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

/** Horizontal travel (px) required to arm the action. */
export const SWIPE_THRESHOLD = 88;
/** Extra travel available past the threshold (asymptotic rubber band). */
const MAX_OVERDRAG = 56;
/** Wheel silence (ms) after which the gesture is evaluated — trackpads emit
 *  continuously while fingers move, so a gap means motion has stopped. */
const END_DEBOUNCE = 120;
/** Silence (ms) after a loud tail before a held swipe is cancelled — no lift
 *  signal ever arrived, so spring back rather than commit on ambiguity. */
const HOLD_CANCEL_MS = 1200;
/** Mean |deltaX| of the final wheel events at or below which the tail reads
 *  as decayed momentum, i.e. the fingers already left the trackpad. */
const QUIET_DELTA = 4;
/** Slide-out duration for a committed leftward swipe. */
const EXIT_MS = 220;
/** Spring-back duration when a swipe is released or completed in place. */
const SETTLE_MS = 350;

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
 * Horizontal swipe-to-act wrapper for list rows. Drives trackpad wheel
 * gestures (deltaX) and touch drags; mouse drags are deliberately ignored so
 * clicks and text behavior stay untouched. All motion is applied directly to
 * the DOM via refs — no re-renders during the gesture.
 *
 * Feel: content tracks the pointer 1:1 up to the threshold, then an
 * exponential rubber band takes over. Crossing the threshold pops the icon
 * with a back-out curve; release below the threshold springs back with a
 * slight overshoot; a committed left swipe accelerates off-screen.
 *
 * Commit timing: the action only ever fires on a lift signal — a decayed
 * momentum tail on trackpads, touchend on touch. Pausing mid-swipe holds the
 * row where it is (see onSilence); if the hold goes quiet with no lift signal
 * the swipe springs back WITHOUT acting. Ambiguity never commits.
 */
export function SwipeableRow({ right, left, onSwipeRight, onSwipeLeft, children }: SwipeableRowProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const paneRightRef = useRef<HTMLDivElement>(null);
  const paneLeftRef = useRef<HTMLDivElement>(null);
  const iconRightRef = useRef<HTMLSpanElement>(null);
  const iconLeftRef = useRef<HTMLSpanElement>(null);

  // Latest-callback refs so the native listeners (bound once) never go stale.
  const cb = useRef({ onSwipeRight, onSwipeLeft });
  cb.current = { onSwipeRight, onSwipeLeft };

  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) return;

    const st = {
      raw: 0,          // accumulated gesture travel (+right / -left)
      active: false,
      settling: false, // a release animation is running — ignore input
      armed: false,
      raf: 0,
      endTimer: 0 as ReturnType<typeof setTimeout> | 0,
      touchX: 0,
      touchY: 0,
      touchAxis: 0 as 0 | 1 | 2, // 0 undecided, 1 horizontal, 2 vertical
      recent: [] as number[],    // |deltaX| of the last few wheel events
    };

    const pane = (dir: number) => (dir > 0 ? paneRightRef.current : paneLeftRef.current);
    const icon = (dir: number) => (dir > 0 ? iconRightRef.current : iconLeftRef.current);

    /** 1:1 up to the threshold, exponential rubber band beyond it. */
    const displayed = () => {
      const abs = Math.abs(st.raw);
      if (abs <= SWIPE_THRESHOLD) return st.raw;
      const over = MAX_OVERDRAG * (1 - Math.exp(-(abs - SWIPE_THRESHOLD) / 120));
      return Math.sign(st.raw) * (SWIPE_THRESHOLD + over);
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
      const ic = icon(Math.sign(st.raw));
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
      st.raw = 0;
      st.armed = false;
      st.settling = false;
      content.style.transition = '';
      content.style.transform = '';
      for (const d of [1, -1]) {
        const p = pane(d);
        const ic = icon(d);
        if (p) p.style.opacity = '0';
        if (ic) {
          ic.style.transition = '';
          ic.style.transform = 'scale(0.5)';
          ic.style.opacity = '0';
        }
      }
    };

    const settleBack = () => {
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

    const finish = () => {
      if (!st.active) return;
      st.active = false;
      if (st.endTimer) clearTimeout(st.endTimer);
      const committed = Math.abs(st.raw) >= SWIPE_THRESHOLD ? Math.sign(st.raw) : 0;

      if (committed < 0) {
        // Commit left: accelerate off-screen, then fire (the action removes the row).
        st.settling = true;
        content.style.transition = `transform ${EXIT_MS}ms cubic-bezier(0.4, 0, 1, 1)`;
        content.style.transform = `translateX(${-(root.offsetWidth || window.innerWidth)}px)`;
        setTimeout(() => {
          cb.current.onSwipeLeft();
          reset();
        }, EXIT_MS);
        return;
      }
      // Commit right fires in place (the row stays); either way, spring back.
      if (committed > 0) cb.current.onSwipeRight();
      settleBack();
    };

    const applyDelta = (raw: number) => {
      // Cap so wheel momentum can't build unbounded travel.
      const cap = SWIPE_THRESHOLD + 600;
      st.raw = Math.max(-cap, Math.min(cap, raw));
      setArmed(Math.abs(st.raw) >= SWIPE_THRESHOLD);
      schedulePaint();
    };

    /** End the gesture without committing — a held swipe went quiet with no
     *  lift signal. Destructive actions must never fire on ambiguity. */
    const cancelHold = () => {
      if (!st.active) return;
      st.active = false;
      if (st.endTimer) clearTimeout(st.endTimer);
      settleBack();
    };

    /**
     * The wheel stream went silent. A finger lift is invisible to the DOM, so
     * infer it from the tail: momentum (which follows any real lift while
     * moving) decays to ~1px deltas before stopping, whereas fingers coming
     * to rest ON the trackpad cut off at full magnitude. A quiet tail means
     * the fingers are already off — act now. A loud tail means they're
     * still resting mid-swipe — hold the row in place (any further movement
     * resumes the gesture) and NEVER auto-commit: if the silence persists,
     * spring back without acting.
     */
    const onSilence = () => {
      const tail = st.recent.slice(-3);
      const quiet =
        tail.length > 0 && tail.reduce((a, b) => a + b, 0) / tail.length <= QUIET_DELTA;
      if (quiet) {
        finish();
        return;
      }
      st.endTimer = setTimeout(cancelHold, HOLD_CANCEL_MS);
    };

    const onWheel = (e: WheelEvent) => {
      if (st.settling) return;
      const ax = Math.abs(e.deltaX);
      const ay = Math.abs(e.deltaY);
      if (!st.active) {
        // Only capture clearly-horizontal intent; vertical scrolling passes through.
        if (ax <= ay || ax < 4) return;
        st.active = true;
        st.raw = 0;
        st.recent = [];
        content.style.transition = '';
      }
      e.preventDefault();
      st.recent.push(ax);
      if (st.recent.length > 4) st.recent.shift();
      // Natural scrolling: fingers moving right emit negative deltaX.
      applyDelta(st.raw - e.deltaX);
      if (st.endTimer) clearTimeout(st.endTimer);
      st.endTimer = setTimeout(onSilence, END_DEBOUNCE);
    };

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
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return; // direction not clear yet
        st.touchAxis = Math.abs(dx) > Math.abs(dy) ? 1 : 2;
        if (st.touchAxis === 1) {
          st.active = true;
          st.raw = 0;
          content.style.transition = '';
        }
      }
      if (st.touchAxis !== 1) return;
      e.preventDefault();
      applyDelta(dx);
    };

    const onTouchEnd = () => {
      if (st.touchAxis === 1) finish();
      st.touchAxis = 0;
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    root.addEventListener('touchend', onTouchEnd);
    root.addEventListener('touchcancel', onTouchEnd);
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove);
      root.removeEventListener('touchend', onTouchEnd);
      root.removeEventListener('touchcancel', onTouchEnd);
      if (st.endTimer) clearTimeout(st.endTimer);
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
