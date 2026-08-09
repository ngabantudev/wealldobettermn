"use client";

// This *is* the masthead text now — not a line added under the wordmark,
// a replacement for it. One of nine sayings — the site's own English
// name plus eight from Minnesota's Indigenous, Somali, Hmong, and
// Pan-African diaspora communities (full text + sourcing note in
// mastheadSayings.ts) — rendered at the weight the old static "We All Do
// Better" wordmark used to occupy, swapped once an hour. The saying
// itself is always on screen, in full, on one line, never truncated and
// never wrapped: SiteHeader now holds a *fixed* height (so the topbar
// never grows or shrinks as the rotation changes what's showing), and
// this component grows *sideways* instead — `whitespace-nowrap`, and its
// own root is the flex item that gets whatever width SiteHeader's row
// leaves it (see the outer div below), not a fixed share.
//
// The font size is computed per saying, not a static viewport-based
// `clamp()` (an earlier revision used one): a `vw`-only formula has no
// way to know how much room *this specific* saying's actual box has —
// it doesn't account for the search bar sitting next to it, so it either
// undershoots (short sayings render smaller than they need to) or, worse,
// overshoots on a long saying at a narrow width. That overshoot wasn't
// theoretical: with the fixed-height/no-wrap change, a too-wide clamp
// value on the longest saying got silently clipped by WardMap's own root
// `overflow-hidden` (nothing else in the page scrolls horizontally
// either) — worse than the truncation this whole feature removed,
// because there wasn't even an ellipsis to signal it was cut. The
// `useLayoutEffect` below instead measures the *actual* box width the
// flex layout gave this saying (`outerRef.clientWidth`) against the
// text's natural width at the ceiling size (1.5rem, the old wordmark's
// own), and scales the font down only exactly as much as that specific
// box requires — a short saying like "Asemaa / Akiing" still renders at
// full size next to the same search bar that shrinks a long one. It
// reruns on every saying change and on any resize via `ResizeObserver`.
// `useLayoutEffect`, not `useEffect`: it fires before the browser paints,
// so there's no visible flash of the wrong size on either a rotation or
// a viewport resize. The `clamp()` in the button's className is now just
// a same-ballpark default for the instant before that first effect runs.
//
// Two nested boxes below, not one, same reason CoverageNotice's own
// trigger stays separate from the panel it opens: `outerRef` is the
// actual flex child and the ResizeObserver's target — it can be wider
// than the visible text (flexbox may hand it leftover space to grow
// into). The inner box (`rootRef`, from useDismissable — see that hook's
// own comment), nested inside, is `w-fit` — sized to exactly the rendered
// text — and is what mouseenter/mouseleave/outside-pointerdown bind to, so
// the hover/tap zone never extends into that leftover dead space the way
// it did before this same fix was made for a different reason (see this
// file's git history: the outer box used to *be* the hover zone, and a
// full-width block div caught hovers well past the text).
//
// Only the *explanation* is progressive disclosure: hovering the text
// opens it — no separate icon, the text itself is the trigger — a tap
// opens it too (the only way in on a touch device, which has no hover
// state), same Escape/outside-pointerdown/useId dismiss convention
// (useDismissable.ts) CoverageNotice.tsx and MapThemeSelector.tsx also use.
//
// Rotation is `floor(hoursSinceEpoch) % length` (mastheadSayings.ts), not
// random — every visitor sees the same saying in the same clock hour, and
// it needs no per-visitor state to be reproducible. `index` starts as
// `null` and is only set inside the sync effect below: this component
// renders inside WardMap's "use client" tree, which Next.js still
// server-renders for the initial HTML, and "what hour is it" can differ
// between the server's clock and the moment a browser hydrates. Starting
// both the server render and the first client render from the same
// `null` (nothing shown) sidesteps that mismatch instead of racing it.
// The effect also arms a timer for the next hour boundary, so a tab left
// open rotates live instead of only on next load/navigation.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useDismissable } from "@/hooks/useDismissable";
import { currentSayingIndex, MASTHEAD_SAYINGS } from "@/lib/mastheadSayings";

const HOUR_MS = 60 * 60 * 1000;
const MAX_FONT_PX = 24; // 1.5rem — the old wordmark's own size, kept as the ceiling
const MIN_FONT_PX = 8; // a defensive floor, not a target: real phone widths never need to get this low

export default function MastheadSaying() {
  const [index, setIndex] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [fontPx, setFontPx] = useState(MAX_FONT_PX);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLButtonElement | null>(null);
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

  // Escape and outside-pointerdown both close it — shared with every other
  // popover in this app now (see useDismissable.ts). `rootRef` below is
  // handed to the hover-zone div (the `w-fit` one, not the flex-sized outer
  // one — see the header comment on why those two are separate boxes), the
  // same box that used to anchor this component's own hand-rolled
  // click-outside listener.
  //
  // Note this hook only wires Escape/outside-pointerdown — the
  // hover/focus/blur open+close logic below (onMouseEnter/onMouseLeave/
  // onFocus/onBlur) stays local to this component, same as
  // useDismissable.ts's own comment says it should: how a surface *opens*,
  // and non-hook-owned ways it *closes*, are per-component by design.
  const close = useCallback(() => setOpen(false), []);
  const { rootRef } = useDismissable<HTMLDivElement>(open, close);

  // The fit calculation described up top. Depends on `index` (a new
  // saying needs re-measuring) and reruns on resize via ResizeObserver —
  // both `outerRef` (this saying's actual box) and `textRef` (the
  // rendered line) exist by the time this runs, since the fallback
  // `index === null` return below happens before this component ever
  // reaches this hook's dependent render.
  useLayoutEffect(() => {
    if (index === null) return;
    const outer = outerRef.current;
    const text = textRef.current;
    if (!outer || !text) return;

    const fit = () => {
      const currentPx = parseFloat(getComputedStyle(text).fontSize) || MAX_FONT_PX;
      // `scrollWidth` on a `whitespace-nowrap` element is the text's full
      // intrinsic width at whatever font size is currently applied,
      // regardless of the box's own (possibly narrower) width — exactly
      // the "natural width" this needs, with no separate measurement node.
      const naturalAtCurrent = text.scrollWidth;
      const naturalAtMax = currentPx > 0 ? (naturalAtCurrent / currentPx) * MAX_FONT_PX : naturalAtCurrent;
      // 0.96, not 1: a sliver of margin so a 1px rounding difference
      // between the measured and the painted width can't tip it back
      // into overflow.
      const available = outer.clientWidth * 0.96;
      const scale = naturalAtMax > 0 && available > 0 ? Math.min(1, available / naturalAtMax) : 1;
      setFontPx(Math.max(MIN_FONT_PX, MAX_FONT_PX * scale));
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [index]);

  // Nothing to show pre-mount (see the hydration note above) — an
  // invisible spacer, not `null`, matching the header's own fixed line
  // height so nothing shifts once this resolves a tick after mount. Still
  // `flex-1 min-w-0`: it needs to occupy the same flex slot the real
  // content will, or the search bar next to it would jump position once
  // this resolves.
  if (index === null) return <div aria-hidden="true" className="h-7 min-w-0 flex-1" />;

  const saying = MASTHEAD_SAYINGS[index];

  // Kept, deliberately, as a real feature rather than removed as dev-only
  // scaffolding (2026-08-08 overlay-audit pass — see AGENTS.md §3.4 on
  // human review of AI-touched code for why this decision is written down
  // rather than just made silently): a click/tap both opens the popover
  // (the only way in on a touch device, which has no hover state — that
  // part was never optional) *and* advances to the next saying. The
  // advance was originally flagged "TESTING ONLY," but a click needed to
  // open the popover for touch parity regardless, and letting that same
  // tap also surface a different one of the site's nine community sayings
  // turns an otherwise-inert popover trigger into a small, honest way to
  // discover the others — nothing here fabricates or hides data (AGENTS.md
  // §3.1/§0.9), it just makes the rotation resident-driven instead of only
  // clock-driven. This overrides the hour-derived index in local state
  // only — the sync effect above still re-syncs to the real
  // `currentSayingIndex()` at the next hour boundary, so a manual click
  // never permanently detaches this from the clock.
  const rotate = () => {
    setIndex((i) => (i === null ? 0 : (i + 1) % MASTHEAD_SAYINGS.length));
    setOpen(true);
  };

  return (
    <div ref={outerRef} className="min-w-0 flex-1">
      <div
        ref={rootRef}
        className="relative w-fit"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          ref={textRef}
          type="button"
          // No aria-haspopup here — that attribute specifically means "this
          // control opens a menu," which this never was: it opens on
          // hover/focus, not just click, and closes on blur (see the panel
          // below's role="tooltip" for the same reasoning). aria-describedby
          // is the correct wiring for "a button whose meaning is expanded
          // on by a nearby bit of text" — see below.
          aria-expanded={open}
          aria-describedby={open ? panelId : undefined}
          onClick={rotate}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          style={{ fontSize: `${fontPx}px` }}
          // The className's own `clamp()` only matters for the instant
          // before the layout effect above runs (or if JS is somehow
          // unavailable) — the inline `style` from `fontPx` overrides it
          // as soon as the real measurement lands. `whitespace-nowrap`,
          // not `truncate`: this line is never allowed to wrap or clip —
          // the header's own fixed height (SiteHeader.tsx) exists
          // specifically so this can grow *sideways* instead of down, and
          // the fit calculation above is what keeps that growth inside
          // the room it actually has.
          className="w-fit rounded text-left text-[clamp(1.1rem,4vw,1.5rem)] leading-none font-black tracking-tight text-ink whitespace-nowrap uppercase underline decoration-2 decoration-dotted decoration-ink-4/70 underline-offset-4 transition hover:text-ink-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {saying.quote}
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
            // role="tooltip", not "dialog": this panel opens on hover/focus
            // and closes on blur — a screen-reader user can never actually
            // "enter" it the way `dialog` semantics imply (a dialog is
            // expected to receive focus and be navigable; this one is
            // dismissed by the exact act of tabbing into it). `tooltip` is
            // what aria-describedby (on the trigger button above) expects
            // to point at, and matches how this content actually behaves:
            // supplementary text describing the trigger, not a separate
            // interactive surface.
            role="tooltip"
            className="well absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-1.5 rounded-xl border p-3 text-xs text-ink-3 shadow-xl shadow-(color:--shadow-panel)"
          >
            <p className="font-medium text-ink-2">{saying.community}</p>
            {saying.translation && <p className="italic">{saying.translation}</p>}
            <p>{saying.meaning}</p>
          </div>
        )}
      </div>
    </div>
  );
}
