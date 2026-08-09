// Shared "floating vs. sidebar" Tailwind class mapping — the two flavors
// every filter-adjacent control in the map UI can render as (see
// AreaFilterList.tsx's own header comment on the two variants: "floating",
// MobileNav's bottom-sheet/absolutely-positioned-over-the-map flavor, and
// "sidebar", the desktop left `<aside>`'s own panel chrome). Both flavors
// sit on different background fills, so they need different hover/focus
// tokens to stay legible against their own surface — --hover barely shows
// against the sidebar's own bg-panel-2/bg-panel-3 fills (a full step closer
// to --hover already), so the sidebar flavor uses the stronger
// --sidebar-hover/--sidebar-accent tokens instead (see globals.css's own
// comment on --sidebar-hover for the contrast math).
//
// This used to be hand-duplicated: AreaFilterList.tsx defined its own
// `rowHoverClass`/`focusRingClass`, and WardMap.tsx separately re-derived
// the same "floating" vs. "sidebar" token choice inline at its own
// segmented-control button sites (the map-layer and chamber toggles).
// Pulled into one shared module so there's exactly one place that knows
// which hover/focus tokens go with which variant — a third caller (or a
// change to the token choice itself) now only has one function to touch.
export type FilterVariant = "floating" | "sidebar";

// Sidebar row hover is deliberately the lighter --panel-3 fill here, not
// the stronger --sidebar-hover WardMap.tsx's own persistent controls use
// (its Level/Chamber tab row, the collapse pull-tabs — see their own
// comments in WardMap.tsx). Those need --sidebar-hover's darker gray
// because they're the sole way the tab row/pull-tab communicates its
// interactive-state boundary, which is what WCAG 1.4.11's 3:1 rule is
// actually protecting. A transient mouse-hover fill on a checkbox row is
// a different case: the row's real interactive-state indicator for a
// keyboard user is the separate focus-visible ring (focusRingClass below,
// unchanged, still meets contrast on its own), and a screen-reader user
// never perceives a hover fill at all — a checkbox's own label/checked
// state carries that meaning regardless of any background color. That
// leaves hover free to be a much subtler, purely-visual "you're pointing
// at this row" cue for mouse users specifically, closer to
// mndatacenter.org's own restrained hover treatment — --panel-3 is
// already this app's own "recessed surface" token (sub-rows, track
// backgrounds), so reusing it here instead of inventing a new value keeps
// the same "hover = one step recessed" reading the rest of this sidebar
// already uses, just applied more gently than --sidebar-hover.
export function rowHoverClass(variant: FilterVariant): string {
  return variant === "sidebar" ? "hover:bg-panel-3" : "hover:bg-hover";
}

export function focusRingClass(variant: FilterVariant): string {
  return variant === "sidebar" ? "focus-visible:ring-sidebar-accent" : "focus-visible:ring-accent";
}
