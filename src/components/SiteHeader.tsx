import type { ReactNode } from "react";
import MastheadSaying from "./MastheadSaying";

// The site's identity bar — visually matched to mndatacenter.org's own
// navy/cyan header band (see globals.css's `.band` token overrides for
// the mechanism). The controls that live here are the search bar
// (desktop/laptop only — see the `search` prop below), which AGENTS.md
// Part 4 calls "the primary interface, not the map," so it earns a
// permanent spot in the chrome rather than floating over the map where a
// resize or a tall panel could ever crowd it, and MastheadSaying's own
// info trigger (see below). Map mode, filters, and the theme popover stay
// off this bar — floating over the map on desktop, folded into
// MobileNav's bottom tabs on mobile.
//
// The masthead text *is* MastheadSaying: one of eight mottos from
// Minnesota's Indigenous, Somali, Hmong, and Pan-African diaspora
// communities (src/lib/mastheadSayings.ts), auto-rotating every hour,
// rendered at the size/weight a static wordmark used to occupy here.
// (That wordmark — "We All Do Better" / "when we all do better," a nod
// to wealldobettermn.org's own domain and Paul Wellstone's line about
// collective responsibility — is retired from this spot, not deleted
// from the project; it belongs on /about if it needs a home there.) Same
// non-negotiable that wordmark held: the saying's own text is always
// visible, never hidden behind a hover. Only the *explanation* of what it
// means is progressive disclosure, reachable by hover, focus, or tap (see
// that component) — not the `title=`-attribute trick mndatacenter.org
// uses for its own Dakota-name headline and this app has never adopted.
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
    // `flex` below `sm` (just MastheadSaying, left-aligned — search isn't
    // shown there at all, see the wrapping div below), `grid` at `sm`+
    // with three tracks. That's not decorative: with the tagline gone,
    // MastheadSaying is the only other thing in this bar, and a flex row
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
      {/* `min-w-0`, no explicit width: takes the grid's default stretch —
          exactly the track's own resolved width, always, whether that's
          ~90px on a cramped sm-width window or ~460px on a wide desktop.
          This is what a bounding box needs to be to never overflow into
          the search column. MastheadSaying sizes and truncates itself
          independently inside it (it's `w-fit max-w-full` on its own
          root, see that component) — this wrapper's only job is capping
          how much room it's allowed, same as the old two-line wordmark
          this replaced. */}
      <div className="min-w-0">
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
