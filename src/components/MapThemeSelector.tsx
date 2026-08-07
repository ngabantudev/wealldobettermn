"use client";

// The "layers" popover — mndatacenter.org's own map/site theme selector,
// matched here: a single minimized control (collapsed to one icon button,
// stacked above MapLibre's own zoom buttons) that expands into two
// sections — the site's Light/Dark chrome theme, and the MapLibre basemap
// underneath everything else. They're two different settings bundled into
// one popover on purpose: "make this light" is one decision in a
// resident's head, even though it touches both (see WardMap.tsx's
// selectSiteTheme, which picks a paired basemap automatically).
//
// Desktop/laptop only (see the `hidden sm:block` on the root below) — on
// mobile these same two settings live in MobileNav's Theme tab instead,
// via MapThemeOptions (exported further down) rendered directly into that
// tab's sheet rather than behind a second popover-inside-a-popover.

import { useEffect, useId, useRef, useState } from "react";
import { MAP_STYLE_OPTIONS } from "@/lib/mapStyles";
import type { SiteTheme } from "@/lib/siteTheme";

interface MapThemeSelectorProps {
  siteTheme: SiteTheme;
  mapStyleId: string;
  onSelectSiteTheme: (theme: SiteTheme) => void;
  onSelectMapStyle: (styleId: string) => void;
}

const SITE_THEMES: { id: SiteTheme; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

// Exported for MobileNav's Theme tab, which needs the same two option
// groups without the popover/toggle-button chrome around them — see that
// component's own usage. Kept here rather than a third file since it's
// tightly coupled to SITE_THEMES/MAP_STYLE_OPTIONS above and only has the
// one other caller.
export function IconLayers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <path d="M12 2 2 7l10 5 10-5-10-5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0">
      <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 2v2M10 16v2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M2 10h2M16 10h2M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0">
      <path
        d="M16.5 12.3A6.8 6.8 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5 shrink-0 text-accent">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The two option groups themselves — Site Theme radiogroup, then Map Theme
// list — with no surrounding popover chrome, so a caller can drop them
// into whatever container fits its own context (MapThemeSelector's `well`
// popover below, or MobileNav's Theme tab sheet). `onSelectMapStyle` here
// is exactly the callback the caller passed in; if picking a style should
// also close whatever's showing this (the popover, the mobile sheet),
// that's the caller's own onSelectMapStyle composing in the close — this
// component doesn't know or care which context it's in.
export function MapThemeOptions({ siteTheme, mapStyleId, onSelectSiteTheme, onSelectMapStyle }: MapThemeSelectorProps) {
  return (
    <>
      <span className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-ink-4">Site Theme</span>
      <div role="radiogroup" aria-label="Site theme" className="grid grid-cols-2 gap-1 px-1 pb-1.5">
        {SITE_THEMES.map((option) => {
          const active = option.id === siteTheme;
          const Icon = option.id === "light" ? IconSun : IconMoon;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelectSiteTheme(option.id)}
              className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition ${
                active ? "border-hair-strong bg-hover text-ink" : "border-hair text-ink-3 hover:bg-hover"
              }`}
            >
              <Icon />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mx-1 border-t border-hair" />

      <span className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-ink-4">Map Theme</span>
      {MAP_STYLE_OPTIONS.map((option) => {
        const active = option.id === mapStyleId;
        return (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            onClick={() => onSelectMapStyle(option.id)}
            className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] md:text-xs font-semibold transition ${
              active ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover"
            }`}
          >
            <span>{option.label}</span>
            {active ? <IconCheck /> : <span className="h-3.5 w-3.5 shrink-0" />}
          </button>
        );
      })}
    </>
  );
}

export default function MapThemeSelector({ siteTheme, mapStyleId, onSelectSiteTheme, onSelectMapStyle }: MapThemeSelectorProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  // Click-outside and Escape both close the popover, matching every other
  // dismissible surface in this app (SearchBar's own listbox). Only
  // registered while open — no listener sitting on `document` the rest of
  // the time a resident isn't using this control.
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

  return (
    // Desktop/laptop only — bottom-right, stacked above MapLibre's own
    // corner controls (mndatacenter.org's own layout: a single control
    // stacked cleanly above everything MapLibre puts in that corner,
    // sharing its right edge). That corner holds two MapLibre controls,
    // not one: the AttributionControl (compact, collapsed to a small
    // badge) sits *below* the NavigationControl (zoom in/out, no
    // compass) — both were added via `map.addControl`/`attributionControl`
    // in WardMap.tsx. `right` matches MapLibre's own control margin
    // exactly; `bottom` is computed from the same --map-ctrl-* variables
    // (globals.css) that describe both controls' real geometry, rather
    // than a guessed Tailwind step — so it stays correct if either
    // control's size ever changes. `hidden sm:block`: below `sm` this
    // control doesn't render at all; MobileNav's Theme tab covers the
    // same two settings there (see MapThemeOptions above).
    <div
      ref={rootRef}
      className="hidden sm:block absolute z-20 font-sans"
      style={{
        right: "var(--map-ctrl-right)",
        bottom:
          "calc(var(--map-controls-bottom) + var(--map-ctrl-attrib-height) + var(--map-ctrl-gap) + var(--map-ctrl-group-height) + var(--map-ctrl-gap))",
      }}
    >
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Change map layer"
        onClick={() => setOpen((o) => !o)}
        // 29x29 to match MapLibre's own NavigationControl button size
        // exactly (.maplibregl-ctrl-group button — 29px, see
        // maplibre-gl.css) rather than this app's usual h-9/h-10 icon
        // button, so the two controls read as one family stacked
        // together instead of two differently-sized things.
        className="flex h-7.25 w-7.25 items-center justify-center rounded-xl bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) text-ink-3 hover:bg-hover hover:text-ink transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <IconLayers />
      </button>

      {open && (
        <div
          id={panelId}
          role="menu"
          // Opens upward — the toggle sits at the bottom of the screen.
          className="well absolute right-0 bottom-full mb-2 w-44 rounded-xl border border-hair bg-panel-2 shadow-xl shadow-(color:--shadow-panel) p-1.5 flex flex-col gap-0.5"
        >
          <MapThemeOptions
            siteTheme={siteTheme}
            mapStyleId={mapStyleId}
            onSelectSiteTheme={onSelectSiteTheme}
            onSelectMapStyle={(styleId) => {
              onSelectMapStyle(styleId);
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
