"use client";

// This *is* the masthead text now — not a line added under the wordmark,
// a replacement for it. One of eight sayings from Minnesota's Indigenous,
// Somali, Hmong, and Pan-African diaspora communities (full text +
// sourcing note in mastheadSayings.ts), rendered at the size/weight the
// old static "We All Do Better" wordmark used to occupy, swapped once an
// hour. The saying itself is always on screen, in the language it was
// given in — never hidden behind an interaction, same rule the old
// wordmark followed (see SiteHeader.tsx's own comment). Only the
// *explanation* is progressive disclosure: hover or focus opens it (a
// shortcut for a mouse or keyboard user), a tap opens it too (the only
// way in on a touch device, which has no hover state) — the same
// click-outside/Escape/useId dismiss convention CoverageNotice.tsx and
// MapThemeSelector.tsx already use elsewhere in this app, reused rather
// than reinvented.
//
// The root div below is `w-fit`, not left to default block width: a bare
// block element fills whatever the grid track offers it, which made the
// hover/focus zone (bound to this div, so the panel doesn't close while
// the pointer crosses from trigger to panel) extend well past the
// visible text — hoverable dead space with nothing under it. `w-fit`
// (capped by `max-w-full` so it still yields to `truncate` on a cramped
// viewport) keeps that zone sized to what's actually on screen.
//
// Rotation is `floor(hoursSinceEpoch) % length` (mastheadSayings.ts), not
// random — every visitor sees the same saying in the same clock hour, and
// it needs no per-visitor state to be reproducible. `index` starts as
// `null` and is only set inside the effect below: this component renders
// inside WardMap's "use client" tree, which Next.js still server-renders
// for the initial HTML, and "what hour is it" can differ between the
// server's clock and the moment a browser hydrates. Starting both the
// server render and the first client render from the same `null`
// (nothing shown) sidesteps that mismatch instead of racing it — the real
// saying appears a tick after mount; the placeholder below reserves the
// headline's usual height so that tick isn't a visible pop. The effect
// also arms a timer for the next hour boundary, so a tab left open
// rotates live instead of only on next load/navigation.

import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { currentSayingIndex, MASTHEAD_SAYINGS } from "@/lib/mastheadSayings";

const HOUR_MS = 60 * 60 * 1000;

export default function MastheadSaying() {
  const [index, setIndex] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const sync = () => {
      setIndex(currentSayingIndex());
      timeoutId = setTimeout(sync, HOUR_MS - (Date.now() % HOUR_MS));
    };
    sync();
    return () => clearTimeout(timeoutId);
  }, []);

  // Click-outside and Escape both close it — same dismiss convention as
  // every other popover in this app (CoverageNotice's own).
  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Nothing to show pre-mount (see the hydration note above) — an
  // invisible spacer at the headline's own height, not `null`, so the
  // header doesn't visibly grow by a line once this resolves a tick
  // after mount.
  if (index === null) return <span aria-hidden="true" className="block h-8" />;

  const saying = MASTHEAD_SAYINGS[index];

  return (
    <div
      ref={rootRef}
      className="relative w-fit max-w-full"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // text-2xl font-black uppercase tracking-tight leading-none —
        // the exact class list the old "We All Do Better" wordmark used
        // (itself copied from mndatacenter.org's own masthead headline,
        // see the retired comment in SiteHeader.tsx's history) — this
        // occupies the same visual slot, so it keeps the same weight.
        className="inline-flex max-w-full items-center gap-1.5 rounded text-2xl font-black uppercase tracking-tight leading-none text-ink underline decoration-2 decoration-dotted decoration-ink-4/70 underline-offset-4 transition hover:text-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="min-w-0 truncate">“{saying.quote}”</span>
        <Info aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2} />
      </button>

      {open && (
        // z-50, not the z-20 CoverageNotice/MapThemeSelector use: this
        // panel opens *downward*, past the header's own bottom edge, into
        // the map wrapper's territory — and WardMap.tsx's z-index scale
        // tops out at 40 (mobile nav). z-20 here collided directly with
        // the desktop filter stack (also z-20, see WardMap.tsx): same
        // value, no shared stacking-context ancestor to arbitrate, so it
        // came down to DOM order, and the filter stack (later in the
        // tree) painted over this panel and clipped it. z-50 sits above
        // every rung in that scale on purpose, per WardMap.tsx's own note
        // on this exception.
        <div
          id={panelId}
          role="dialog"
          aria-label={`What “${saying.quote}” means`}
          className="well absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-1.5 rounded-xl border p-3 text-xs text-ink-3 shadow-xl shadow-(color:--shadow-panel)"
        >
          <p className="font-medium text-ink-2">{saying.community}</p>
          {saying.translation && <p className="italic">“{saying.translation}”</p>}
          <p>{saying.meaning}</p>
        </div>
      )}
    </div>
  );
}
