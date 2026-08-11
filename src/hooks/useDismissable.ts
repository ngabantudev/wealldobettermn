"use client";

import { useEffect, useRef, type RefObject } from "react";

// A small, dependency-free "dismiss this popover" hook — the shared spine
// behind every hover/click-triggered popover in this app (MapThemeSelector's
// layers panel, CoverageNotice's "what this map covers" panel,
// MastheadSaying's saying-explanation panel). Sibling to useFocusTrap.ts and
// deliberately just as narrow: this hook owns exactly three things —
// Escape-to-close, outside-pointerdown-to-close, and returning focus to the
// trigger element after an *Escape*-driven close specifically (see below
// for why not every close). It does NOT own a portal, scroll lock, or ARIA
// wiring (role, aria-expanded, aria-controls, aria-describedby) — those stay
// per-component, since they differ by what kind of surface each popover
// actually is (menu-shaped vs. tooltip-shaped vs. dialog-shaped — see each
// component's own role choice). It also doesn't own *how* a surface opens
// (click, hover, focus) — only how it closes — since that varies too
// (MastheadSaying opens on hover/focus/click; the other two, click only).
//
// Before this hook existed, MapThemeSelector, CoverageNotice, and
// MastheadSaying each hand-rolled a near-identical
// `document.addEventListener("keydown"/"click", ...)` pair, each one's own
// comment pointing at the other two as "the convention." That's the
// duplication this hook replaces (design-partner overlay audit, 2026-08-08)
// — three copies of the same bug (see below) is worse than one shared fix.
//
// Why `pointerdown`, not `click`: a `click`-outside listener fires on
// pointer *up*, after the browser has already resolved a full press-drag-
// release gesture into a synthetic click at the release point. A drag that
// *starts* inside the popover (e.g. selecting the popover's own text) and
// *ends* outside it — cursor drifted off the edge before releasing — still
// fires a `click` at that outside point, which incorrectly dismissed the
// popover under the old per-component listeners. `pointerdown` fires at
// press time, at the point the gesture actually started, so a drag that
// begins inside the popover is correctly recognized as "started inside"
// regardless of where the pointer ends up.
//
// Why focus only returns on Escape, not on every close: an outside
// pointerdown is, by definition, the user already moving their attention
// (and about to move focus) somewhere else — yanking focus back to the
// trigger would fight that new destination and break normal "click
// elsewhere on the page" navigation. Escape is different: it's a keyboard
// user explicitly asking to back out of the popover with no other target in
// mind, so returning focus to the control that opened it is the expected
// behavior (matches native `<select>`/menu conventions). This distinction
// also sidesteps a real focus loop: MastheadSaying opens on focus and closes
// on blur, so a "return focus on every close" rule would have re-focused the
// trigger right after its own onBlur fired, which re-opens it via onFocus —
// an infinite loop. Scoping focus-return to the Escape path only avoids it.
//
// Usage: give the popover's outer (or hover-zone) element `ref={rootRef}` —
// it should contain both the trigger and the panel, so a pointerdown on the
// trigger itself is never mistaken for an outside click. `active` gates the
// whole hook the same way useFocusTrap's `active` does — safe to call
// unconditionally (rules of hooks). `onDismiss` is read via a ref internally
// so passing a fresh inline closure every render (the common case) doesn't
// churn the listeners.
export function useDismissable<T extends HTMLElement>(active: boolean, onDismiss: () => void): { rootRef: RefObject<T | null> } {
  const rootRef = useRef<T | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Always points at the latest onDismiss without being a dependency of the
  // effect below — the effect only needs to (re)run when `active` flips,
  // not on every render just because the caller passed a new closure.
  // Written from its own effect (not during render) — writing a ref's
  // `.current` while rendering is itself a react-hooks lint violation, even
  // though the value is never read until an event fires later.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!active) return;
    // Whatever had focus immediately before this popover opened — read
    // once per activation, same pattern as useFocusTrap.ts's own
    // triggerRef, so Escape can hand focus back to it below.
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onDismissRef.current();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Nested dismissable surfaces (e.g. CoverageNotice's popover can
      // render inside SearchBar inside MobileSheet's own trapped panel) —
      // Escape should close only the innermost open surface, not bubble up
      // and close an ancestor dialog/sheet too. stopPropagation here
      // mirrors useFocusTrap.ts's own convention on its Tab handler (see
      // that file's comment) for the same reason: whichever surface is
      // "innermost" for this keystroke is the one that should own it.
      e.stopPropagation();
      onDismissRef.current();
      // Guards against a trigger removed from the DOM while the popover
      // was open — same `document.body.contains` check useFocusTrap.ts
      // uses (see that file's own comment) rather than relying on
      // focus() being a silent no-op on a detached node.
      const trigger = triggerRef.current;
      if (trigger && document.body.contains(trigger)) trigger.focus();
    };
    // capture:true so this runs before a bubbling handler on an ancestor
    // dialog's own onKeyDown (WardModal/MobileSheet's useFocusTrap listens
    // via a React onKeyDown prop on their container, a bubble-phase
    // listener) — without capture, stopPropagation here wouldn't run in
    // time to stop that ancestor from also treating the same Escape press
    // as its own close signal.
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [active]);

  return { rootRef };
}
