"use client";

// The implementation of AGENTS.md §3.3's "What this map can't see" —
// rendered inside SearchBar's own input row (a small icon at the end, next
// to the search icon at the start) so it's reachable in the same motion as
// searching, not a footnote someone would have to go looking for.
//
// A single tap away, not zero taps: this used to be an always-visible
// sentence under the input, which — once the search bar moved into the
// topbar (see SearchBar.tsx's own comment) — was the single biggest thing
// keeping that bar taller than a normal toolbar row. Folding it behind an
// icon is the same progressive-disclosure move this component already
// made for its own detail section (the old "See what's covered" toggle,
// now just always part of what the icon opens) — not a reduction in what
// gets said, just where the second sentence starts. The icon itself is
// permanent and clearly labeled, which is what keeps this an honest
// disclosure rather than a buried one: AGENTS.md's coverage-honesty rule
// asks for a persistent, reachable answer, not that it always be printed
// on screen unasked.
//
// Every fact below comes from src/lib/coverage.ts, not retyped here, so
// this component can't quietly say something the data no longer backs up.

import { Info } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { useDismissable } from "@/hooks/useDismissable";
import { touchTargetClass } from "@/lib/variantClasses";
import {
  CITY_BOUNDARIES_NOTE,
  COMMISSIONER_COUNTIES_LIST,
  MEETINGS_NOTE,
  NOT_COVERED_ANYWHERE,
  STATE_LEGISLATURE_NOTE,
  WARD_CITIES,
} from "@/lib/coverage";

export default function CoverageNotice() {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Escape and outside-pointerdown both close it — shared with every other
  // popover in this app now (see useDismissable.ts's own header comment for
  // why this used to be three hand-rolled copies of the same effect).
  const close = useCallback(() => setOpen(false), []);
  const { rootRef } = useDismissable<HTMLDivElement>(open, close);

  return (
    <div ref={rootRef} className="relative shrink-0">
      {/* Visible glyph stays a small 24×24px circle — matching the search
          icon it sits next to in SearchBar's input row (see that file) —
          but touchTargetClass grows the tappable hit area to 44px on
          mobile, collapsing back to the glyph's own box at sm+. */}
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="What this map covers"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-6 w-6 items-center justify-center rounded-full text-ink-3 transition hover:bg-hover hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${touchTargetClass(24)}`}
      >
        <Info aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
      </button>

      {open && (
        // z-20, one rung above the suggestions listbox/message panel (z-10,
        // see SearchBar.tsx) — the two are independently positioned (this
        // anchors to the icon button, that spans the full input row) and
        // rarely open at once, but if they ever do, the deliberate "I asked
        // what this covers" action should read on top.
        <div
          id={panelId}
          role="dialog"
          aria-label="What this map covers"
          // Opens upward by default, downward at sm+ — this component only
          // ever renders in two places (see SearchBar.tsx): the header on
          // desktop, where the button sits near the top of the screen with
          // room below it, or MobileNav's Search sheet, where it sits just
          // above the bottom nav with almost no room below at all. Same
          // flip MapThemeSelector's own popover uses, just inverted, since
          // that one's toggle sits at the opposite corner.
          // w-72 with a max-w viewport clamp — same idiom MastheadSaying's
          // own info popover already uses (see that component) — so a
          // right-0-anchored w-72 (288px) panel can't overflow the left
          // edge of a narrow phone (e.g. iPhone SE's 320px width inside a
          // px-3 mobile sheet leaves less than 288px of room).
          className="well absolute right-0 bottom-full z-20 mb-2 w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border p-3 text-xs text-ink-3 shadow-xl shadow-(color:--shadow-panel) sm:bottom-auto sm:top-full sm:mb-0 sm:mt-2"
        >
          <p>
            City and county rep data covers <strong className="font-semibold text-ink-2">{WARD_CITIES.length} Minnesota cities</strong>{" "}
            — not every city in the state. State legislature coverage is statewide; see below for what&apos;s still missing there.
          </p>
          <div className="space-y-1.5 border-t border-hair pt-2">
            <p>
              <span className="font-medium text-ink-2">City limits</span> — {CITY_BOUNDARIES_NOTE}
            </p>
            <p>
              <span className="font-medium text-ink-2">City council &amp; mayor</span> — {WARD_CITIES.join(", ")}.
            </p>
            <p>
              <span className="font-medium text-ink-2">County commissioner</span> — {COMMISSIONER_COUNTIES_LIST} Counties
              only.
            </p>
            <p>
              <span className="font-medium text-ink-2">State legislature</span> — {STATE_LEGISLATURE_NOTE}
            </p>
            <p>
              <span className="font-medium text-ink-2">Meetings &amp; agendas</span> — {MEETINGS_NOTE} See{" "}
              <a href="/meetings" className="underline underline-offset-2 hover:text-ink-2">
                /meetings
              </a>{" "}
              for the full browser.
            </p>
            <p>
              <span className="font-medium text-ink-2">Not covered anywhere yet</span> — {NOT_COVERED_ANYWHERE.join("; ")}.
            </p>
            <p>Search still recognizes any Minnesota city or county by name — it will just say honestly when we do not have it yet.</p>
          </div>
        </div>
      )}
    </div>
  );
}
