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

// --- Wire shape written to each LEGISTAR_JURISDICTIONS[].emptyStatePath by
// scripts/ingest/legistar.mjs's full per-client ingest — mirrors that
// script's actual JSON output field-for-field, not models.ts's normalized
// AgendaItem/VoteEvent stubs (which have zero real consumers — see that
// file's own 2026-08-06 note on why the flat wire shape and the relational
// model are deliberately not the same types). src/app/recap/page.tsx is the
// first real reader of this shape, so it types against the bytes actually on
// disk rather than an aspirational schema. Only the fields recap.tsx reads
// are declared here (bodies/persons/offices/holdings/meetings/votes exist in
// the file too but have no reader yet); extend this if a future consumer
// needs more of the payload.

export interface LegistarAgendaItem {
  id: string;
  meeting_id: string;
  title: string;
  file_number: string | null;
  external_id: string | null;
  // The item's own Legistar legislation-detail page — present on every
  // record as ingested so far, but typed nullable (never guessed at) per
  // AGENTS.md §3.3 "Missing Sources": a future ingest run could return a
  // record Legistar itself hasn't published a detail page for yet.
  source_url: string | null;
}

export interface LegistarVoteEvent {
  id: string;
  agenda_item_id: string;
  result: string; // "Pass" | "Fail" | source's own wording — kept as-is, AGENTS.md §3.3
  date: string; // ISO date
}

export interface LegistarFullIngestProvenance {
  primarySourceUrl: string;
  sourceAgency: string;
  documentType: string;
  documentId: string | null;
  issuedDate: string | null;
  fetchedAt: string | null;
  licence: string;
  contentHash: string | null;
}

export interface LegistarFullIngestFeed {
  schemaVersion: number;
  client: string;
  jurisdiction: string;
  generatedAt: string;
  status: "ingested" | "unreachable" | "auth_required";
  note: string;
  provenance: LegistarFullIngestProvenance;
  agendaItems: LegistarAgendaItem[];
  voteEvents: LegistarVoteEvent[];
  knownGaps: string[];
}
