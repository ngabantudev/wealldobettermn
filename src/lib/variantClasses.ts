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

export function rowHoverClass(variant: FilterVariant): string {
  return variant === "sidebar" ? "hover:bg-sidebar-hover" : "hover:bg-hover";
}

export function focusRingClass(variant: FilterVariant): string {
  return variant === "sidebar" ? "focus-visible:ring-sidebar-accent" : "focus-visible:ring-accent";
}
