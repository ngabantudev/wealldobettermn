// src/lib/electionResultsTypes.ts
//
// Output types for scripts/ingest/mn-election-results.mjs — the MN
// Secretary of State's semicolon-delimited state primary/general election
// results files (2026 MN state primary, ersElectionId=200, is the first
// election this importer targets).
//
// --- No winner/projected field, by construction -----------------------
//
// AGENTS.md §1c: "Do not compute, publish, or imply a causal claim... no
// corruption scores, no 'bought by' labels, no derived influence rankings,
// no auto-generated accusations." The same discipline applies to election
// calling: this site renders ordered vote counts and percentages, never a
// computed "winner," "projected," "leading," or "advances to November"
// field. That's a hard rule (not a style preference) precisely because
// calling a race is an inference on top of the raw counts, not a
// restatement of them — the exact line §1c draws.
//
// This file enforces that the same way campaignFinanceTypes.ts enforces
// AGENTS.md §1d's "no variant for a private individual, by construction"
// rule for campaign finance: there is no field anywhere in CandidateResult,
// Contest, or ElectionResultsIndex for a winner/projected/leading/
// advances-to claim — not a boolean, not an optional string, not a
// commented-out placeholder. A maintainer who wants to add one has to
// invent a wholly new interface against this file's own stated purpose,
// not just populate an existing field. The ingest script additionally
// carries a runtime assertion (assertNoForbiddenField in
// scripts/ingest/mn-election-results.mjs) that refuses to write output if
// a forbidden-looking field name ever appears on a record — a structural
// backstop on top of this file's own missing field, not a substitute for
// it.
//
// --- Certification status is not "live" ---------------------------------
//
// AGENTS.md's "no LIVE framing" instruction (this project's standing
// decision, not a §-numbered rule) is implemented as three deliberately
// separate fields, never conflated:
//   - certificationStatus: the real-world legal status of the count
//     ("unofficial" | "county-canvassed" | "state-certified") — see
//     Minn. Stat. § 204C.32 for the county/state canvassing board process.
//   - resultsAsOf: for a live network fetch (the default path, as of the
//     2026-08-12 rework), the MOST RECENT `Last-Modified` response header
//     across all 10 fetched sources — a real timestamp the file host
//     itself reports, not a per-contest-precise value (see
//     fetchFromNetwork()'s own comment in the ingest script). Null for the
//     --offline/manual-drop fallback path, where no equivalent header
//     exists to read, and null if a Last-Modified header was ever missing
//     from a response (never guessed, per AGENTS.md §3.3).
//   - fetchedAt (on ElectionResultsProvenance): when THIS SCRIPT ran. For
//     the live network path this is a genuine fetch timestamp; for the
//     --offline/manual-drop path it's still just when the script processed
//     whatever was sitting in the drop directory, not when a human
//     downloaded it — see that field's own doc comment.
// A UI rendering any of these must show them as what they are, not
// collapse them into a single "as of" string that reads as more current
// than the data actually is.

// Provenance record, AGENTS.md §2.2/§3.3. Appears once per emitted file
// (the index and each per-contest detail file), mirroring
// CampaignFinanceProvenance's shape in campaignFinanceTypes.ts.
export interface ElectionResultsProvenance {
  primarySourceUrl: string;
  sourceAgency: string;
  documentType: string;
  // The ersElectionId this run was configured for (e.g. "200") — not a
  // per-file document id, since the SOS's own files don't carry one in
  // the confirmed column layout.
  documentId: string | null;
  // Best-effort date the underlying file claims for itself, when present.
  // Null for the confirmed 16-column layout (no date column) — see the
  // ingest script's own comment. Never guessed.
  issuedDate: string | null;
  // When this script ran. For the live network path (default, since the
  // 2026-08-12 rework) this is a genuine fetch timestamp against
  // electionresultsfiles.sos.mn.gov. For the --offline/manual-drop
  // fallback path it is NOT a live fetch timestamp: a human downloaded the
  // source file in a browser at some earlier, unrecorded time (this script
  // has no way to know when); this field only records when the ingest ran
  // against whatever was sitting in the drop directory at that moment. See
  // this file's header comment and the ingest script's own header for the
  // full distinction.
  fetchedAt: string;
  licence: string;
  // SHA-256 of the raw input file's own bytes, not of this script's parsed
  // representation of it — same convention as CampaignFinanceProvenance.
  contentHash: string;
}

export type CertificationStatus = "unofficial" | "county-canvassed" | "state-certified";

// One candidate's vote total within a contest. Deliberately not a person
// record — see AGENTS.md §1d and this file's header comment.
// candidateName is a label on a vote total, never a foreign key into
// src/lib/models.ts's Person/officeholder types, and this interface is
// never extended to carry one.
export interface CandidateResult {
  candidateName: string;
  // Raw party label as the source file reports it (e.g. "DFL", "R", "IP")
  // — never re-interpreted or mapped to this app's own party-display
  // vocabulary. Null when the source row's Party column is blank (some
  // nonpartisan contests report no party).
  candidateParty: string | null;
  votes: number;
  // Computed once, at ingest time, per the documented rounding rule in
  // computeVotePercent() (scripts/ingest/mn-election-results.mjs) — never
  // recomputed differently by a component. This is arithmetic restatement
  // of `votes` against the contest total, not an inference, so it's
  // allowed under AGENTS.md §1c the same way ContributionAggregate
  // band totals are.
  votePercent: number;
  // Heuristic (candidate name matches a write-in pattern) — see the
  // ingest script's isWriteInCandidate() and this layer's knownGaps for
  // why this isn't derived from an explicit SOS flag.
  isWriteIn: boolean;
}

// Cheap summary entry in the index's contest list (AGENTS.md §0.7
// "progressive precision") — enough to render a contest list/search and
// decide whether to fetch the full detail file.
export interface ContestSummary {
  contestId: string;
  contestName: string;
  district: string | null;
  county: string | null;
  precinctsReporting: number;
  totalPrecincts: number;
  totalVotes: number;
  candidateCount: number;
  // Path under public/ this contest's detail file is served from, fetched
  // lazily only when a user opens this contest's record — same convention
  // as CampaignFinanceCandidateSummary.dataPath.
  dataPath: string;
}

// public/election-results/contests/<contestId>.json — fetched lazily.
export interface Contest {
  schemaVersion: 1;
  contestId: string;
  contestName: string;
  district: string | null;
  county: string | null;
  precinctsReporting: number;
  totalPrecincts: number;
  totalVotes: number;
  certificationStatus: CertificationStatus;
  resultsAsOf: string | null;
  // Ordered by vote count, descending — a plain sort of the restated
  // numbers, not a computed "winner" (see this file's header comment).
  // Ties are left in source order rather than broken arbitrarily.
  candidates: CandidateResult[];
  provenance: ElectionResultsProvenance;
}

// public/election-results/index.json — the one file loaded upfront.
export interface ElectionResultsIndex {
  schemaVersion: 1;
  ersElectionId: string;
  electionName: string;
  electionDate: string; // ISO date, e.g. "2026-08-11"
  generatedAt: string;
  certificationStatus: CertificationStatus;
  resultsAsOf: string | null;
  provenance: ElectionResultsProvenance;
  contests: ContestSummary[];
  // Per AGENTS.md §3.3 Coverage Honesty — what this run structurally
  // couldn't see (bot-wall/manual-input constraint, no precinct geometry,
  // no candidate/person records, pending FTP access request, etc.).
  knownGaps: string[];
}
