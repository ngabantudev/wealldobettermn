// src/lib/communitySubmissions.ts
//
// D1 query layer for the Community Contribution Pipeline (AGENTS.md §2.6).
// Every write here is a parameterized statement (`.bind(...)`, never
// string-interpolated SQL) and every state transition that matters —
// reaching COMMUNITY_CONFIRMATIONS_REQUIRED, reaching a dispute threshold
// — is a single guarded UPDATE (`WHERE status = 'pending'`) so a race
// between two simultaneous requests can only ever be "won" once. See
// migrations/0001_community_submissions.sql for the schema this operates
// against.
//
// `D1DatabaseLike` is a narrow, hand-written interface capturing only the
// D1 methods this module calls, not a dependency on `@cloudflare/workers-
// types` (not installed in this repo yet — this app has no Cloudflare
// data binding to generate types from until wrangler.jsonc's D1 entry is
// actually provisioned). Same "narrow, injectable interface" pattern as
// CommunityAiBinding in communityExtraction.ts, and it keeps this module
// testable against a real (in-memory) SQLite database via Node's built-in
// `node:sqlite` — see communitySubmissions.test.mjs — rather than a
// hand-rolled mock that might silently drift from real SQL semantics.

import {
  COMMUNITY_CONFIRMATIONS_REQUIRED,
  COMMUNITY_GRADUATION_DISPUTE_THRESHOLD,
  COMMUNITY_PENDING_DISPUTE_THRESHOLD,
} from "./communityConfig.ts";
import type { ValidatedOfficial } from "./communityExtraction.ts";

export interface D1RunResult {
  success: boolean;
  meta: { changes: number; last_row_id?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<D1RunResult>;
  all<T = unknown>(): Promise<{ success: boolean; results: T[] }>;
  first<T = unknown>(column?: string): Promise<T | null>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export type SubmissionStatus = "pending" | "graduating" | "graduated" | "disputed" | "rejected" | "expired";

export interface SubmissionRecord {
  id: string;
  cityName: string;
  gnisId: number | null;
  sourceUrl: string;
  status: SubmissionStatus;
  officials: ValidatedOfficial[];
  confirmations: number;
  flags: number;
  disputeCount: number;
  submittedAt: string;
  graduatedAt: string | null;
  graduationCommitSha: string | null;
}

interface SubmissionRow {
  id: string;
  city_name: string;
  gnis_id: number | null;
  source_url: string;
  status: SubmissionStatus;
  extracted_json: string;
  confirmations: number;
  flags: number;
  dispute_count: number;
  submitted_at: string;
  graduated_at: string | null;
  graduation_commit_sha: string | null;
}

function mapRow(row: SubmissionRow): SubmissionRecord {
  return {
    id: row.id,
    cityName: row.city_name,
    gnisId: row.gnis_id,
    sourceUrl: row.source_url,
    status: row.status,
    officials: JSON.parse(row.extracted_json) as ValidatedOfficial[],
    confirmations: row.confirmations,
    flags: row.flags,
    disputeCount: row.dispute_count,
    submittedAt: row.submitted_at,
    graduatedAt: row.graduated_at,
    graduationCommitSha: row.graduation_commit_sha,
  };
}

export interface InsertSubmissionParams {
  id: string;
  cityName: string;
  gnisId: number | null;
  sourceUrl: string;
  officials: ValidatedOfficial[];
  submittedAt: string;
}

/**
 * Inserts a new `pending` submission. Relies on
 * `idx_one_pending_per_city` to reject a second concurrent pending
 * submission for the same city at the database level — callers should
 * still check `getPendingSubmissionForCity` first for a fast, friendly
 * `duplicate_pending` response, but the constraint is the real guarantee,
 * not the pre-check (AGENTS.md §2.2-style defense in depth).
 */
export async function insertSubmission(db: D1DatabaseLike, params: InsertSubmissionParams): Promise<void> {
  await db
    .prepare(
      `INSERT INTO submissions (id, city_name, gnis_id, source_url, status, extracted_json, submitted_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(params.id, params.cityName, params.gnisId, params.sourceUrl, JSON.stringify(params.officials), params.submittedAt)
    .run();
}

export async function getPendingSubmissionForCity(db: D1DatabaseLike, cityName: string): Promise<SubmissionRecord | null> {
  const row = await db
    .prepare(`SELECT * FROM submissions WHERE city_name = ? AND status = 'pending' LIMIT 1`)
    .bind(cityName)
    .first<SubmissionRow>();
  return row ? mapRow(row) : null;
}

export async function getSubmissionById(db: D1DatabaseLike, id: string): Promise<SubmissionRecord | null> {
  const row = await db.prepare(`SELECT * FROM submissions WHERE id = ?`).bind(id).first<SubmissionRow>();
  return row ? mapRow(row) : null;
}

/**
 * Every non-terminal submission the map should show — `pending` (still
 * collecting confirmations) and `graduating` (the 3rd-confirm race was
 * just won, the GitHub dispatch is in flight). `graduated`/`disputed`/
 * `rejected`/`expired` are all terminal and never served here — a
 * graduated record is served from the real static `mayors.geojson` after
 * the next deploy instead (AGENTS.md §2.6's "no downstream callbacks"
 * clarification: this feed is a transient view, not the contract).
 */
export async function listLiveSubmissionsForMap(db: D1DatabaseLike): Promise<SubmissionRecord[]> {
  const { results } = await db
    .prepare(`SELECT * FROM submissions WHERE status IN ('pending', 'graduating') ORDER BY submitted_at DESC`)
    .bind()
    .all<SubmissionRow>();
  return results.map(mapRow);
}

export type VoteType = "confirm" | "flag";

export type CastVoteResult =
  | { outcome: "duplicate" }
  | { outcome: "not_found" }
  | { outcome: "already_settled"; status: SubmissionStatus }
  | { outcome: "recorded"; confirmations: number; flags: number; triggeredGraduation: boolean; triggeredPendingDispute: boolean };

export interface CastVoteParams {
  submissionId: string;
  voteType: VoteType;
  dedupKey: string;
  createdAt: string;
}

/**
 * Records one confirm/flag vote and, if it crosses a threshold, performs
 * the one guarded state-transition UPDATE that can only ever succeed for
 * one concurrent caller (`WHERE status = 'pending'`) — see this module's
 * header. Returns which transition (if any) THIS call is the one that
 * triggered, so the caller (the API route) knows whether it's the one
 * that should fire the GitHub `repository_dispatch` / open the dispute
 * issue, rather than every request racing to do so.
 */
export async function castVote(db: D1DatabaseLike, params: CastVoteParams): Promise<CastVoteResult> {
  const existing = await getSubmissionById(db, params.submissionId);
  if (!existing) return { outcome: "not_found" };
  if (existing.status !== "pending") {
    // Votes only make sense pre-graduation; a submission that already
    // graduated/was disputed/rejected/expired isn't accepting confirms or
    // flags through this path (post-graduation uses recordDispute below).
    return { outcome: "already_settled", status: existing.status };
  }

  const insertResult = await db
    .prepare(`INSERT INTO votes (submission_id, vote_type, dedup_key, created_at) VALUES (?, ?, ?, ?)
              ON CONFLICT (submission_id, dedup_key) DO NOTHING`)
    .bind(params.submissionId, params.voteType, params.dedupKey, params.createdAt)
    .run();
  if (insertResult.meta.changes === 0) {
    return { outcome: "duplicate" };
  }

  // Interpolated, not bound — but safe by construction: this ternary can
  // only ever produce one of the two literal strings below, regardless of
  // what params.voteType actually contains (anything other than the exact
  // string "confirm" falls to "flags"), so no attacker-controlled content
  // ever reaches the column-name position. Every value (the id) is still
  // a bound parameter.
  const column = params.voteType === "confirm" ? "confirmations" : "flags";
  const updated = await db
    .prepare(`UPDATE submissions SET ${column} = ${column} + 1 WHERE id = ? RETURNING confirmations, flags`)
    .bind(params.submissionId)
    .first<{ confirmations: number; flags: number }>();
  const confirmations = updated?.confirmations ?? 0;
  const flags = updated?.flags ?? 0;

  let triggeredGraduation = false;
  let triggeredPendingDispute = false;

  if (params.voteType === "confirm" && confirmations >= COMMUNITY_CONFIRMATIONS_REQUIRED) {
    const flip = await db
      .prepare(`UPDATE submissions SET status = 'graduating' WHERE id = ? AND status = 'pending' RETURNING id`)
      .bind(params.submissionId)
      .first<{ id: string }>();
    triggeredGraduation = flip !== null;
  } else if (params.voteType === "flag" && flags >= COMMUNITY_PENDING_DISPUTE_THRESHOLD) {
    const flip = await db
      .prepare(`UPDATE submissions SET status = 'disputed' WHERE id = ? AND status = 'pending' RETURNING id`)
      .bind(params.submissionId)
      .first<{ id: string }>();
    triggeredPendingDispute = flip !== null;
  }

  return { outcome: "recorded", confirmations, flags, triggeredGraduation, triggeredPendingDispute };
}

export interface MarkGraduatedParams {
  id: string;
  graduatedAt: string;
  commitSha: string;
}

/** Called by the graduation script (via an authenticated endpoint) once its commit lands. */
export async function markGraduated(db: D1DatabaseLike, params: MarkGraduatedParams): Promise<void> {
  await db
    .prepare(`UPDATE submissions SET status = 'graduated', graduated_at = ?, graduation_commit_sha = ? WHERE id = ?`)
    .bind(params.graduatedAt, params.commitSha, params.id)
    .run();
}

export interface RecordDisputeResult {
  disputeCount: number;
  triggeredRevertIssue: boolean;
}

/**
 * Post-graduation dispute (AGENTS.md §2.6's deliberately-asymmetric
 * mitigation for the zero-pre-commit-review risk acceptance). Only valid
 * against a `graduated` submission — increments `dispute_count`, and at
 * COMMUNITY_GRADUATION_DISPUTE_THRESHOLD tells the caller to open a
 * (human-merge-required) revert issue. Never flips status itself; nothing
 * about a graduated record auto-reverts.
 */
export async function recordDispute(db: D1DatabaseLike, submissionId: string): Promise<RecordDisputeResult | null> {
  const existing = await getSubmissionById(db, submissionId);
  if (!existing || existing.status !== "graduated") return null;

  const updated = await db
    .prepare(`UPDATE submissions SET dispute_count = dispute_count + 1 WHERE id = ? RETURNING dispute_count`)
    .bind(submissionId)
    .first<{ dispute_count: number }>();
  const disputeCount = updated?.dispute_count ?? existing.disputeCount + 1;

  return { disputeCount, triggeredRevertIssue: disputeCount >= COMMUNITY_GRADUATION_DISPUTE_THRESHOLD };
}

// --- Submission-creation rate limiting (migrations/0002) -------------------
// See that migration's own header for why this is a separate append-only
// log rather than a column on `submissions` — it has to count every
// attempt, not just accepted ones, or the limit is trivially bypassable.

/** Logs one POST /api/submissions attempt, regardless of its eventual outcome. */
export async function recordSubmissionAttempt(db: D1DatabaseLike, ipHash: string, createdAt: string): Promise<void> {
  await db.prepare(`INSERT INTO submission_attempts (ip_hash, created_at) VALUES (?, ?)`).bind(ipHash, createdAt).run();
}

/** Count of attempts from this hashed IP since `sinceIso` — a rolling window, not a calendar-day bucket. */
export async function countRecentSubmissionAttempts(db: D1DatabaseLike, ipHash: string, sinceIso: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) as count FROM submission_attempts WHERE ip_hash = ? AND created_at > ?`)
    .bind(ipHash, sinceIso)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
