"use client";

// A small, dependency-free "drag down to dismiss" gesture for WardModal's
// mobile "sheet" variant — sibling to useFocusTrap.ts/useDismissable.ts in
// spirit (single-purpose, no gesture library). Grabbing the drag-handle, or
// pulling down further once already scrolled to the top of the panel's own
// content, dismisses the sheet past a distance threshold; releasing under
// threshold snaps back. Confirmed via a repo-wide grep before writing this:
// no existing touch/pointer gesture code anywhere else to reuse instead,
// and no gesture library in package.json.
//
// Only ever armed (allowed to start tracking a dismiss-drag) in two cases:
// touchstart on the drag-handle itself, or touchstart anywhere else in the
// wrapper while the scroll region's own scrollTop is already 0. That second
// condition is what keeps this from ever hijacking ordinary mid-content
// scrolling — a touch that starts below the very top of the scrolled
// content is never armed, full stop, so a downward scroll deeper in the
// list is never mistaken for a dismiss gesture. Once armed, a small
// movement threshold (ARM_MOVE_THRESHOLD_PX) further distinguishes "a real
// downward drag" from a tap or an upward scroll-back-up-to-top gesture —
// only a clear positive deltaY (finger moving down the screen) past that
// threshold ever calls preventDefault or shows live feedback; an upward
// move is left completely alone, so scrolling normally from the top still
// works exactly as before this hook existed.
//
// Live visual feedback uses the standalone CSS `translate` property, not
// `transform: translateY(...)` — WardModal's own scroll container (and its
// `position: sticky` tier headers, see useTierStack in WardModal.tsx) is a
// descendant of the wrapper this drag moves, and `transform` establishes a
// new containing block for descendants per spec, with real historical
// WebKit inconsistencies for sticky descendants of a transformed ancestor.
// `translate` (and `scale`/`rotate`) does not establish a new containing
// block, sidestepping that question entirely — this file's sibling
// component has already been bitten by one subtle cross-cutting scroll bug
// (see useTierStack's own comment on why sticky replaced a JS-collapse
// approach); this avoids risking a second one rather than assuming it away.
import { useEffect, useRef, type RefObject } from "react";

const ARM_MOVE_THRESHOLD_PX = 10; // ignores a tap/jitter before committing to a drag
const DISMISS_THRESHOLD_PX = 80; // how far the (damped) visual offset must reach to dismiss on release
const DRAG_DAMPING = 0.5; // live feedback lags the finger, same as native sheets

interface UseSwipeToDismissOptions {
  enabled: boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
  dragHandleRef: RefObject<HTMLDivElement | null>;
  scrollRootRef: RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
}

export function useSwipeToDismiss({ enabled, wrapperRef, dragHandleRef, scrollRootRef, onDismiss }: UseSwipeToDismissOptions) {
  // Read via a ref, not a dependency — same reasoning useDismissable.ts's
  // own onDismissRef gives: a fresh inline closure every render shouldn't
  // churn the listeners below.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!enabled || !wrapper) return;

    let armed = false;
    let dragging = false;
    let startY = 0;
    let currentOffset = 0;

    const reset = () => {
      armed = false;
      dragging = false;
      currentOffset = 0;
    };

    // Animates (or, under prefers-reduced-motion, snaps) the wrapper back
    // to its resting position. Only ever called to *cancel* a drag that
    // didn't cross the dismiss threshold — a drag that does cross it never
    // settles back, since the component unmounts once `onDismiss` fires.
    const settle = () => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        wrapper.style.transition = "";
        wrapper.style.translate = "";
        return;
      }
      wrapper.style.transition = "translate 150ms ease-out";
      wrapper.style.translate = "";
      const onTransitionEnd = () => {
        wrapper.style.transition = "";
        wrapper.removeEventListener("transitionend", onTransitionEnd);
      };
      wrapper.addEventListener("transitionend", onTransitionEnd);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return; // ignore multi-touch (pinch, etc.)
      const target = e.target as Node;
      const onHandle = dragHandleRef.current?.contains(target) ?? false;
      const atTop = (scrollRootRef.current?.scrollTop ?? 0) === 0;
      if (!onHandle && !atTop) return;
      armed = true;
      dragging = false;
      startY = e.touches[0].clientY;
      currentOffset = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!armed) return;
      const deltaY = e.touches[0].clientY - startY;
      if (!dragging) {
        // Still deciding — an upward move (deltaY negative, i.e. a normal
        // "scroll down through content" gesture from the top) never
        // crosses this and is left entirely alone.
        if (deltaY < ARM_MOVE_THRESHOLD_PX) return;
        dragging = true;
      }
      // Only intercept once genuinely dragging downward.
      e.preventDefault();
      currentOffset = Math.max(0, deltaY) * DRAG_DAMPING;
      wrapper.style.transition = "";
      wrapper.style.translate = `0 ${currentOffset}px`;
    };

    const onTouchEnd = () => {
      if (!dragging) {
        reset();
        return;
      }
      if (currentOffset >= DISMISS_THRESHOLD_PX) {
        onDismissRef.current();
      } else {
        settle();
      }
      reset();
    };

    wrapper.addEventListener("touchstart", onTouchStart, { passive: true });
    // Not passive — onTouchMove conditionally calls preventDefault once a
    // drag is confirmed, which passive:true would silently disallow.
    wrapper.addEventListener("touchmove", onTouchMove, { passive: false });
    wrapper.addEventListener("touchend", onTouchEnd);
    wrapper.addEventListener("touchcancel", onTouchEnd);
    return () => {
      wrapper.removeEventListener("touchstart", onTouchStart);
      wrapper.removeEventListener("touchmove", onTouchMove);
      wrapper.removeEventListener("touchend", onTouchEnd);
      wrapper.removeEventListener("touchcancel", onTouchEnd);
      wrapper.style.transition = "";
      wrapper.style.translate = "";
    };
  }, [enabled, wrapperRef, dragHandleRef, scrollRootRef]);
}
