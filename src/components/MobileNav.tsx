"use client";

// The mobile equivalent of everything the desktop chrome spreads across
// several separate floating surfaces (mode switcher, area filter, theme
// popover) plus the header's own search box — modeled directly on
// mndatacenter.org's own mobile pattern (src/components/mobile/
// MobileToolbar.astro), the sister site this project's chrome is already
// visually matched to (see SiteHeader.tsx, MapThemeSelector.tsx). A fixed
// bottom tab bar with three destinations; tapping one raises a sheet
// directly above the bar, tapping the same tab again (or the scrim, or
// Escape) lowers it. Nothing floats independently on this breakpoint
// anymore — one bar, one sheet slot, always in the same place, which is
// what keeps a short phone screen from ever needing more than one open
// surface at a time.
//
// WardMap decides *what* fills the sheet slot (a tab's own controls, or —
// taking priority over any tab, same as mndatacenter's own facility sheet
// outranking its tab sheets — the ward/rep detail modal once something's
// selected) and passes it in as `sheetContent`; this component only owns
// the bar chrome, the scrim, and the open/closed shell.
//
// The scrim intentionally blocks the map underneath (pointer-events and
// all) whenever anything is open — a resident can't pan/zoom the map or
// tap a different ward peeking out from behind an open sheet; they have to
// close first. That's a real trade against the old floating layout, which
// let a click straight through to the map swap the modal directly. It
// matches the reference component's own explicit rationale ("maintaining
// map legibility while indicating inactive state") and keeps "how do I get
// back to the map" a single, predictable action everywhere — tap the
// dimmed map, tap the open tab again, or hit Escape all do the same thing.
import { useEffect, useId, useRef, type ReactNode } from "react";

export interface MobileNavTab {
  id: string;
  label: string;
  icon: ReactNode;
}

interface MobileNavProps {
  tabs: MobileNavTab[];
  // Which tab reads as "pressed." Pass null while the sheet is closed *or*
  // while it's showing the priority ward modal instead of a tab's own
  // content — nothing here is "the modal's tab," so nothing should look
  // pressed for it.
  activeTab: string | null;
  onSelectTab: (id: string) => void;
  // Whatever belongs in the sheet right now, or null for "closed." A
  // ReactNode rather than a lookup-by-id — WardMap already knows exactly
  // what to show (a tab's controls, or the pinned ward modal) and there's
  // no reason to make this component re-derive that.
  sheetContent: ReactNode;
  onDismiss: () => void;
}

export function IconSearch() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0">
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconSliders() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0">
      <path d="M3 6h5M12 6h5M3 14h2M9 14h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9.5" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6.5" cy="14" r="2.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function MobileNav({ tabs, activeTab, onSelectTab, sheetContent, onDismiss }: MobileNavProps) {
  const open = sheetContent !== null;
  const sheetId = useId();
  const navRef = useRef<HTMLElement | null>(null);

  // Same dismiss convention as every other dismissible surface in this app
  // (MapThemeSelector's popover) — only listening while something's
  // actually open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onDismiss]);

  // Publishes this bar's real rendered height as a CSS variable so the
  // map's own bottom-right control cluster (zoom, attribution, theme
  // selector — see WardMap.tsx's #map-corner-controls) can sit *above*
  // it instead of underneath it. This bar is `fixed` at the true screen
  // bottom with a higher z-index than the map's controls, so without
  // this it would simply cover them on a phone. Modeled on
  // mndatacenter.org's own MobileToolbar.astro, which does the same
  // measure-and-publish for the same reason. A ResizeObserver, not a
  // one-time read, because the safe-area inset and tab count can both
  // change (rotation, a taller/shorter notch) after mount. Above `sm`
  // this element is `display:none` (see the root div's `sm:hidden`
  // below), so it reports 0 and the variable falls back to 0 on its own
  // — no breakpoint branching needed here.
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
    <div className="sm:hidden">
      {open && <div className="fixed inset-0 z-30 bg-black/25" aria-hidden="true" onClick={onDismiss} />}
      {/* One bottom-anchored flex column, not two independently-positioned
          fixed elements — the sheet's height varies a lot (a three-line
          filter list vs. a full ward profile), and stacking it directly
          above the bar in one column means it always lands exactly there
          with no height math to keep in sync, the same technique the
          previous mobile search+modal stack used. */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col font-sans">
        {/* No height cap or overflow-auto on this wrapper itself, on
            purpose: `overflow-y-auto` here would clip to *this element's
            own* box — sized by its normal-flow content — and every
            popover a child opens (SearchBar's suggestions listbox, its
            coverage-info popover) is `position: absolute`, which doesn't
            contribute to that sizing. A short row (the search pill) with
            a tall popover anchored to it would size this wrapper to the
            row alone and clip the popover to almost nothing — hit exactly
            this while building the coverage popover above. Every actual
            sheet body already caps and scrolls *itself* where it
            genuinely needs to (WardModal's own max-h-[75vh], the Filters
            city list's own max-h-[45vh]), so this wrapper doesn't need a
            second, competing cap. */}
        {sheetContent && (
          <div id={sheetId} className="px-3 pb-2 pt-2">
            {sheetContent}
          </div>
        )}
        {/* `.band` — same flag treatment as SiteHeader, matching the
            reference component's own choice (its <nav> carries the same
            "band bg-panel" pair) rather than a plain neutral toolbar. The
            app reads as bookended between two flag-colored bars, header on
            top and nav on bottom, in light mode; see globals.css's `.band`
            comment for why that's light-mode-only. */}
        <nav
          ref={navRef}
          className="band bg-panel grid border-t border-hair shadow-[0_-2px_16px_rgba(0,0,0,0.12)] pb-[env(safe-area-inset-bottom)]"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          aria-label="Map panels"
        >
          {tabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                aria-expanded={active}
                aria-controls={active ? sheetId : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 px-2 transition-colors active:bg-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 focus-visible:-outline-offset-1 ${
                  active ? "text-accent" : "text-ink-3"
                }`}
              >
                {tab.icon}
                <span className="text-[9px] font-bold uppercase tracking-wider leading-none">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
