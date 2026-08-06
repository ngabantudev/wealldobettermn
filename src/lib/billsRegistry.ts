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

export const BILLS_INGEST_STATUS: BillsIngestStatus = "scaffolded";

// Plain-language description of this layer's current state, for
// CoverageNotice / any future bill-page empty state to render verbatim
// rather than each writing its own version that can drift out of sync.
export const BILLS_COVERAGE_NOTE =
  "State bill text, sponsors, action history, and floor roll-call votes (Open States, cross-checked against LegiScan). Ingest pipeline is scaffolded but has not yet been run against a live API key — no bill or vote data is published yet.";
