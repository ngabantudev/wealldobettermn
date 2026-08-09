"use client";

import { useEffect } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

// Small, generic Cancel/Confirm dialog — the app's first non-native
// confirm surface. Deliberately narrow in scope, matching useFocusTrap's
// own "no portal, no scroll-lock, no generic dialog manager" posture:
// this renders inline (no createPortal) since every call site today
// mounts it from a component already near the top of the DOM (a sidebar
// panel, a bottom sheet) where stacking context isn't in question. Add a
// portal later if a call site ever needs to escape a clipping ancestor.
//
// Reusable on purpose — AreaFilterList's "turn on every county" switch is
// the first caller, but the props here name nothing city/ward-specific.
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Always called (rules of hooks) — the hook itself no-ops while
  // `active` (here, `open`) is false, same contract WardModal's "sidebar"
  // variant already relies on.
  const { containerRef, onKeyDown } = useFocusTrap<HTMLDivElement>(open);

  // Escape-to-cancel — useFocusTrap only ever handles Tab, so this dialog
  // needs its own listener for the other half of "Keyboard Complete"
  // (AGENTS.md §4). Scoped to `open` in the dependency array so it's
  // never attached while the dialog isn't rendered.
  useEffect(() => {
    if (!open) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    // Fixed, centered overlay — floats above whatever called it (map,
    // sidebar, bottom sheet) regardless of that ancestor's own scroll
    // position. p-4 keeps the panel off the viewport edge on the
    // narrowest phones; sm:items-center vs. the mobile-first flex above
    // both center it — the panel's own max-w-sm + w-full is what actually
    // does the mobile/laptop responsive sizing (full-width card on a
    // narrow phone, capped at 24rem everywhere wider).
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop click cancels, same as Escape — never confirms; a
          destructive/consequential action should only ever fire from an
          explicit tap on the Confirm button itself. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        className="relative w-full max-w-sm rounded-2xl border border-hair bg-panel-2 shadow-2xl shadow-(color:--shadow-panel) p-5"
      >
        <h2 id="confirm-dialog-title" className="text-base font-bold text-ink">
          {title}
        </h2>
        <p id="confirm-dialog-message" className="mt-2 text-sm text-ink-3">
          {message}
        </p>
        {/* Stacks full-width on mobile (two comfortably tappable 44px-tall
            targets, AGENTS.md §4's touch-target floor), sits side by side
            from sm: up — matching how the rest of the app's own action
            rows switch layout at that breakpoint. */}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-hair-strong px-4 py-2.5 sm:py-1.5 text-sm font-semibold text-ink-2 hover:bg-sidebar-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-accent px-4 py-2.5 sm:py-1.5 text-sm font-semibold text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
