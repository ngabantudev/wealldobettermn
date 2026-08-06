"use client";

// This *is* the masthead text now — not a line added under the wordmark,
// a replacement for it. One of eight sayings from Minnesota's Indigenous,
// Somali, Hmong, and Pan-African diaspora communities (full text +
// sourcing note in mastheadSayings.ts), rendered at the weight the old
// static "We All Do Better" wordmark used to occupy, swapped once an
// hour. The saying itself is always on screen, in full, in the language
// it was given in — never hidden behind an interaction, same rule the old
// wordmark followed (see SiteHeader.tsx's own comment), and never
// truncated: `mastheadSayings.ts`'s `lines` field pre-breaks each saying
// at hand-picked points (same move as "We All Do Better" / "when we all
// do better" itself used to be two lines), and the font size below is
// fluid (`clamp`) rather than fixed, so a long saying shrinks to fit
// instead of clipping. Only the *explanation* is progressive disclosure:
// hovering the text opens it — no separate icon, the text itself is the
// trigger — a tap opens it too (the only way in on a touch device, which
// has no hover state), same click-outside/Escape/useId dismiss convention
// CoverageNotice.tsx and MapThemeSelector.tsx already use elsewhere in
// this app.
//
// The root div below is `w-fit`, not left to default block width: a bare
// block element fills whatever the grid track offers it, which made the
// hover/focus zone (bound to this div, so the panel doesn't close while
// the pointer crosses from trigger to panel) extend well past the
// visible text — hoverable dead space with nothing under it. `w-fit`
// (capped by `max-w-full` so a curated line can still wrap further as a
// last resort on a viewport narrower than it was chosen for) keeps that
// zone sized to what's actually on screen.
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
// saying appears a tick after mount; the placeholder below reserves one
// line's height so that tick isn't a visible pop for the (common)
// one-line sayings, though a two- or three-line one will still grow the
// header slightly once it resolves. The effect also arms a timer for the
// next hour boundary, so a tab left open rotates live instead of only on
// next load/navigation.

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
  // invisible spacer at one line's height, not `null`, so the header
  // doesn't visibly grow by a line once this resolves a tick after mount.
  if (index === null) return <span aria-hidden="true" className="block h-8" />;

  const saying = MASTHEAD_SAYINGS[index];

  // TESTING ONLY: a click/tap also advances to the next saying, so all
  // eight are reachable in a few taps instead of waiting for real hour
  // boundaries or faking the clock. This overrides the hour-derived index
  // in local state only — the effect above still re-syncs to the real
  // `currentSayingIndex()` at the next hour boundary, so a manual click
  // never permanently detaches this from the clock. Remove this override
  // (leave the rest of the click handler — it still needs to open the
  // popover for touch, which has no hover) once this has been reviewed
  // across all eight and the demo need is gone.
  const rotate = () => {
    setIndex((i) => (i === null ? 0 : (i + 1) % MASTHEAD_SAYINGS.length));
    setOpen(true);
  };

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
        onClick={rotate}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // `clamp(1.1rem, 4vw, 1.5rem)`, not a fixed `text-2xl`: 1.5rem is
        // the old wordmark's own size, kept as the ceiling, but the sayings
        // run longer than "We All Do Better" did — the `4vw` middle term
        // lets the glyphs themselves shrink on a narrow track (a phone, or
        // the compressed left column once the search bar claims its
        // minmax(0,28rem) at sm+) rather than ever needing to truncate.
        className="flex w-fit max-w-full flex-col rounded text-left text-[clamp(1.1rem,4vw,1.5rem)] leading-tight font-black tracking-tight text-ink uppercase underline decoration-2 decoration-dotted decoration-ink-4/70 underline-offset-4 transition hover:text-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {saying.lines.map((line, i) => (
          <span key={i} className="block wrap-break-word">
            {line}
          </span>
        ))}
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
          aria-label={`What "${saying.quote}" means`}
          className="well absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-1.5 rounded-xl border p-3 text-xs text-ink-3 shadow-xl shadow-(color:--shadow-panel)"
        >
          <p className="font-medium text-ink-2">{saying.community}</p>
          {saying.translation && <p className="italic">{saying.translation}</p>}
          <p>{saying.meaning}</p>
        </div>
      )}
    </div>
  );
}
