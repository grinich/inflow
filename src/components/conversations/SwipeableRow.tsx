import { useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

/** Horizontal travel (px) required to arm the action. */
export const SWIPE_THRESHOLD = 88;
/** Extra travel available past the threshold (asymptotic rubber band). */
const MAX_OVERDRAG = 56;
/** Wheel silence (ms) after which the gesture is evaluated — trackpads emit
 *  continuously while fingers move, so a gap means motion has stopped. */
const END_DEBOUNCE = 120;
/** Silence (ms) after a loud tail before an ARMED swipe is cancelled — no
 *  lift signal ever arrived, so spring back rather than commit on ambiguity.
 *  Long, because a commit decision is pending and fingers may be resting. */
const HOLD_CANCEL_MS = 1200;
/** Silence (ms) before an unarmed swipe springs back. Short — nothing can
 *  commit below the threshold; this only bridges the micro-pauses of a slow
 *  deliberate drag, and a lifted small scroll must visibly bounce back. */
const UNARMED_CANCEL_MS = 400;
/** A momentum tail must end this small (px) — macOS momentum decays to 1–2px
 *  before stopping; fingers halting on the pad usually cut off larger. */
const QUIET_DELTA = 2;
/** Peak |deltaX| that must precede the decay — momentum after a real flick
 *  starts near the finger's speed at lift. */
const MOMENTUM_MIN_PEAK = 15;
/** Length of the decay run after the peak. This is the main discriminator
 *  between "lifted while moving" and "stopped with fingers still down":
 *  macOS momentum emits dozens of smoothly decaying events over hundreds of
 *  milliseconds, while a human finger decelerating to a pause — whose deltas
 *  also decay! — halts within a handful of events. */
const MIN_DECAY_EVENTS = 8;
/** Slide-out duration for a committed leftward swipe. */
const EXIT_MS = 220;
/** Spring-back duration when a swipe is released or completed in place. */
const SETTLE_MS = 350;

/**
 * Axis of the most recent wheel stream, shared across all rows (a vertical
 * scroll passes over many rows). A continuous stream — no STREAM_GAP_MS
 * silence — keeps its axis: a slightly-diagonal event mid-vertical-scroll
 * must keep scrolling, not start a swipe, and vice versa. Exported only so
 * tests can reset it between cases.
 */
export const _wheelStream = { ts: 0, horizontal: false };
const STREAM_GAP_MS = 150;

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
      console.debug('[swipe] end', { raw: st.raw, committed });

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
      console.debug('[swipe] hold-cancel (no lift signal)', { raw: st.raw, recent: [...st.recent] });
      settleBack();
    };

    /**
     * Does the recent wheel stream end in a genuine momentum tail — the only
     * observable proof the fingers left the trackpad? Momentum has a
     * distinctive shape: a meaningful velocity peak, then a sustained run of
     * (weakly) decaying deltas down to ~1px. Fingers stopping ON the trackpad
     * cut off abruptly at full magnitude, and a slow fingers-down drag stays
     * small throughout with no peak-then-decay — neither may commit.
     */
    const isLiftTail = () => {
      const r = st.recent;
      if (r.length < MIN_DECAY_EVENTS + 1) return false;
      const [prev, last] = r.slice(-2);
      if (last > QUIET_DELTA || prev > QUIET_DELTA + 2) return false;
      const peak = Math.max(...r);
      if (peak < MOMENTUM_MIN_PEAK) return false;
      const peakIdx = r.lastIndexOf(peak);
      if (r.length - 1 - peakIdx < MIN_DECAY_EVENTS) return false;
      for (let i = peakIdx; i < r.length - 1; i++) {
        if (r[i + 1] > r[i] + 1) return false; // decay must not rebound (1px jitter allowed)
      }
      return true;
    };

    /**
     * The wheel stream went silent. Commit ONLY if the tail proves a finger
     * lift (see isLiftTail). Anything else — abrupt stop, slow drag pause —
     * means the fingers may still be down: hold the row in place (further
     * movement resumes the gesture) and spring back without acting if the
     * silence persists. No timer ever commits the action.
     */
    const onSilence = () => {
      const lift = isLiftTail();
      const armed = Math.abs(st.raw) >= SWIPE_THRESHOLD;
      console.debug('[swipe] silence', { raw: st.raw, lift, armed, recent: [...st.recent] });
      if (lift) {
        finish();
        return;
      }
      st.endTimer = setTimeout(cancelHold, armed ? HOLD_CANCEL_MS : UNARMED_CANCEL_MS);
    };

    const onWheel = (e: WheelEvent) => {
      const ax = Math.abs(e.deltaX);
      const ay = Math.abs(e.deltaY);
      const now = Date.now();
      const wasVertical = now - _wheelStream.ts < STREAM_GAP_MS && !_wheelStream.horizontal;
      _wheelStream.ts = now;

      if (st.settling) {
        // Swallow leftover horizontal momentum while the row animates; let
        // vertical events through so normal scrolling resumes instantly.
        _wheelStream.horizontal = ax > ay;
        if (ax > ay) e.preventDefault();
        return;
      }
      if (!st.active) {
        // Only capture clearly-horizontal intent, and never mid-stream of a
        // vertical scroll — a slightly-diagonal event while scrolling must
        // keep scrolling. (It takes two consecutive horizontal-dominant
        // events to convert a live vertical stream into a swipe.)
        if (ax <= ay || ax < 4 || wasVertical) {
          _wheelStream.horizontal = ax > ay;
          return;
        }
        st.active = true;
        st.raw = 0;
        st.recent = [];
        content.style.transition = '';
      }
      // While the swipe is active every wheel event belongs to it — vertical
      // components included — so the list cannot scroll under the gesture.
      _wheelStream.horizontal = true;
      e.preventDefault();
      // Only horizontally-dominant events feed the lift classifier — vertical
      // finger drift (1px deltaX beside a large deltaY) would otherwise
      // fabricate a decaying "momentum tail" while fingers are still down.
      if (ax > ay) {
        st.recent.push(ax);
        if (st.recent.length > 20) st.recent.shift();
      }
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
