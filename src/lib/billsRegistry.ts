// Registry entry for the state bills & roll-call votes layer (FEATURES.md
// "Phase 2 — State bills & roll-call votes"), following the two-file
// pattern in AGENTS.md §2.1: scripts/ingest/state-bills.mjs is the fetch
// side, this file is the registry side. Nothing outside this file and the
// ingest script should need to know the layer's output path or status —
// components read it from here (coverage.ts's CoverageNotice consumer
// does exactly that below) rather than hardcoding it.
//
// This app doesn't yet have the full generalized "one entry drives the
// map, legend, filters, ..." registry AGENTS.md §2.1 describes (see
// coverage.ts's own header comment — that pattern is aspirational, not
// built yet). This file is scoped to what this layer actually needs today
// — a single source of truth for its build-output path and honest status
// — so that whichever registry shape lands later has one clear thing to
// absorb instead of several hand-duplicated constants.

// Where scripts/ingest/state-bills.mjs writes its parsed output, once
// parsing is implemented (see that script's module header). Referenced
// here, not hardcoded elsewhere, so a future path change is a one-line
// edit instead of a grep-and-replace.
export const BILLS_DATA_PATH = "/state-bills.json";

// "scaffolded": types + ingest skeleton exist (this PR); the script fetches
//   and snapshots raw Open States payloads but does not yet parse them into
//   BILLS_DATA_PATH, so no bill or vote data is published.
// "live": BILLS_DATA_PATH exists, is read at build time, and is rendered.
// There is deliberately no "partial" state — per AGENTS.md §3.1, this repo
// either has no bill data or has real, sourced bill data; nothing in
// between ships to a reader.
export type BillsIngestStatus = "scaffolded" | "live";

// Flipped to "live" 2026-08-06 after a real run against a live
// OPEN_STATES_API_KEY was reviewed (delta poll: 20 bills, 9 vote events,
// real sponsors/tallies/sources, holding resolution correctly null — see
// AGENTS.md §3.1). This is a delta poll, not a full-session backfill (see
// state-bills.mjs's --backfill / module header) — coverage is "recently
// updated bills," not "every bill this session," until a backfill run
// (rate-limit budget permitting on a free-tier key) or a recurring
// scheduled delta poll accumulates fuller coverage over time.
export const BILLS_INGEST_STATUS: BillsIngestStatus = "live";

// Plain-language description of this layer's current state, for
// CoverageNotice / any future bill-page empty state to render verbatim
// rather than each writing its own version that can drift out of sync.
export const BILLS_COVERAGE_NOTE =
  "State bill text, sponsors, action history, and floor roll-call votes (Open States, cross-checked against LegiScan where a LEGISCAN_API_KEY is configured — none is yet, so tally cross-checks aren't running). A capped, resumable backfill (scripts/ingest/state-bills.mjs --backfill) is in progress for the 2025-2026 session — most bills aren't ingested yet; run it again to continue from where it left off. Delta polling (no flag) picks up new changes incrementally once backfill catches up.";
