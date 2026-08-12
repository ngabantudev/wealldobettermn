// src/lib/turnoutColors.ts
//
// The sequential color ramp for the civic-participation-turnout
// choropleth (WardMap.tsx's "participation" LayerMode). One rule
// dominates every other cartography choice here: this is election data
// shown in a US context, so a red/blue (or white-to-red, white-to-blue)
// ramp is disqualified outright — either one reads as a partisan map to
// any US viewer regardless of intent, which would misrepresent a neutral
// participation statistic as a political lean. See AGENTS.md §1c: this
// is a fact (a turnout percentage), not a score, and the color scheme
// has to read that way at a glance, before a viewer even opens the
// legend.
//
// Palette: six stops of the Viridis colormap (Nathaniel Smith & Stéfan
// van der Walt, released into the public domain as part of matplotlib —
// https://bids.github.io/colormap/), purple-blue at the low end through
// teal-green to yellow at the high end. Chosen over the docs' other
// suggestion (a single-hue purple/teal ramp) because Viridis is a
// published, independently-vetted standard rather than a hand-picked
// gradient, and ships with a stronger colorblind-safety pedigree than
// anything this codebase could improvise.
//
// Colorblind-safety reasoning (no live simulator available in this
// environment, so this is worked through from Viridis's own published
// design properties, not eyeballed):
//   1. Viridis was explicitly designed to be perceptually uniform AND to
//      remain monotonically increasing in lightness (L* in CIELAB) across
//      its whole range — the design brief's own stated goal was that the
//      map "should also work for people with color blindness." A ramp
//      that's monotonic in lightness alone (ignoring hue entirely)
//      already conveys low-to-high correctly to a viewer who perceives
//      no hue difference at all, which covers the deuteranopia/
//      protanopia/tritanopia cases as a category, not just red-green.
//   2. Viridis deliberately never crosses through a red-green transition
//      the way a rainbow/jet colormap does — it moves purple -> blue ->
//      teal -> green -> yellow, a single continuous arc through
//      blue-green-yellow hues. Red-green confusion (the most common form
//      of colorblindness) specifically degrades a viewer's ability to
//      distinguish reds from greens; a ramp that never asks the viewer to
//      distinguish a red stop from a green stop at the same lightness
//      sidesteps that failure mode rather than depending on hue contrast
//      within the danger zone.
//   3. Every stop below is also given a plain-language legend label
//      (ParticipationLegend.tsx) and a numeric percentage range — per
//      AGENTS.md §4 "Colour Is Never The Only Signal," color is a visual
//      aid on top of a labeled, orderable legend, not the sole channel a
//      resident has to read the map.
//
// Breakpoints below (50/65/75/85/95%) are a plain visual choice, not a
// statistical one — see MIN_REGISTERED_THRESHOLD in turnoutConfig.mjs for
// this feature's one number that IS backed by real analysis. They split
// the real 2024 statewide distribution (which clusters in the 65-90%
// range for turnoutOfRegistered) into six roughly legible bands rather
// than wasting resolution on the near-empty tails.

export interface TurnoutColorStop {
  /** Inclusive lower bound of this band, as a turnoutOfRegistered fraction (0-1). */
  min: number;
  /** Human-readable label for the legend swatch. */
  label: string;
  /** Hex color for this band. */
  color: string;
}

// Six Viridis stops (see header) mapped onto six turnout bands.
export const TURNOUT_COLOR_STOPS: readonly TurnoutColorStop[] = [
  { min: 0, label: "Under 50%", color: "#440154" },
  { min: 0.5, label: "50–65%", color: "#414487" },
  { min: 0.65, label: "65–75%", color: "#2a788e" },
  { min: 0.75, label: "75–85%", color: "#22a884" },
  { min: 0.85, label: "85–95%", color: "#7ad151" },
  { min: 0.95, label: "95% and up", color: "#fde725" },
];

// A distinct, deliberately neutral (non-sequential) gray — never a color
// that could be mistaken for a low or high point on the ramp above — for
// cities flagged belowThreshold (turnoutConfig.mjs's
// isBelowRegisteredThreshold). This isn't a turnout value at all; it's a
// "too small to shade reliably" flag, and needs to read as categorically
// different from the ramp, not as "very low turnout" (which would be a
// fabricated, misleadingly precise claim about a ~50-voter city where one
// voter swings the percentage by several points — see turnoutConfig.mjs's
// own header).
export const BELOW_THRESHOLD_COLOR = "#a8a29e"; // stone-400 — neutral warm gray

// For a city boundary polygon that structurally has no turnout record at
// all (joinCityBoundaryToTurnout returned null — an unresolved name/county
// join, not a small-city flag) — visually distinct from both the ramp and
// the below-threshold gray, so a resident can tell "no data available"
// apart from "data exists but is noisy." Slightly cooler/lighter than
// BELOW_THRESHOLD_COLOR.
export const NO_MATCH_COLOR = "#d6d3d1"; // stone-300

// Townships and unorganized territory — see
// scripts/fetch-township-unorg-boundaries.mjs. Not on the turnout ramp at
// all (there is no city government here to have a turnout figure for);
// rendered as a hatched pattern (see TOWNSHIP_UNORG_PATTERN_ID in
// WardMap.tsx) over this flat base color.
export const TOWNSHIP_UNORG_BASE_COLOR = "#e7e5e4"; // stone-200

/** Plain JS lookup, for legend swatches and the population-weighted circle layer's per-feature color (computed client-side, not as a MapLibre expression, since circle features are drawn from the same joined data either way). */
export function colorForTurnout(turnoutOfRegistered: number | null): string {
  if (turnoutOfRegistered === null) return NO_MATCH_COLOR;
  let color = TURNOUT_COLOR_STOPS[0].color;
  for (const stop of TURNOUT_COLOR_STOPS) {
    if (turnoutOfRegistered >= stop.min) color = stop.color;
  }
  return color;
}

// MapLibre GL "step" expression: colors a numeric turnoutOfRegistered
// property along TURNOUT_COLOR_STOPS. `["get", propertyName]` is expected
// to be null for unmatched features and MapLibre's own `step` treats null
// as < the first stop, which is why NO_MATCH_COLOR is layered on top via
// an outer `case` in WardMap.tsx rather than folded into this expression —
// null and "genuinely 0% turnout" need to render differently, and a bare
// `step` can't tell those apart.
export function turnoutStepColorExpression(propertyName: string): unknown[] {
  const expr: unknown[] = ["step", ["get", propertyName], TURNOUT_COLOR_STOPS[0].color];
  for (const stop of TURNOUT_COLOR_STOPS.slice(1)) {
    expr.push(stop.min, stop.color);
  }
  return expr;
}
