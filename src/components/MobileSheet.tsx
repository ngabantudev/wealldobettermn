"use client";

// A raised panel directly above MobileBottomNav's global bar — the sheet
// half of what used to be one component (MobileNav.tsx, before the mobile
// chrome redesign that made the bottom bar itself a global, always-mounted
// nav rather than a map-page-only tab strip). This component owns only the
// scrim, the raised panel, focus trap, and Escape-to-close; it has no idea
// what's inside it or who opened it — two independent call sites mount
// their own instance (SiteHeader's Search trigger, WardMap's Filters
// trigger + its own priority ward/rep modal), each passing `content` and
// `onDismiss`. See src/lib/mobileSheetCoordinator.tsx for how those two
// independent mount sites stay mutually exclusive (only one raised at a
// time) — this component itself has no opinion on that; it just renders
// whatever `content` it's given, or nothing if `content` is null.
//
// The scrim still intentionally blocks whatever's underneath (pointer-
// events and all) whenever open — same rationale MobileNav.tsx used to
// state: a resident can't interact with the page behind an open sheet,
// they have to close first (tap the scrim, tap the trigger again, or hit
// Escape). That's unchanged by the bottom-nav split.
import { useEffect, useId, type ReactNode } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface MobileSheetProps {
  // Whatever belongs in the sheet right now, or null for "closed." A
  // ReactNode rather than a lookup-by-id — same reasoning MobileNav.tsx's
  // own comment used to give: the caller already knows exactly what to
  // show, no reason to make this component re-derive that.
  content: ReactNode;
  onDismiss: () => void;
}

export default function MobileSheet({ content, onDismiss }: MobileSheetProps) {
  const open = content !== null;
  const sheetId = useId();

  // Focus-trap gap fix (issue #79, carried over from MobileNav.tsx) — keeps
  // Tab/Shift+Tab inside this raised sheet while it's open, moves focus in
  // on open, and gives it back to whichever trigger opened it on close. When
  // this sheet's content is WardModal's "sheet" variant, that component runs
  // its own instance of this same hook scoped to just its own card; that
  // inner trap's keydown handler stops propagation before it reaches this
  // outer one, so the two don't fight over the same Tab keystroke — see
  // useFocusTrap's own stopPropagation comment.
  const { containerRef, onKeyDown } = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKeyDownEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDownEscape);
    return () => document.removeEventListener("keydown", onKeyDownEscape);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div className="sm:hidden">
      <div className="fixed inset-0 z-30 bg-black/25" aria-hidden="true" onClick={onDismiss} />
      {/* Positioned directly above MobileBottomNav's bar via the same
          --mobile-nav-height variable that bar now publishes (moved from
          this component — see MobileBottomNav.tsx). z-40, matching that
          bar's own rung: both need to clear the z-30 scrim above, and
          they're visually stacked (bar below, sheet above it), never
          contending with each other for the same pixels regardless of
          which one numerically "wins." */}
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        style={{ bottom: "var(--mobile-nav-height)" }}
        className="fixed inset-x-0 z-40 flex flex-col font-sans"
      >
        {/* No height cap or overflow-auto on this wrapper itself, on
            purpose — see MobileNav.tsx's own former comment on this: a
            popover anchored to a short row inside `content` (e.g.
            SearchBar's suggestions listbox) is `position: absolute` and
            doesn't contribute to this wrapper's own content-based sizing.
            Every actual sheet body already caps and scrolls itself where
            it genuinely needs to (WardModal's max-h-[75vh], the Filters
            city list's max-h-[45vh]). */}
        <div id={sheetId} className="px-3 pb-2 pt-2">
          {content}
        </div>
      </div>
    </div>
  );
}
