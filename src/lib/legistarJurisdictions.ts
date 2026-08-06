// Registry entry for Phase 4 (FEATURES.md) — the two MN Legistar
// jurisdictions this app is scaffolding structured votes/matters coverage
// for: St. Paul City Council and the Hennepin County Board. Per AGENTS.md
// §2.1, a layer is exactly two files: an ingest script
// (scripts/ingest/legistar.mjs) plus one registry entry — this one.
//
// This is deliberately narrower than the existing wards/commissioners
// registry-adjacent data (cities.ts, coverage.ts): Hennepin County's board
// *boundaries* and hand-transcribed roster are already served by
// scripts/fetch-commissioners.mjs / public/commissioners.geojson. This
// entry is about a different thing — structured votes, matters, and
// officerecords-sourced holdings from Legistar — that layer doesn't carry
// and isn't a replacement for it (yet).
//
// `emptyStatePath` is what any future UI must read from until a follow-up
// PR wires the full persons/bodies/officerecords → Holding[] ingest.
// scripts/ingest/legistar.mjs writes an honest, always-present empty state
// to each of these paths every run — never a placeholder that could be
// mistaken for real coverage (AGENTS.md §0.3 / §3.1).

export interface LegistarJurisdiction {
  // Legistar's own client path segment (webapi.legistar.com/v1/{client}).
  client: string;
  jurisdiction: string;
  // Ship tier per FEATURES.md's milestone: "St. Paul city council +
  // Hennepin County board at Tier A" — both configured clients ship at
  // Tier A once real data lands; there is no Tier B client configured yet.
  tier: "A" | "B";
  // Public path scripts/ingest/legistar.mjs writes to. Always present,
  // always valid JSON, `holdings: []` until the follow-up ingest lands —
  // see that script's buildEmptyState().
  emptyStatePath: string;
  coverage: string;
}

export const LEGISTAR_JURISDICTIONS: readonly LegistarJurisdiction[] = [
  {
    client: "stpaul",
    jurisdiction: "St. Paul City Council",
    tier: "A",
    emptyStatePath: "/legistar/stpaul.json",
    coverage:
      "Scaffold only: connectivity to Legistar's public API is confirmed, but no persons, votes, or matters have been ingested yet.",
  },
  {
    client: "hennepinmn",
    jurisdiction: "Hennepin County Board",
    tier: "A",
    emptyStatePath: "/legistar/hennepinmn.json",
    coverage:
      "Scaffold only: connectivity to Legistar's public API is confirmed, but no persons, votes, or matters have been ingested yet. " +
      "Board district boundaries and a hand-transcribed roster already exist separately via public/commissioners.geojson — this entry is " +
      "additive (structured votes/matters), not a replacement.",
  },
] as const;
