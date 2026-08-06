"use client";

// The "layers" popover — mndatacenter.org's own map/site theme selector,
// matched here: a single minimized control (collapsed to one icon button,
// stacked above MapLibre's own zoom buttons) that expands into two
// sections — the site's Light/Dark chrome theme, and the MapLibre basemap
// underneath everything else. They're two different settings bundled into
// one popover on purpose: "make this light" is one decision in a
// resident's head, even though it touches both (see WardMap.tsx's
// selectSiteTheme, which picks a paired basemap automatically).

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

function IconLayers() {
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
    // Mobile: top-right, mirroring the mode switcher's top-left — the
    // bottom-right corner belongs to the search card there (a bottom
    // sheet nearly the full viewport width on a phone; see SearchBar's
    // `w-[min(90vw,24rem)]`), which fully covers this control at its
    // desktop position and swallows every click. Desktop (sm+): bottom-
    // right, stacked above MapLibre's own zoom buttons, where the search
    // card never reaches.
    <div ref={rootRef} className="absolute right-3 top-3 sm:top-auto sm:bottom-24 z-20 font-sans">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Change map layer"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-xl bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) text-ink-3 hover:bg-hover hover:text-ink transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <IconLayers />
      </button>

      {open && (
        <div
          id={panelId}
          role="menu"
          // Opens downward on mobile (the toggle sits at the top there) and
          // upward on desktop (the toggle sits at the bottom) — same flip
          // as the container's own position above.
          className="well absolute right-0 top-full mt-2 sm:top-auto sm:bottom-full sm:mt-0 sm:mb-2 w-44 rounded-xl border border-hair bg-panel-2 shadow-xl shadow-(color:--shadow-panel) p-1.5 flex flex-col gap-0.5"
        >
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
                onClick={() => {
                  onSelectMapStyle(option.id);
                  setOpen(false);
                }}
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] md:text-xs font-semibold transition ${
                  active ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover"
                }`}
              >
                <span>{option.label}</span>
                {active ? <IconCheck /> : <span className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
