"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

// A small, dependency-free focus trap for the app's two hand-rolled
// dialog-shaped surfaces — WardModal's "sheet" variant and MobileNav's
// bottom sheet (see AGENTS.md §4 "Keyboard Complete" and issue #79, which
// rejected a shadcn/Radix retrofit for everything *except* this one real
// bug). Deliberately not a generic "dialog manager": no portal, no
// scroll-lock, no ARIA wiring — those are already handled per-component
// (scrim, `role="dialog"`, Escape-close). This hook only does the one
// thing that was missing: keep Tab/Shift+Tab inside the open surface, put
// focus into it on open, and give focus back to whatever triggered it on
// close.
//
// Usage: spread `onKeyDown` onto the dialog's outermost element and give
// that same element `ref={containerRef}`. `active` should track whatever
// boolean already gates the surface being open/rendered — this hook does
// nothing while it's false, so it's safe to call unconditionally (rules of
// hooks) even from a component that also renders in a non-dialog variant
// (WardModal's "sidebar" variant, for one).
export function useFocusTrap<T extends HTMLElement>(
  active: boolean,
): { containerRef: RefObject<T | null>; onKeyDown: (e: KeyboardEvent<T>) => void } {
  const containerRef = useRef<T | null>(null);
  // Whatever had focus immediately before this surface opened — a map
  // marker button, a nav tab, the search field — so closing gives it back
  // rather than dropping focus to <body>. Read once per activation, not
  // per render.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Only steal focus if it isn't already inside the container — a
    // surface that autofocuses one of its own fields on mount (none do
    // today, but this keeps the hook from fighting a future one) should
    // win over this hook's own "first focusable" default.
    if (!container.contains(document.activeElement)) {
      const first = focusableIn(container)[0] ?? container;
      first.focus();
    }

    return () => {
      const trigger = triggerRef.current;
      // Guards against a trigger that was itself removed from the DOM
      // while the dialog was open (e.g. the ward pin it was opened from
      // no longer exists after a re-render) — focus() on a detached node
      // is a silent no-op, but the DOM-membership check reads clearer
      // than relying on that.
      if (trigger && document.body.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [active]);

  const onKeyDown = (e: KeyboardEvent<T>) => {
    if (!active || e.key !== "Tab") return;
    const container = containerRef.current;
    if (!container) return;
    const items = focusableIn(container);
    if (items.length === 0) {
      // Nothing focusable inside (shouldn't happen — every real dialog
      // here has at least a close button or a form field) — don't let
      // Tab escape to the page behind it anyway.
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey) {
      if (activeEl === first || !container.contains(activeEl)) {
        e.preventDefault();
        last.focus();
      }
    } else if (activeEl === last || !container.contains(activeEl)) {
      e.preventDefault();
      first.focus();
    }
    // Stops here rather than bubbling to an ancestor's own trap — WardModal
    // renders nested inside MobileNav's sheet on mobile, and each owns its
    // own instance of this hook. The innermost active trap (whichever
    // dialog Tab was actually pressed inside) is the one that should own
    // the keystroke.
    e.stopPropagation();
  };

  return { containerRef, onKeyDown };
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}
