"use client";

// Drag-the-handle bottom-sheet gesture for WardModal's mobile "sheet"
// variant — reworked from this session's earlier useSwipeToDismiss.ts
// (single dismiss-only threshold) into a 3-point snap system (Peek/Half/
// Full) plus dismiss, matching the pattern every major map app uses
// (Google Maps, Apple Maps, Citymapper, Uber). Sibling to useFocusTrap.ts/
// useDismissable.ts in spirit (single-purpose, no gesture library) —
// confirmed via a repo-wide grep before the original version was written:
// no existing touch/pointer gesture code anywhere else to reuse instead,
// and no gesture library in package.json.
//
// Core design: this hook is the ONE place that ever writes to the
// wrapper's real `style.height` or `style.translate` — both for live drag
// feedback and for animating to a resting snap height, whether that
// resting change was drag-driven or programmatic (a tap on the drag-
// handle button, or WardModal's own jumpToTier force-to-half). Nothing
// else (no JSX style prop tied to `snapPoint`) touches those two
// properties, so there's never a fight between React's own reconciliation
// and this hook's imperative writes — the same reason the original
// dismiss-only version never let React's style prop touch `translate`
// either.
//
// Real `height` changes (not `transform`/`translate`) drive the Peek↔Half↔
// Full resize — `height` does not establish a new CSS containing block
// (only `transform`/`translate`/`scale`/`rotate` do), so this doesn't risk
// the `position: sticky` containing-block issue `translate` was
// specifically chosen to avoid for *dismiss* (see below). `translate`
// stays reserved for dismiss alone, unchanged from the original version.
//
// Single continuous drag, two phases, no mode flag needed — expressed as
// one running "target height" computed from the touch delta:
//   rawTargetHeight = startHeight - deltaY   (finger up => wants more
//   height; finger down => wants less)
//   - rawTargetHeight >= heights.peek: pure resize. height is set
//     directly (1:1 with the finger, undamped — a bottom sheet should
//     track the finger exactly while genuinely resizing; damping is
//     reserved for the boundary-exceeded case below), clamped to
//     [heights.peek, heights.full]. translate stays 0.
//   - rawTargetHeight < heights.peek: height clamps AT heights.peek (it
//     never shrinks further) and the *excess* pull becomes a damped
//     `translate` offset — the existing dismiss mechanic, unchanged, just
//     now entered as a continuation of the same gesture instead of being
//     the only thing dragging could ever do. Past DISMISS_THRESHOLD_PX of
//     that excess, releasing dismisses; short of it, releasing settles
//     translate back to 0 and resolves to "peek".
//
// Arming rules unchanged from the original: drag-handle always arms;
// elsewhere in the wrapper only while scrollRootRef's own scrollTop is 0
// (so ordinary mid-content scrolling is never hijacked); a touch starting
// on another interactive control (Close button, a tier's disclosure
// button) never arms even at scrollTop 0 — a real bug fixed live in the
// single-point version, carried forward here unchanged.
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const ARM_MOVE_THRESHOLD_PX = 10; // ignores a tap/jitter before committing to a drag
const DISMISS_THRESHOLD_PX = 80; // how far the (damped) excess-pull offset must reach to dismiss on release
const DISMISS_DRAG_DAMPING = 0.5; // only applied to the excess pull past Peek, matching the original dismiss feel
const VELOCITY_BIAS_PX_PER_MS = 0.5; // a flick at or above this speed biases the resolved snap one step further
const SNAP_TRANSITION_MS = 200;

export type SnapPoint = "peek" | "half" | "full";

export interface SnapHeights {
  peek: number;
  half: number;
  full: number;
}

interface UseSheetSnapDragOptions {
  enabled: boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
  dragHandleRef: RefObject<HTMLButtonElement | null>;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  heights: SnapHeights;
  snapPoint: SnapPoint;
  onSnapPointChange: (point: SnapPoint) => void;
  onDismiss: () => void;
  // Selection changing mid-drag (e.g. a search-driven selection arrives
  // while a finger is still down) is a real, previously-unfixed gap even
  // in the original single-point hook — nothing reset the drag's own
  // baseline when the thing being dragged conceptually changed underneath
  // it. Passing WardModal's own `selectionKey` here lets this hook cancel
  // any in-progress gesture cleanly (instant settle, no threshold check)
  // whenever it changes, rather than letting a stale drag resolve against
  // a `snapPoint`/`heights` pairing that shifted out from under it.
  cancelKey: string | null;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useSheetSnapDrag({
  enabled,
  wrapperRef,
  dragHandleRef,
  scrollRootRef,
  heights,
  snapPoint,
  onSnapPointChange,
  onDismiss,
  cancelKey,
}: UseSheetSnapDragOptions) {
  // Read via refs, not effect dependencies — same reasoning the original
  // hook's onDismissRef gave: fresh closures every render shouldn't churn
  // anything below.
  const onSnapPointChangeRef = useRef(onSnapPointChange);
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onSnapPointChangeRef.current = onSnapPointChange;
    onDismissRef.current = onDismiss;
  });

  // Shared mutable drag state, lifted out of any single effect (unlike the
  // original hook) so the cancel-on-selectionKey effect below can reach in
  // and reset an in-progress gesture from outside the touch-listener
  // effect that owns it.
  const draggingRef = useRef(false);
  const armedRef = useRef(false);

  // Animates (or, under prefers-reduced-motion, snaps) the wrapper to a
  // target resting height, clearing any dismiss-direction translate at the
  // same time. Used both for a drag-resolved snap and for a programmatic
  // one (tap-to-cycle, jumpToTier's force-to-half) — the one place real
  // resting-height changes happen, so there's never a second, divergent
  // "set the height" code path to keep in sync with this one.
  const animateToHeight = (wrapper: HTMLDivElement, targetPx: number) => {
    if (prefersReducedMotion()) {
      wrapper.style.transition = "";
      wrapper.style.translate = "";
      wrapper.style.height = `${targetPx}px`;
      return;
    }
    wrapper.style.transition = `height ${SNAP_TRANSITION_MS}ms ease-out, translate ${SNAP_TRANSITION_MS}ms ease-out`;
    wrapper.style.translate = "";
    wrapper.style.height = `${targetPx}px`;
    const onTransitionEnd = () => {
      wrapper.style.transition = "";
      wrapper.removeEventListener("transitionend", onTransitionEnd);
    };
    wrapper.addEventListener("transitionend", onTransitionEnd);
  };

  // Applies `snapPoint`/`heights` to the wrapper whenever either changes —
  // covers every *programmatic* snap-point change (the drag-handle
  // button's tap-to-cycle, jumpToTier's force-to-half), plus the very
  // first paint. Skipped while a drag is actually in progress, so it can't
  // fight the live touchmove handler's own direct writes to the same two
  // properties. useLayoutEffect, not useEffect — runs before the browser
  // paints, so a resting-height change (or the initial mount) never
  // flashes an intermediate/unstyled height first. Nothing in this
  // component's JSX sets `style.height`/`style.translate` declaratively —
  // this hook is the only writer of either, which is what keeps this
  // effect from ever fighting React's own reconciliation.
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!enabled || !wrapper || draggingRef.current) return;
    animateToHeight(wrapper, heights[snapPoint]);
  }, [enabled, wrapperRef, heights, snapPoint]);

  // Cancels an in-progress drag the instant the underlying selection
  // changes — see cancelKey's own doc comment above for why. Also
  // useLayoutEffect, for the same before-paint reasoning as above.
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !draggingRef.current) return;
    draggingRef.current = false;
    armedRef.current = false;
    animateToHeight(wrapper, heights[snapPoint]);
    // Deliberately keyed on cancelKey alone — this effect's whole purpose
    // is reacting to *that* value changing, not to heights/snapPoint
    // (which the effect above already handles on their own terms).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelKey]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!enabled || !wrapper) return;

    let startY = 0;
    let startHeight = heights[snapPoint];
    let lastMoveY = 0;
    let lastMoveT = 0;
    let velocity = 0; // px/ms, positive = moving down
    // Set on a completed drag so the drag-handle <button>'s own click
    // handler (added by WardModal, not this hook) can ignore the
    // synthetic click a touch-drag-release sometimes still produces —
    // see this file's own header comment on why that's a defensive
    // measure, not just trusting preventDefault() alone.
    let justDragged = false;

    const reset = () => {
      armedRef.current = false;
      draggingRef.current = false;
    };

    const resolveNearestSnapPoint = (liveHeight: number): SnapPoint => {
      const distances: [SnapPoint, number][] = [
        ["peek", Math.abs(liveHeight - heights.peek)],
        ["half", Math.abs(liveHeight - heights.half)],
        ["full", Math.abs(liveHeight - heights.full)],
      ];
      distances.sort((a, b) => a[1] - b[1]);
      let resolved = distances[0][0];
      // Velocity bias: a quick, short flick should still reach the next
      // stop even if the live height only traveled a fraction of the way
      // there — pure nearest-by-distance reads as unresponsive on a fast
      // flick, since resize tracks the finger 1:1 but a flick is, by
      // definition, a short gesture.
      if (Math.abs(velocity) >= VELOCITY_BIAS_PX_PER_MS) {
        const order: SnapPoint[] = ["peek", "half", "full"];
        const index = order.indexOf(resolved);
        if (velocity < 0 && index < order.length - 1) resolved = order[index + 1]; // moving up => bias toward taller
        else if (velocity > 0 && index > 0) resolved = order[index - 1]; // moving down => bias toward shorter
      }
      return resolved;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return; // ignore multi-touch (pinch, etc.)
      const target = e.target as Node;
      const onHandle = dragHandleRef.current?.contains(target) ?? false;
      const onOtherControl = !onHandle && !!(target as HTMLElement).closest?.("button, a, input, select, textarea");
      const atTop = (scrollRootRef.current?.scrollTop ?? 0) === 0;
      if (onOtherControl || (!onHandle && !atTop)) return;
      armedRef.current = true;
      draggingRef.current = false;
      startY = e.touches[0].clientY;
      startHeight = wrapper.getBoundingClientRect().height;
      lastMoveY = startY;
      lastMoveT = e.timeStamp;
      velocity = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!armedRef.current) return;
      const y = e.touches[0].clientY;
      const deltaY = y - startY;
      if (!draggingRef.current) {
        // Still deciding — a move under the threshold in either direction
        // is left completely alone (no preventDefault), so a tap or a
        // small scroll-adjacent jitter never gets hijacked.
        if (Math.abs(deltaY) < ARM_MOVE_THRESHOLD_PX) return;
        draggingRef.current = true;
      }
      e.preventDefault();

      const dt = e.timeStamp - lastMoveT;
      if (dt > 0) velocity = (y - lastMoveY) / dt;
      lastMoveY = y;
      lastMoveT = e.timeStamp;

      const rawTargetHeight = startHeight - deltaY;
      wrapper.style.transition = "";
      if (rawTargetHeight >= heights.peek) {
        const liveHeight = Math.min(rawTargetHeight, heights.full);
        wrapper.style.height = `${liveHeight}px`;
        wrapper.style.translate = "";
      } else {
        wrapper.style.height = `${heights.peek}px`;
        const excess = (heights.peek - rawTargetHeight) * DISMISS_DRAG_DAMPING;
        wrapper.style.translate = `0 ${excess}px`;
      }
    };

    const onTouchEnd = () => {
      if (!draggingRef.current) {
        reset();
        return;
      }
      justDragged = true;
      const currentHeight = wrapper.getBoundingClientRect().height;
      const currentTranslate = wrapper.style.translate;
      const dismissExcess = currentTranslate ? parseFloat(currentTranslate.split(" ")[1] ?? "0") : 0;
      if (dismissExcess >= DISMISS_THRESHOLD_PX) {
        onDismissRef.current();
      } else if (dismissExcess > 0) {
        // Was pulled past Peek but not far enough to dismiss — settles
        // back to Peek exactly (not wherever the excess pull left it).
        animateToHeight(wrapper, heights.peek);
        onSnapPointChangeRef.current("peek");
      } else {
        const resolved = resolveNearestSnapPoint(currentHeight);
        animateToHeight(wrapper, heights[resolved]);
        onSnapPointChangeRef.current(resolved);
      }
      reset();
    };

    // touchcancel fires for interruptions the resident didn't choose (an
    // incoming call, the OS taking over the gesture, browser chrome
    // stealing it) — never a deliberate release. Always settles back to
    // whichever snap point the drag started from, never dismisses and
    // never resolves to a different snap point, regardless of how far the
    // gesture had traveled — carried forward from the original hook's own
    // fix for this exact class of bug.
    const onTouchCancel = () => {
      if (draggingRef.current) animateToHeight(wrapper, startHeight);
      reset();
    };

    wrapper.addEventListener("touchstart", onTouchStart, { passive: true });
    // Not passive — onTouchMove conditionally calls preventDefault once a
    // drag is confirmed, which passive:true would silently disallow.
    wrapper.addEventListener("touchmove", onTouchMove, { passive: false });
    wrapper.addEventListener("touchend", onTouchEnd);
    wrapper.addEventListener("touchcancel", onTouchCancel);

    // Ghost-click guard for the drag-handle <button> (see this file's own
    // header comment): a completed drag-release on the handle risks the
    // browser's native synthetic click firing right after, which would
    // otherwise cycle the snap point a second time immediately after the
    // drag already resolved one. preventDefault() during touchmove should
    // suppress that synthetic click per spec, but this exact class of
    // cross-browser touch-event nuance has already produced two confirmed
    // bugs this session — defended here rather than trusted on spec alone.
    const handle = dragHandleRef.current;
    const onHandleClick = (e: MouseEvent) => {
      if (justDragged) {
        e.preventDefault();
        e.stopPropagation();
        justDragged = false;
      }
    };
    handle?.addEventListener("click", onHandleClick, true);

    return () => {
      wrapper.removeEventListener("touchstart", onTouchStart);
      wrapper.removeEventListener("touchmove", onTouchMove);
      wrapper.removeEventListener("touchend", onTouchEnd);
      wrapper.removeEventListener("touchcancel", onTouchCancel);
      handle?.removeEventListener("click", onHandleClick, true);
      wrapper.style.transition = "";
      wrapper.style.translate = "";
    };
  }, [enabled, wrapperRef, dragHandleRef, scrollRootRef, heights, snapPoint]);
}
