"use client";

// The site's primary mobile navigation — 5 direct-page destinations in the
// site's own question order (AGENTS.md Part 0: who represents me / what do
// they vote for / ... / how do I reach them), replacing the old map-page-
// only 2-tab bar (Search, Filters — both map *controls*, not pages; see
// MobileSheet.tsx and SiteHeader's/WardMap's own search/filters triggers
// for where those went instead). Global chrome, mounted once in
// app/layout.tsx alongside SiteHeader — same "hoist so it survives
// navigation instead of being recreated by it" reasoning that file's own
// comment already gives for SiteHeader.
//
// Ordinary route <Link>s, not a tab-switcher — tapping "Bills" navigates to
// /bills, full stop. This is a genuinely different interaction model from
// the old MobileNav.tsx (which this component's bar half replaces): that
// bar's tabs opened a sheet *over* the same page; these links change the
// page. See MobileSheet.tsx for the still-tab-shaped mechanism that
// survives for the two things that really are page-local overlays (Search,
// Filters).
//
// Rounded top corners + band-panel treatment carried over unchanged from
// the old bar — visually this app's mobile chrome looks the same as
// before, only its meaning (nav vs. controls) has changed.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

function IconMap() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path d="M10 17s6-5.2 6-9.6A6 6 0 0 0 4 7.4C4 11.8 10 17 10 17Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="10" cy="7.4" r="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconMeetings() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconBills() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
      <rect x="4.5" y="3" width="11" height="14" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconResults() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path d="M4 16V9M10 16V4M16 16v-6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconRecap() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6.5V10l2.6 2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSources() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0" aria-hidden="true">
      <path
        d="M4 4.5c1.6-.8 3.4-.8 5 0v11c-1.6-.8-3.4-.8-5 0v-11ZM14 4.5c-1.6-.8-3.4-.8-5 0v11c1.6-.8 3.4-.8 5 0v-11Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Map", icon: <IconMap /> },
  { href: "/meetings", label: "Meetings", icon: <IconMeetings /> },
  { href: "/bills", label: "Bills", icon: <IconBills /> },
  { href: "/election-results", label: "Results", icon: <IconResults /> },
  { href: "/recap", label: "Recap", icon: <IconRecap /> },
  { href: "/sources", label: "Sources", icon: <IconSources /> },
];

export default function MobileBottomNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);

  // Publishes this bar's real rendered height as --mobile-nav-height, same
  // ResizeObserver-on-the-bar-element technique the old MobileNav.tsx used
  // — moved here now that this is the persistent, always-mounted bar
  // (MobileSheet.tsx and WardMap's #map-corner-controls both still read
  // this var, unchanged, to clear it). A ResizeObserver, not a one-time
  // read, because the safe-area inset can change (rotation, a taller/
  // shorter notch) after mount. Above `sm` this element is display:none
  // (see the root className below), so it reports 0 and the variable falls
  // back to 0 on its own — no breakpoint branching needed here.
  useEffect(() => {
    const el = navRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const publishHeight = () => {
      document.documentElement.style.setProperty("--mobile-nav-height", `${el.offsetHeight}px`);
    };
    const observer = new ResizeObserver(publishHeight);
    observer.observe(el);
    publishHeight();
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty("--mobile-nav-height", "0px");
    };
  }, []);

  return (
    <nav
      ref={navRef}
      // "Primary", not "Site" — SiteHeader's own desktop-only <nav> already
      // uses "Site" (see that file), and although only one of the two is
      // ever in the accessibility tree at a given viewport (the other is
      // CSS `display:none`, which browsers exclude from that tree), a
      // distinct name avoids any ambiguity for tooling that enumerates
      // landmarks regardless of visibility, and for a reader switching
      // orientation/viewport mid-session.
      aria-label="Primary"
      // z-40 — pinned to the same rung WardMap's own scrim-clearing bar/
      // sheet/Metro-button group already uses (see that file's z-index
      // scale comment, now cross-referenced from globals.css since this
      // bar is a layout.tsx sibling, not a WardMap descendant, and still
      // needs to sit above WardMap's z-30 mobile scrim without the two
      // trees having to import from each other to agree on that). Confirmed
      // load-bearing, not decorative: WardMap's own comment on the "Metro"
      // button documents a live Playwright-caught bug when a similar
      // element used z-20 instead — the scrim visually let it show through
      // at 25% opacity but ate every tap before it reached the button.
      className="band bg-panel sm:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-hair rounded-t-2xl shadow-[0_-2px_16px_rgba(0,0,0,0.12)] pb-[env(safe-area-inset-bottom)]"
    >
      {NAV_ITEMS.map((item) => {
        // Map (/) only reads active on an exact match — every other route
        // starts with "/" too, and a prefix match would light up Map for
        // every page. The other four are real leaf routes with nothing
        // nested under them today, so an exact match is equally correct
        // there; startsWith is reserved in case a future page grows a
        // child route (e.g. /bills/[id]) that should still read as "Bills."
        const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            // min-h-14 (56px) — AGENTS.md §4's 44px touch-target floor,
            // same convention AreaFilterList's CityRow documents, with
            // headroom for the icon+label stack rather than the floor
            // exactly.
            className={`flex min-h-14 flex-col items-center justify-center gap-1 px-2 transition-colors active:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:-outline-offset-1 ${
              active ? "text-accent" : "text-ink-3"
            }`}
          >
            {item.icon}
            <span className="text-[9px] font-bold uppercase tracking-wider leading-none">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
