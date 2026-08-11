// src/lib/cityMatch.ts
//
// Resolves a visitor-submitted city name against the two things that
// matter for AGENTS.md §2.6's plausibility gate: is this a real Minnesota
// municipality at all (public/city-anchor-points.json — the statewide,
// build-time-precomputed set from scripts/build-city-anchor-points.mjs),
// and is it one this app already has officials data for (CITIES, in
// which case the pipeline correctly refuses it — corrections to an
// existing roster are out of scope for this pipeline; see §2.6's
// "Scope").
//
// Static `import` of the JSON file (bundled at build time), never
// `readFileSync` — see next.config.ts's own header comment on the
// 2026-08-06 outage this exact mistake caused elsewhere in this repo:
// public/ is served via the Worker's ASSETS binding at runtime, not a
// real filesystem, so any runtime read of it fails. A build-time `import`
// has no such problem — it's inlined into the bundle like any other
// module.

import { fold, isCoveredCityName } from "./addressSearch.ts";
// `with { type: "json" }`: required by Node's native ESM loader when this
// module is run directly under `node --test` (as its own .test.mjs does),
// not just by bundlers — Next.js/webpack accept it too, so this is the
// one spelling that works in both places.
import cityAnchorPointsData from "../../public/city-anchor-points.json" with { type: "json" };

interface AnchorPoint {
  gnisId: number | null;
  lng: number;
  lat: number;
}

interface CityAnchorPointsFile {
  schemaVersion: number;
  points: Record<string, AnchorPoint>;
}

const cityAnchorPoints = cityAnchorPointsData as CityAnchorPointsFile;

// Folded once at module scope (same pattern as addressSearch.ts's own
// FOLDED_CITIES) — keyed by fold(name) so "Worthington", "worthington",
// and any punctuation/whitespace variant all resolve to the same entry.
const FOLDED_ANCHOR_POINTS = new Map<string, { canonicalName: string } & AnchorPoint>(
  Object.entries(cityAnchorPoints.points).map(([name, point]) => [fold(name), { canonicalName: name, ...point }]),
);

export interface CityMatchResult {
  /** Is this a real MN municipality we have a precomputed anchor point for? */
  recognized: boolean;
  /** Does this app already have officials data for it (CITIES)? If true, the submission must be rejected — §2.6 scopes this pipeline to brand-new cities only. */
  alreadyCovered: boolean;
  /** The name exactly as spelled in city-anchor-points.json (CTU/MnGeo spelling), for storing on the submission row — null unless recognized. */
  canonicalName: string | null;
  gnisId: number | null;
  lng: number | null;
  lat: number | null;
}

const UNRECOGNIZED: CityMatchResult = {
  recognized: false,
  alreadyCovered: false,
  canonicalName: null,
  gnisId: null,
  lng: null,
  lat: null,
};

/** Fold-matches a visitor-submitted city name against the statewide anchor-point set and this app's own coverage list. Never throws. */
export function matchCity(rawCityName: string): CityMatchResult {
  const trimmed = rawCityName.trim();
  if (!trimmed) return UNRECOGNIZED;
  const anchor = FOLDED_ANCHOR_POINTS.get(fold(trimmed));
  if (!anchor) return UNRECOGNIZED;
  return {
    recognized: true,
    alreadyCovered: isCoveredCityName(trimmed),
    canonicalName: anchor.canonicalName,
    gnisId: anchor.gnisId,
    lng: anchor.lng,
    lat: anchor.lat,
  };
}
