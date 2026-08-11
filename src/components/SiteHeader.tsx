"use client";

import Link from "next/link";
import MastheadSaying from "./MastheadSaying";
import SiteSearch from "./SiteSearch";
import MobileSheet from "./MobileSheet";
import { useMobileSheetCoordinator } from "@/lib/mobileSheetCoordinator";
import { touchTargetClass } from "@/lib/variantClasses";

// Desktop/laptop-only chrome nav now (sm+) — Map (back to "/" from any of
// the pages below), Meetings, Bills, Recap, Sources, About, Privacy. Kept
// small — text links, not icons — since this bar's real estate is already
// spoken for by MastheadSaying and the search box; see the render below for
// how it fits between them. Exists because /bills, /about, and /privacy are
// otherwise dead ends with no way back except the browser's own Back
// button — PR review, 2026-08-07 ("orphan pages nobody can reach"). /sources
// (2026-08-08) follows the same rule from day one rather than needing its
// own follow-up fix.
//
// Below `sm` this row doesn't render at all (mobile chrome redesign) — Map,
// Meetings, Bills, Recap, and Sources moved to MobileBottomNav.tsx, a real
// bottom-nav bar rather than a link row squeezed next to the masthead; a
// prior revision here tried to keep this exact row alive on mobile as a
// horizontal-scroll strip, which worked but was strictly worse than an
// actual bottom nav once one existed. About and Privacy — the two links
// that don't fit a 5-item bottom nav — moved to the footer rendered by
// src/app/(content)/layout.tsx instead (see that file), so nothing here
// becomes an unreachable dead end on mobile; it's just reached from a
// different place than on desktop now.
const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Map" },
  { href: "/meetings", label: "Meetings" },
  { href: "/bills", label: "Bills" },
  { href: "/recap", label: "Recap" },
  { href: "/sources", label: "Sources" },
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
];

function IconSearch() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// The site's identity bar — visually matched to mndatacenter.org's own
// navy/cyan header band (see globals.css's `.band` token overrides for
// the mechanism). The controls that live here are the search bar (inline
// on desktop/laptop, an icon trigger on mobile — see below), which
// AGENTS.md Part 4 calls "the primary interface, not the map," so it earns
// a permanent spot in the chrome rather than floating over the map where a
// resize or a tall panel could ever crowd it, and MastheadSaying's own
// info trigger (see below). Map mode, filters, and the theme popover stay
// off this bar on every breakpoint — floating over the map on desktop,
// their own mobile-only triggers on WardMap itself (Filters) or MapLibre's
// own corner (theme) rather than living in this header.
//
// The masthead text *is* MastheadSaying: one of nine mottos — the site's
// own English name plus eight from Minnesota's Indigenous, Somali, Hmong,
// and Pan-African diaspora communities (src/lib/mastheadSayings.ts) —
// auto-rotating every hour, rendered at the size/weight a static wordmark
// used to occupy here. (That wordmark, "We All Do Better" / "when we all
// do better," is itself now the first entry in that same rotation rather
// than a fixed line — see mastheadSayings.ts.) Same non-negotiable that
// wordmark held: the saying's own text is always visible, never hidden
// behind a hover. Only the *explanation* of what it means is progressive
// disclosure, reachable by hover, focus, or tap (see that component) —
// not the `title=`-attribute trick mndatacenter.org uses for its own
// Dakota-name headline and this app has never adopted.
// SiteHeader itself now lives in app/layout.tsx, rendered once and shared
// across every route (see that file's comment) — it no longer takes a
// `search` prop or knows which page mounted it. It renders the address-
// search combobox directly now (SiteSearch.tsx), rather than leaving an
// empty #site-search-slot node for WardMap to portal into — that portal
// approach meant the box only existed while WardMap did, i.e. only on
// "/", which was the actual bug the 2026-08-09 "persistent chrome" fix
// was supposed to close but didn't quite reach. SiteSearch reaches WardMap
// through src/lib/searchCoordinator.tsx instead, so it works identically
// whether or not the map route happens to be mounted.
//
// Below `sm`, the inline SiteSearch box itself stays hidden (no room next
// to the masthead at phone width) but a small search-icon trigger takes
// its place, opening the same SiteSearch inside a MobileSheet raised above
// MobileBottomNav's global bar — mobile chrome redesign. Before that
// redesign, mobile search was a WardMap-owned duplicate SearchBar instance
// living in the old MobileNav's Search tab; that duplicate (and the
// gazetteer fetches that only existed to feed it) is gone now — SiteSearch
// is the one search implementation for every breakpoint, reachable from
// this same persistent header on all of them, per AGENTS.md Part 4
// ("Search Is The Primary Interface, Not The Map").
export default function SiteHeader() {
  const { openSheet, setOpenSheet } = useMobileSheetCoordinator();
  const searchOpen = openSheet === "search";
  return (
    // `h-16`, a fixed height rather than one that grows with content: an
    // earlier revision let a longer saying wrap onto two or three lines,
    // which meant the whole topbar visibly grew and shrank as the
    // rotation changed what was showing — jarring on its own, and it
    // shoved the search bar up and down with it. MastheadSaying now
    // renders its saying on a single `whitespace-nowrap` line and grows
    // *sideways* instead (see that component); this fixed height is what
    // makes that the only direction it's allowed to grow in.
    //
    // Plain `flex`, not the three-track grid an earlier revision used:
    // that grid existed to keep the search bar centered on the header
    // itself (not just on the leftover space after the wordmark) by
    // flanking it with two *equal* tracks — which depended on the left
    // track being a fixed share of the bar, not sized to its own content.
    // MastheadSaying needs the opposite now: real room to grow into,
    // without being capped at an equal-share track the way the old
    // wordmark was. It carries `min-w-0 flex-1` on its own root (not a
    // wrapping div here — its font-fit calculation needs to measure the
    // exact box the flex layout hands it, see that component), and
    // SearchBar's own wrapper is `flex-1` too, so the two split whatever
    // room is left over after each takes what its content actually needs.
    // One consequence: the search bar is no longer perfectly centered on
    // the bar as a whole, only within whatever room MastheadSaying leaves
    // it (`justify-center` on its own wrapper). That's the deliberate
    // trade — showing every saying in full, on one line, at a fixed bar
    // height, over exact search-bar centering that a variable-width
    // sibling can't actually promise anyway.
    <header className="band flex h-16 shrink-0 items-center gap-3 border-b border-hair bg-panel px-4 sm:gap-5 sm:px-6">
      <MastheadSaying />
      {/* Desktop/laptop only now — see this array's own comment above for
          where each of these 7 destinations lives on mobile instead. */}
      <nav aria-label="Site" className="hidden shrink-0 items-center gap-4 sm:flex">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="whitespace-nowrap text-xs font-semibold tracking-wide text-ink-2 uppercase hover:text-ink hover:underline"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {/* Desktop/laptop only — see the component comment above for the
          mobile equivalent (search-icon trigger, just right of this). */}
      <div className="hidden min-w-0 flex-1 sm:flex sm:justify-center">
        <SiteSearch />
      </div>
      {/* Mobile only — opens SiteSearch inside a MobileSheet raised above
          MobileBottomNav's bar. `sm:hidden` rather than living inside the
          `hidden sm:flex` wrapper above: that wrapper's job is hiding the
          *inline* search box, not this trigger, so the two need opposite
          breakpoint behavior rather than sharing a class. Token classes
          (text-ink, hover:bg-hover, ring-accent), not hardcoded white —
          `.band`'s own token overrides (globals.css) already resolve these
          to the flag's white-on-navy pairing here, same as every other
          control in this header, and stay correct if this header's theme
          ever changes without a hunt for a hardcoded color. touchTargetClass
          keeps the drawn glyph small while still meeting AGENTS.md §4's
          44px floor on mobile — see that helper's own comment. */}
      <button
        type="button"
        onClick={() => setOpenSheet(searchOpen ? null : "search")}
        aria-expanded={searchOpen}
        aria-label={searchOpen ? "Close search" : "Search for an address, city, or county"}
        className={`sm:hidden ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink transition hover:bg-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${touchTargetClass(36)}`}
      >
        <IconSearch />
      </button>
      <MobileSheet content={searchOpen ? <SiteSearch /> : null} onDismiss={() => setOpenSheet(null)} />
    </header>
  );
}
