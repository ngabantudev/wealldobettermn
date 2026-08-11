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
// Renders at every breakpoint, in the same map corner, as one of
// #map-corner-controls' flex children (see WardMap.tsx) — there's no
// mobile-specific version of this control. It used to hide itself below
// `sm` in favor of a duplicate copy of these same options living in the
// old MobileNav's own tab bar; that duplication (two different places to
// find "change the map's look," a phone visitor's only path in one of
// them) wasn't worth avoiding a single popover click on a small screen, so
// the mobile-only path was removed rather than kept in sync. Stayed
// removed through the later mobile chrome redesign that replaced that old
// tab bar with MobileBottomNav.tsx's direct-navigation links — a theme
// tab wouldn't have fit that model any better than the old one.

import { useCallback, useId, useState, type KeyboardEvent } from "react";
import { useDismissable } from "@/hooks/useDismissable";
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

// Arrow-key navigation between options within one radiogroup — the one
// piece of native `<input type="radio">` grouping behavior a *styled*
// button group doesn't get for free (native radios move the OS's own
// roving tab index and select-on-arrow automatically; these are plain
// buttons, so both have to be done by hand). Deliberately small and
// self-contained: Up/Left moves to the previous option, Down/Right to the
// next, wrapping at either end, and — matching native radio-group
// behavior, where arrowing between options also changes the selected
// value, not just focus — immediately selects whatever it lands on via a
// synthetic `.click()` rather than requiring a separate confirm step. Home/
// End and typeahead (real ARIA `menu` obligations this popover doesn't
// have now that it isn't one — see below) are deliberately NOT implemented:
// two or a handful of options each is short enough that Home/End save
// no real navigation over plain Arrow keys, and adding them here would be
// exactly the kind of half-implemented menu-keyboard-model creep this fix
// is undoing.
function focusRadioSibling(container: HTMLElement, direction: 1 | -1) {
  const radios = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  if (radios.length === 0) return;
  const currentIndex = radios.findIndex((el) => el === document.activeElement);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + radios.length) % radios.length;
  const next = radios[nextIndex];
  next.focus();
  next.click();
}

function onRadioGroupKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    e.preventDefault();
    focusRadioSibling(e.currentTarget, 1);
  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    e.preventDefault();
    focusRadioSibling(e.currentTarget, -1);
  }
}

// The two option groups themselves — Site Theme radiogroup, then Map Theme
// radiogroup — split out from the popover chrome around them mostly for
// readability at this point (the popover below is its only caller — see
// this file's own header comment on why there's never been a separate
// mobile Theme tab). `onSelectMapStyle`
// here is exactly the callback the caller passed in; the popover composes
// its own close-on-pick behavior into it below.
//
// Both groups are `role="radiogroup"` with `role="radio"` children now —
// the Map Theme list used to be `role="menuitemradio"` inside an outer
// `role="menu"` panel, which obligates full ARIA menu keyboard semantics
// (Up/Down/Home/End roving focus, focus-moves-into-the-menu-on-open,
// typeahead) that were never actually implemented. A mutually-exclusive
// settings list is exactly what `radiogroup` describes — no unmet menu
// contract, and it already matches the Site Theme group right above it,
// which was `radiogroup` from the start.
function MapThemeOptions({ siteTheme, mapStyleId, onSelectSiteTheme, onSelectMapStyle }: MapThemeSelectorProps) {
  return (
    <>
      <span className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-ink-4">Site Theme</span>
      <div role="radiogroup" aria-label="Site theme" onKeyDown={onRadioGroupKeyDown} className="grid grid-cols-2 gap-1 px-1 pb-1.5">
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
      <div role="radiogroup" aria-label="Map basemap style" onKeyDown={onRadioGroupKeyDown} className="flex flex-col gap-0.5">
        {MAP_STYLE_OPTIONS.map((option) => {
          const active = option.id === mapStyleId;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
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
      </div>
    </>
  );
}

export default function MapThemeSelector({ siteTheme, mapStyleId, onSelectSiteTheme, onSelectMapStyle }: MapThemeSelectorProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // Click-outside (well, outside-pointerdown — see the hook's own comment
  // on why not `click`) and Escape both close the popover, matching every
  // other dismissible surface in this app. Only active while `open`, per
  // useDismissable's own `active` gate — no listener sitting on `document`
  // the rest of the time a resident isn't using this control.
  const close = useCallback(() => setOpen(false), []);
  const { rootRef } = useDismissable<HTMLDivElement>(open, close);

  return (
    // Every breakpoint, same map corner — a plain flex child of WardMap's
    // #map-corner-controls wrapper, not an independently
    // absolutely-positioned element: that wrapper (not this component)
    // owns the stack's position, order, and spacing relative to the
    // NavigationControl and AttributionControl next to it. `relative`
    // stays so the popover panel below (`absolute bottom-full right-0`)
    // anchors to *this button* rather than drifting to whatever the
    // wrapper's own positioned ancestor happens to be.
    <div ref={rootRef} className="flex relative font-sans">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Change map layer"
        onClick={() => setOpen((o) => !o)}
        // 29x29 with a 4px corner radius to match MapLibre's own
        // NavigationControl button exactly (.maplibregl-ctrl-group —
        // 29px buttons, border-radius:4px, see maplibre-gl.css) rather
        // than this app's usual h-9/h-10 rounded-xl icon button, so the
        // two controls read as one uniform family stacked together
        // instead of two different shapes.
        className="flex h-7.25 w-7.25 items-center justify-center rounded bg-panel-2/90 backdrop-blur-sm border border-hair shadow-lg shadow-(color:--shadow-panel) text-ink-3 hover:bg-hover hover:text-ink transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <IconLayers />
      </button>

      {open && (
        <div
          id={panelId}
          // No role here — this panel wraps two independent radiogroups
          // (Site Theme, Map Theme; see MapThemeOptions above), not one
          // single list, so there's no single ARIA widget role that
          // honestly describes the wrapper itself. It used to be
          // `role="menu"` (with `role="menuitemradio"` children on the Map
          // Theme list only), which asserted full ARIA menu semantics this
          // popover never implemented — see MapThemeOptions's own comment.
          // Opens upward — the toggle sits at the bottom of the screen.
          // w-48 (not w-44): the longest option label, "Liberty (Google
          // Maps)", wrapped to two lines at w-44 — w-48 is also what
          // mndatacenter.org's own panel uses, for the same reason.
          className="well absolute right-0 bottom-full mb-2 w-48 rounded-xl border border-hair bg-panel-2 shadow-xl shadow-(color:--shadow-panel) p-1.5 flex flex-col gap-0.5"
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
