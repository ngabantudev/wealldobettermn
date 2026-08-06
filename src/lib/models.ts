// src/lib/models.ts
//
// The normalized, relational entity model described in FEATURES.md's "Data
// model (build this first...)" section: jurisdiction, office, person,
// holding, body, meeting, agenda_item, vote_event, vote, bill,
// source_record. Deliberately a *separate* file from types.ts rather than
// an addition to it:
//
//   - types.ts is the flat, denormalized shape MapLibre feature properties
//     already carry on the wire today (RepProperties et al.) — one row per
//     ward/pin, built for a GeoJSON FeatureCollection and rendered
//     directly. It has real callers (WardMap.tsx, WardModal.tsx) and this
//     task does not touch them.
//   - models.ts is the relational model FEATURES.md Phase 1 asks for
//     first — entities and foreign keys, meant to be joined
//     (address → district → officeholder → body → committee → agenda item
//     → vote, per AGENTS.md §0.1), not flattened into map-pin properties.
//
// Mixing the two would blur "what a map feature carries on screen" with
// "how the underlying civic facts relate to each other," which is exactly
// the distinction AGENTS.md §0.1 asks the data model to make explicit. A
// future ingest step is expected to *derive* RepProperties-shaped features
// from these entities (a `holding` joined to its `office` and `person`),
// not the other way around — but that derivation is not part of this
// scaffolding change. Nothing in this file is wired into the map yet.
//
// Every entity here is an OFFICEHOLDER/systemic record per AGENTS.md
// §1a/§1d — `person` in this file is the officeholder identity a
// `holding` points at, never a private individual. There is no variant
// for a private individual, by construction, matching the discriminated-
// union requirement in §1d for the day a `person_type` field is needed.
// FEATURES.md's own sketch names the identity field differently; it's
// spelled `official_name` here instead, to keep the field itself
// declaring what AGENTS.md §1a already requires of every record it's
// attached to — this is always a name held in an official capacity,
// never a bare personal identifier.

// ---------------------------------------------------------------------------
// Coverage tiers (FEATURES.md) — a DISTINCT concept from src/lib/coverage.ts
// ---------------------------------------------------------------------------
//
// src/lib/coverage.ts implements AGENTS.md §3.3's "What this map can't
// see" — a human-readable, narrative disclosure keyed to *display layers*
// (which cities have wards mapped, which counties have commissioners,
// etc.). CoverageTier below is a different, structured concept from
// FEATURES.md: a per-`jurisdiction` rating of how *complete* this repo's
// relational data is for that jurisdiction, independent of whether any
// map layer exists for it at all. A jurisdiction can be Tier A (full
// votes + meetings + agendas) with no map pin, or have a map layer with
// only Tier C (roster + contact) data behind it.
//
// This file does not read from, write to, or repurpose anything exported
// by coverage.ts. The two are meant to be cross-referenced by a future
// UI, never merged into one field.
export type CoverageTier =
  // Full votes + meetings + agendas.
  | "A"
  // Meetings + agendas, no structured votes.
  | "B"
  // Roster + contact info only.
  | "C";

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export type JurisdictionLevel = "city" | "county" | "state";

export interface Jurisdiction {
  id: string;
  name: string;
  level: JurisdictionLevel;
  // Open Civic Data identifier per AGENTS.md §2.4, e.g.
  // "ocd-division/country:us/state:mn". Primary key for interchange with
  // sister projects; `id` above is this repo's own stable key and may or
  // may not equal it.
  ocd_id: string;
  coverage_tier: CoverageTier;
}

export interface Office {
  id: string;
  jurisdiction_id: Jurisdiction["id"];
  name: string;
  seat_label: string;
  ocd_id: string;
}

// The officeholder identity record. NOT a private individual — see the
// file header and AGENTS.md §1a/§1d. A `person` with no `holding`
// pointing at it is not itself an official act and should not be
// persisted per §1d's "a person with no attributed official act gets no
// record."
export interface Person {
  id: string;
  official_name: string;
  slug: string;
  photo_url: string | null;
}

// The join between a person and an office over a span of time — modeled
// as its own first-class entity per the task instructions, so that votes,
// committee seats, and everything else that depends on "who held this
// office when" attach to `holding_id`, never directly to `person_id`.
// This is what lets a person hold the same office twice non-contiguously,
// or two offices at once, without ambiguity, and what lets AGENTS.md
// §1d's "never delete a holding, officials leave the active layer but
// their acts remain, dated and attributed to the office they held" hold
// structurally rather than by convention.
export interface Holding {
  id: string;
  office_id: Office["id"];
  person_id: Person["id"];
  term_start: string; // ISO date
  // null means currently serving — see AGENTS.md §1d ("end_date IS NULL
  // means currently serving. Never delete a holding.").
  term_end: string | null;
  source_url: string;
  // Ingest bookkeeping, not display: the first and most recent run in
  // which this holding was observed in an upstream feed. Distinct from
  // term_start/term_end, which are the term's own dates as the source
  // states them, not our own scrape history.
  first_seen: string;
  last_seen: string;
  // Required per AGENTS.md §3.2: every officeholder-sourced record
  // carries its own verification bookkeeping so the UI can render a
  // staleness notice and the build can fail loudly on a stale record
  // relative to the most recent general election. See electionConfig.ts.
  verifiedAt: string; // ISO date this holding was last checked against verifiedAgainst
  verifiedAgainst: string; // source URL — may differ from source_url (e.g. a bulk snapshot vs. the original filing)
}

export interface Body {
  id: string;
  jurisdiction_id: Jurisdiction["id"];
  // e.g. "Minneapolis City Council", "House Judiciary Finance and Civil
  // Law Committee" — council, committee, or board.
  name: string;
}

export interface Meeting {
  id: string;
  body_id: Body["id"];
  date: string; // ISO date
  agenda_url: string | null;
  minutes_url: string | null;
  video_url: string | null;
}

export interface AgendaItem {
  id: string;
  meeting_id: Meeting["id"];
  title: string;
  file_number: string | null;
  external_id: string | null;
}

export interface VoteEvent {
  id: string;
  agenda_item_id: AgendaItem["id"];
  result: string; // "pass" | "fail" | source's own wording — kept as-is, see AGENTS.md §3.3
  date: string; // ISO date
}

export type VoteValue = "yea" | "nay" | "absent" | "abstain";

// Attaches to `holding_id`, per the task's explicit modeling requirement
// ("votes attach to holding_id, not person_id directly") and per
// AGENTS.md §1d: a vote is an act of the office as held during a specific
// term, so if the same person later returns to the same seat under a new
// `holding`, the two terms' votes stay attributed to the term that cast
// them rather than being merged under one person-wide vote list.
export interface Vote {
  id: string;
  vote_event_id: VoteEvent["id"];
  holding_id: Holding["id"];
  value: VoteValue;
}

export interface Bill {
  id: string;
  jurisdiction_id: Jurisdiction["id"];
  identifier: string; // e.g. "HF 4541"
  title: string;
  session: string;
  status: string;
}

// Provenance record for any entity above, matching AGENTS.md §2.2's
// "Provenance Record (required per feature)" — kept generic over
// `entity_type`/`entity_id` rather than duplicated per entity, since the
// same shape (url, hash, fetched_at, raw upstream payload) applies
// identically to all of them.
export interface SourceRecord {
  id: string;
  entity_type:
    | "jurisdiction"
    | "office"
    | "person"
    | "holding"
    | "body"
    | "meeting"
    | "agenda_item"
    | "vote_event"
    | "vote"
    | "bill";
  entity_id: string;
  url: string;
  hash: string;
  fetched_at: string; // ISO datetime
  raw_blob: unknown;
}
