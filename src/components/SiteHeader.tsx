import Link from "next/link";
import MastheadSaying from "./MastheadSaying";
import SiteSearch from "./SiteSearch";

// The site's only persistent chrome nav: Map (back to "/" from any of the
// pages below), Bills, Sources, About, Privacy. Kept small — text links,
// not icons — since this bar's real estate is already spoken for by
// MastheadSaying and (on sm+) the search box; see the render below for how
// it fits between them. Exists because /bills, /about, and /privacy are
// otherwise dead ends with no way back except the browser's own Back
// button — PR review, 2026-08-07 ("orphan pages nobody can reach"). /sources
// (2026-08-08) follows the same rule from day one rather than needing its
// own follow-up fix.
const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Map" },
  { href: "/meetings", label: "Meetings" },
  { href: "/bills", label: "Bills" },
  { href: "/recap", label: "Recap" },
  { href: "/sources", label: "Sources" },
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
];

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
// whether or not the map route happens to be mounted. Hidden below `sm`
// (see the wrapper's own className); mobile mounts a separate SearchBar
// instance inside MobileNav's Search tab instead, so nothing rendering
// here on mobile is expected, not a bug.
export default function SiteHeader() {
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
      {/* Always visible, every breakpoint — including on mobile, where it's
          the only way off /bills, /about, or /privacy short of the
          browser's own Back button. `shrink-0`: MastheadSaying is the
          element designed to give up width (its own font-fit logic
          measures whatever box the flex layout leaves it), not this. */}
      <nav aria-label="Site" className="flex shrink-0 items-center gap-3 sm:gap-4">
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-xs font-semibold tracking-wide text-ink-2 uppercase hover:text-ink hover:underline"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {/* Desktop/laptop only. Below `sm`, MobileNav's Search tab is the
          reachable-in-one-tap equivalent — there's no width here to spare
          for an inline search box once the bottom nav takes over, and
          AGENTS.md Part 4 only asks that search stay one interaction away
          on every breakpoint, not that it live in the same place on all of
          them. Always rendered (this component no longer knows which route
          mounted it), but only ever populated on the map route — WardMap
          portals its SearchBar in here and cleans up on unmount, so on
          every other route this stays an empty, invisible-by-CSS node. */}
      <div className="hidden min-w-0 flex-1 sm:flex sm:justify-center">
        <SiteSearch />
      </div>
    </header>
  );
}
