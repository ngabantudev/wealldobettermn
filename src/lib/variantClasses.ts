// Shared "floating vs. sidebar" Tailwind class mapping — the two flavors
// every filter-adjacent control in the map UI can render as (see
// AreaFilterList.tsx's own header comment on the two variants: "floating",
// MobileSheet's absolutely-positioned-over-the-map flavor, and
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

// AGENTS.md §4's 44px mobile touch-target floor, applied to a small round
// control (an icon button, a switch) whose *visible* size should stay
// smaller than that for visual weight — a 44px close button reads heavy
// next to a modal heading, a 44px info glyph would dwarf the search icon
// it sits beside. The fix used everywhere this applies is the same one:
// keep the drawn box small, grow the invisible tappable region around it
// with a `before:` pseudo-element, and collapse that pseudo-element back to
// the box's own bounds at `sm`+, where a mouse/trackpad click has no
// touch-target floor to satisfy.
//
// Centralized here (rather than three call sites each hand-picking their
// own inset) after a review pass found two of the three hand-picked values
// didn't actually reach 44px — one overshot to 56px, another was asymmetric
// and overshot to 64px on one axis.
//
// Every preset returns its own `relative` (the `before:` pseudo-element
// needs something to position against) — if a caller ALSO needs
// `position: absolute` for page-level floating placement (not just a
// static-flow button), don't add an `absolute` Tailwind class alongside
// this: `relative`/`absolute` set the same CSS `position` property, and
// whichever rule Tailwind happens to generate later in its stylesheet wins
// regardless of the order classes appear in the className string — this
// silently drops the element to static position (caught live once, see
// WardMap.tsx's mobile Filters trigger and its own comment). Set
// `position: "absolute"` as an inline style instead; inline styles always
// win over any class, sidestepping the ordering question entirely.
//
// Presets, not a computed inset: Tailwind v4's scanner needs complete,
// literal class-name strings present in a file it scans — a string built
// from `before:-inset-[${n}px]` never appears as text anywhere in the
// source, so it silently never ships in the generated CSS. A lookup table
// of the sizes this codebase's controls actually use keeps every class
// name literal (grep-able, and visible to the scanner) while still giving
// call sites one shared, correctness-checked source instead of three
// independently hand-picked insets. Add a size here rather than reaching
// for an inline `before:-inset-[...]` at the call site.
const TOUCH_TARGET_PRESETS: Record<number, string> = {
  // 24px visible (CoverageNotice's info glyph) -> 10px inset each side = 44px.
  24: "relative before:absolute before:-inset-2.5 before:content-[''] sm:before:inset-0",
  // 29px visible (#map-corner-controls' buttons — sized to match MapLibre's
  // own NavigationControl buttons, see those buttons' own comments) -> 7.5px
  // inset each side = 44px.
  29: "relative before:absolute before:-inset-[7.5px] before:content-[''] sm:before:inset-0",
  // 36px visible (WardModal's close button, AreaFilterList's switch track,
  // whose 36px width is its larger dimension) -> 4px inset each side = 44px.
  36: "relative before:absolute before:-inset-1 before:content-[''] sm:before:inset-0",
};

export function touchTargetClass(visiblePx: keyof typeof TOUCH_TARGET_PRESETS): string {
  return TOUCH_TARGET_PRESETS[visiblePx];
}
