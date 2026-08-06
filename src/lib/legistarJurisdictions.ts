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
// `emptyStatePath` is the public path scripts/ingest/legistar.mjs writes
// to every run. As of the full-ingest run landed 2026-08-06, both clients
// carry real Body[]/Person[]/Office[]/Holding[] (from /officerecords) and a
// bounded recent-window Meeting[]/AgendaItem[]/VoteEvent[]/Vote[] (from
// /matters + /matters/{id}/histories + /eventitems/{id}/votes) — not the
// empty scaffold state. If a future run fails (network, token, or the
// officeholder-title filter leaving nothing publishable), the script falls
// back to the same honest, always-present empty state it always has —
// never a placeholder that could be mistaken for real coverage (AGENTS.md
// §0.3 / §3.1) — so `emptyStatePath` is still the correct field name and
// still the path any future UI reads from either way.

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
      "Full officerecords-sourced roster (220 holdings across 26 council/committee offices, 41 people) live as of the " +
      "2026-08-06 ingest, plus a rolling 60-day window of City Council votes (111 vote events, 777 individual votes) — " +
      "not a full-term backfill; see the file's own knownGaps for the current term's actual start date and the per-run " +
      "matter cap. No per-seat/ward identifiers: Legistar exposes body membership, not electoral districts, for this " +
      "client — see wards.geojson for ward geography.",
  },
  {
    client: "hennepinmn",
    jurisdiction: "Hennepin County Board",
    tier: "A",
    emptyStatePath: "/legistar/hennepinmn.json",
    coverage:
      "Full officerecords-sourced roster (156 holdings across 18 board/committee offices, 8 people) live as of the " +
      "2026-08-06 ingest, plus a rolling 60-day window of County Board votes (54 vote events, 22 individual votes) — " +
      "not a full-term backfill; see the file's own knownGaps for the current term's actual start date. Board district " +
      "boundaries and a hand-transcribed roster already exist separately via public/commissioners.geojson — this entry " +
      "is additive (structured votes/matters, officerecords term dates), not a replacement.",
  },
] as const;
