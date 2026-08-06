import type { ReactNode } from "react";
import MastheadSaying from "./MastheadSaying";

// The site's identity bar — visually matched to mndatacenter.org's own
// navy/cyan header band (see globals.css's `.band` token overrides for
// the mechanism). The wordmark itself is purely presentational; the
// controls that do live here are the search bar (desktop/laptop only —
// see the `search` prop below), which AGENTS.md Part 4 calls "the
// primary interface, not the map," so it earns a permanent spot in the
// chrome rather than floating over the map where a resize or a tall
// panel could ever crowd it, and MastheadSaying's own info trigger (see
// below). Map mode, filters, and the theme popover stay off this bar —
// floating over the map on desktop, folded into MobileNav's bottom tabs
// on mobile.
//
// "We All Do Better" / "when we all do better" — wealldobettermn.org,
// this site's domain, after Paul Wellstone's line about collective
// responsibility. Split across two lines rather than one long headline
// or a hover tooltip: a tooltip (the `title`-attribute trick
// mndatacenter.org uses for its own Dakota-name headline) never reaches
// anyone on a touch device — there's no hover state on a phone — and this
// is a civic site whose own accessibility principles (AGENTS.md §0.7)
// exist for exactly that visitor. Always-visible and screen-reader-native
// beats "reward the curious." MN itself is left implicit — carried by
// the map and the domain.
//
// A third line, MastheadSaying, sits under those two: one of eight
// mottos from Minnesota's Indigenous, Somali, Hmong, and Pan-African
// diaspora communities (src/lib/mastheadSayings.ts), auto-rotating every
// hour. Same non-negotiable as the wordmark above it — the saying's own
// text is always visible, never hidden behind a hover. Only the
// *explanation* of what it means is progressive disclosure, and that's
// reachable by hover, focus, or tap (see that component) — not the
// `title=`-attribute trick this file already rejected once above.
interface SiteHeaderProps {
  // The address-search combobox (SearchBar), pre-built by WardMap so this
  // component doesn't need to know about wards/index/callbacks — same
  // "caller assembles it, this just places it" split MobileNav uses for
  // its own sheet content. Hidden below `sm` (see the wrapping div below);
  // mobile mounts its own separate SearchBar instance inside MobileNav's
  // Search tab instead, so passing it here is harmless even on a phone —
  // it just never renders.
  search: ReactNode;
}

export default function SiteHeader({ search }: SiteHeaderProps) {
  return (
    // `flex` below `sm` (just the wordmark, left-aligned — search isn't
    // shown there at all, see the wrapping div below), `grid` at `sm`+
    // with three tracks. That's not decorative: with the tagline gone,
    // the wordmark is the only other thing in this bar, and a flex row
    // with just those two children would center the search bar in the
    // space *left over after the wordmark* — which, with nothing of equal
    // weight on the right anymore, visibly skews it off the bar's true
    // center. The empty third track is what balances it: two equal
    // flexible tracks flank the search column, so it centers on the
    // header itself, not on a remainder.
    //
    // The middle track is `minmax(0,28rem)`, not `auto`: SearchBar sizes
    // itself with `w-full max-w-md` (max-w-md = 28rem), which needs a
    // track that actually *offers* it up to 28rem to fill — an `auto`
    // track sizes to its content's contribution instead, and a
    // percentage-width child measured against a still-being-computed
    // `auto` track contributes close to nothing, collapsing the whole
    // search bar down to near its placeholder text's width. `minmax(0,…)`
    // still shrinks below that on a cramped viewport, same as `auto`
    // would, so this doesn't reintroduce an overflow risk.
    <header className="band flex sm:grid sm:grid-cols-[1fr_minmax(0,28rem)_1fr] shrink-0 items-center gap-3 sm:gap-5 border-b border-hair bg-panel px-4 py-3.5 sm:px-6 sm:py-4">
      {/* Two nested boxes, doing two different jobs — one grid item ran
          into both problems below at once, and no single width value
          dodges both:
          — Outer: `min-w-0`, no explicit width, so it just takes the
            grid's default stretch — exactly the track's own resolved
            width, always, whether that's ~90px on a cramped sm-width
            window or ~460px on a wide desktop. This is what a bounding
            box needs to be to never overflow into the search column.
          — Inner: `w-fit max-w-full` — sized to its own content (so the
            subtitle's justified spacing below targets the headline's
            *actual* rendered width, not the outer's stretched-wide box —
            that mismatch was the previous bug: the huge, broken-looking
            gaps in "W H E N   W E   A L L…"), but hard-capped at 100% of
            the outer. `width:fit-content` alone still won't shrink below
            its own text's width (nowrap content's min-content is its full
            width) — `max-w-full` is what actually forces it down when the
            outer is narrower, which is what lets `truncate` below engage
            instead of visually overflowing the search column next to it. */}
      <div className="min-w-0">
        <div className="flex w-fit max-w-full flex-col justify-center gap-0.5">
          {/* text-2xl font-black uppercase tracking-tight leading-none —
              the exact class list mndatacenter.org's own masthead headline
              uses (its FilterHeader.astro, the h1 that crossfades
              "Minnesota"/"Mni Sóta Makoce"). `truncate`, not their
              `whitespace-nowrap`: their headline sits in a fixed-width
              sidebar; this one's in a flexible top bar next to the search
              bar, so it still needs a safety valve on a narrow viewport. */}
          <span className="truncate text-2xl font-black uppercase tracking-tight leading-none text-ink">We All Do Better</span>
          {/* The completion, not a repeat — lowercase and small so it reads
              as one phrase continuing (and finishing) the bold line above,
              not a second competing headline. `text-justify` +
              `text-align-last:justify` spread its word-spacing to fill
              exactly the headline's own width: the inner box's flex-col
              default (align-items: stretch) sizes this span to match the
              headline above it, and the inner box itself is now sized to
              that same content (see the outer/inner split above) — nothing
              here sets a width directly, so it can't drift out of sync if
              the headline's text or size ever changes. */}
          <span className="block truncate text-[13px] uppercase tracking-[0.13em] text-ink-3 text-justify [text-align-last:justify]">when we all do better</span>
        </div>
        {/* Deliberately outside the `inner` box above, as its own sibling
            — not a third child of it. That box is sized with `w-fit` so
            its width tracks the *headline's* own text (see the comment
            above it), which the subtitle's justified spacing depends on;
            a saying can run longer than "We All Do Better" (some of the
            eight do), and if it were a child there its width would feed
            into that same fit-content calculation and widen the box past
            the headline, breaking the subtitle's alignment again. Sitting
            here instead, it truncates against the *outer* box's full
            stretched width — more room than the headline gets, which is
            the right amount for a longer, independent line — without
            touching the inner box's sizing at all. */}
        <MastheadSaying />
      </div>
      {/* Desktop/laptop only. Below `sm`, MobileNav's Search tab is the
          reachable-in-one-tap equivalent — there's no width here to spare
          for an inline search box once the bottom nav takes over, and
          AGENTS.md Part 4 only asks that search stay one interaction away
          on every breakpoint, not that it live in the same place on all of
          them. */}
      <div className="hidden min-w-0 sm:flex">{search}</div>
    </header>
  );
}
