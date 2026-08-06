// Registry entry (AGENTS.md §2.1) for FEATURES.md Phase 7's suburban and
// outstate coverage inventory. This is the "one entry under src/lib" half
// of the two-file addition — scripts/ingest/probe-legistar.mjs is the
// fetch/ingest half, and public/jurisdiction-platform-inventory.json is
// its emitted output.
//
// This phase is deliberately research-shaped, not scraper-shaped (see
// FEATURES.md Phase 7): the deliverable here is a table of what platform
// each city runs, not a working per-city scraper. Nothing in this file
// renders UI yet — CoverageNotice.tsx / coverage.ts stay untouched by this
// PR — but the tier default below is the single place that decision
// lives, so a future adapter promotion (or a future UI surface reading
// this inventory) has one place to import it from rather than
// re-deriving it.

import type { CivicPlatform, CoverageTier, JurisdictionPlatformRecord } from "./types";

// FEATURES.md Phase 7, "Coverage tiers": every jurisdiction starts at C
// (roster + contact info only, achievable everywhere off the city's own
// website) and is promoted to B (per-platform adapter: meetings + agendas,
// no structured votes) or A (Legistar-class: full votes + meetings +
// agendas) only once real integration work — not a probe hit alone —
// backs that claim.
export const DEFAULT_COVERAGE_TIER: CoverageTier = "C";

// A Legistar `/bodies` hit is strong enough evidence to promote a city
// straight to Tier A per FEATURES.md Phase 7 step 2 ("any hit promotes
// that city straight to Tier A") — this is the only automatic promotion
// this phase performs. Every other platform value requires a human or a
// future per-platform adapter to set the tier explicitly; this function
// intentionally does not branch on `civicplus`/`granicus`/`icompass` for
// that reason.
export function coverageTierFor(platform: CivicPlatform): CoverageTier {
  return platform === "legistar" ? "A" : DEFAULT_COVERAGE_TIER;
}

// ocd-division/country:us/state:mn/place:{slug} per AGENTS.md §2.4 — the
// same slug shape (lowercase, spaces to hyphens, no punctuation) used
// throughout the OCD id spec. Not yet cross-checked against a canonical
// divisions dataset (none exists in this repo yet; see the note in
// types.ts above JurisdictionPlatformRecord).
export function toJurisdictionId(city: string): string {
  const slug = city
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `ocd-division/country:us/state:mn/place:${slug}`;
}

// Builds an honest, unprobed record for a city — every field records
// "not yet determined" rather than a guess. Used by the seed step for
// public/jurisdiction-platform-inventory.json; scripts/ingest/probe-legistar.mjs
// overwrites `platform`/`probedAt`/`sourceUrl`/`coverageTier` only for
// cities it actually gets a live hit for.
export function unprobedRecord(city: string): JurisdictionPlatformRecord {
  return {
    jurisdictionId: toJurisdictionId(city),
    city,
    platform: "unknown",
    probedAt: null,
    sourceUrl: null,
    coverageTier: DEFAULT_COVERAGE_TIER,
  };
}
