import type { ReactNode } from "react";

// The site's identity bar — visually matched to mndatacenter.org's own
// navy/cyan header band (see globals.css's `.band` token overrides for
// the mechanism). Wordmark and tagline are purely presentational, same as
// always; the one control that does live here is the search bar itself
// (desktop/laptop only — see the `search` prop below), which AGENTS.md
// Part 4 calls "the primary interface, not the map," so it earns a
// permanent spot in the chrome rather than floating over the map where a
// resize or a tall panel could ever crowd it. Map mode, filters, and the
// theme popover stay off this bar — floating over the map on desktop,
// folded into MobileNav's bottom tabs on mobile.
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
// the map, the right-hand tagline, and the domain.
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
    <header className="band flex shrink-0 items-center justify-between gap-3 sm:gap-5 border-b border-hair bg-panel px-4 py-3.5 sm:px-6 sm:py-4">
      <div className="flex min-w-0 shrink-0 flex-col justify-center gap-0.5">
        {/* text-2xl font-black uppercase tracking-tight leading-none — the
            exact class list mndatacenter.org's own masthead headline uses
            (its FilterHeader.astro, the h1 that crossfades "Minnesota"/"Mni
            Sóta Makoce"). `truncate`, not their `whitespace-nowrap`: their
            headline sits in a fixed-width sidebar; this one's in a flexible
            top bar next to the search bar and tagline, so it still needs a
            safety valve on a narrow viewport. */}
        <span className="truncate text-2xl font-black uppercase tracking-tight leading-none text-ink">We All Do Better</span>
        {/* The completion, not a repeat — lowercase and small so it reads
            as one phrase continuing (and finishing) the bold line above,
            not a second competing headline. `text-justify` +
            `text-align-last:justify` spread its word-spacing to fill
            exactly the headline's own width: the parent's flex-col
            default (align-items: stretch) already sizes this span's box
            to match the headline above it — nothing here sets a width
            directly, so it can't drift out of sync if the headline's
            text or size ever changes. */}
        <span className="block truncate text-[13px] uppercase tracking-[0.13em] text-ink-3 text-justify [text-align-last:justify]">when we all do better</span>
      </div>
      {/* Desktop/laptop only. Below `sm`, MobileNav's Search tab is the
          reachable-in-one-tap equivalent — there's no width here to spare
          for an inline search box once the bottom nav takes over, and
          AGENTS.md Part 4 only asks that search stay one interaction away
          on every breakpoint, not that it live in the same place on all of
          them. */}
      <div className="hidden min-w-0 flex-1 justify-center sm:flex">{search}</div>
      {/* Pushed from `sm:block` to `lg:block`: the search bar now claims the
          middle of this row at `sm`, and there isn't room left for both an
          inline search box and this tagline on a tablet-width viewport. */}
      <p className="hidden shrink-0 truncate text-xs text-ink-3 lg:block">
        Who represents you, what they vote for, how to reach them.
      </p>
    </header>
  );
}
