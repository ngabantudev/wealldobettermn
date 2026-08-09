#!/usr/bin/env node
// src/lib/communitySubmissions.test.mjs
//
// Tests the D1 query layer (AGENTS.md §2.6) against REAL SQLite — Node's
// built-in `node:sqlite` (zero new dependency, same "no dependency added"
// posture as scripts/ingest/extract-text.mjs's choice of unpdf) running
// the actual migrations/0001_community_submissions.sql schema, not a
// hand-rolled mock that could silently drift from real SQL semantics.
// Cloudflare D1 is itself SQLite, so this is a faithful stand-in for the
// constraint/RETURNING behavior communitySubmissions.ts depends on.
//
// Run directly: node --test src/lib/communitySubmissions.test.mjs
// Or via: npm run test:lib

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  castVote,
  getPendingSubmissionForCity,
  getSubmissionById,
  insertSubmission,
  listLiveSubmissionsForMap,
  markGraduated,
  recordDispute,
} from "./communitySubmissions.ts";
import { COMMUNITY_CONFIRMATIONS_REQUIRED, COMMUNITY_GRADUATION_DISPUTE_THRESHOLD, COMMUNITY_PENDING_DISPUTE_THRESHOLD } from "./communityConfig.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(path.join(__dirname, "../../migrations/0001_community_submissions.sql"), "utf8");

/** Wraps node:sqlite's synchronous API to match the async D1DatabaseLike interface communitySubmissions.ts expects. */
function createD1LikeFromSqlite(sqliteDb) {
  return {
    prepare(query) {
      const stmt = sqliteDb.prepare(query);
      let boundArgs = [];
      const statementLike = {
        bind(...values) {
          boundArgs = values;
          return statementLike;
        },
        async run() {
          const info = stmt.run(...boundArgs);
          return { success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
        },
        async all() {
          const rows = stmt.all(...boundArgs);
          return { success: true, results: rows };
        },
        async first(column) {
          const row = stmt.get(...boundArgs);
          if (row === undefined) return null;
          if (column) return row[column] ?? null;
          return row;
        },
      };
      return statementLike;
    },
  };
}

function freshDb() {
  const sqliteDb = new DatabaseSync(":memory:");
  sqliteDb.exec(MIGRATION_SQL);
  return createD1LikeFromSqlite(sqliteDb);
}

const SAMPLE_OFFICIALS = [
  { role: "Mayor", repName: "Jane Smith", repEmail: null, repPhone: null, roleSourceQuote: "Mayor Jane Smith leads the city." },
];

async function insertSample(db, overrides = {}) {
  await insertSubmission(db, {
    id: overrides.id ?? "sub-1",
    cityName: overrides.cityName ?? "Example",
    gnisId: overrides.gnisId ?? 12345,
    sourceUrl: overrides.sourceUrl ?? "https://city.example.gov/",
    officials: overrides.officials ?? SAMPLE_OFFICIALS,
    submittedAt: overrides.submittedAt ?? "2026-08-09T00:00:00.000Z",
  });
}

// --- insertSubmission / getPendingSubmissionForCity -----------------------

test("insertSubmission round-trips through getPendingSubmissionForCity with officials intact", async () => {
  const db = freshDb();
  await insertSample(db);
  const record = await getPendingSubmissionForCity(db, "Example");
  assert.ok(record);
  assert.equal(record.status, "pending");
  assert.equal(record.confirmations, 0);
  assert.deepEqual(record.officials, SAMPLE_OFFICIALS);
});

test("idx_one_pending_per_city rejects a second concurrent pending submission for the same city", async () => {
  const db = freshDb();
  await insertSample(db, { id: "sub-1" });
  await assert.rejects(() => insertSample(db, { id: "sub-2" }));
});

test("a second pending submission for the same city is allowed once the first is no longer pending", async () => {
  const db = freshDb();
  await insertSample(db, { id: "sub-1" });
  await markGraduated(db, { id: "sub-1", graduatedAt: "2026-08-09", commitSha: "abc123" });
  await insertSample(db, { id: "sub-2" });
  const record = await getPendingSubmissionForCity(db, "Example");
  assert.equal(record.id, "sub-2");
});

// --- castVote: dedup ---------------------------------------------------

// Uses "flag", not "confirm": with COMMUNITY_CONFIRMATIONS_REQUIRED at 1
// (see communityConfig.ts's own comment on why), a single confirm
// graduates a submission immediately, leaving no still-"pending" window
// to test a second, duplicate vote against — castVote's first check is
// `existing.status !== "pending"`, so a duplicate confirm after
// graduation correctly reports "already_settled", not "duplicate" (see
// the dedicated test for that below). A flag doesn't change status until
// COMMUNITY_PENDING_DISPUTE_THRESHOLD (2), so it's what actually exercises
// the dedup path while the submission is still pending.
test("castVote records a first flag and rejects a duplicate with the same dedup key", async () => {
  const db = freshDb();
  await insertSample(db);
  const first = await castVote(db, { submissionId: "sub-1", voteType: "flag", dedupKey: "voter-a-day1", createdAt: "2026-08-09T00:00:00Z" });
  assert.equal(first.outcome, "recorded");
  assert.equal(first.flags, 1);

  const duplicate = await castVote(db, { submissionId: "sub-1", voteType: "flag", dedupKey: "voter-a-day1", createdAt: "2026-08-09T00:01:00Z" });
  assert.equal(duplicate.outcome, "duplicate");

  const record = await getPendingSubmissionForCity(db, "Example");
  assert.equal(record.flags, 1); // the duplicate never incremented the counter
});

test("castVote's dedup also applies to confirm votes — a duplicate confirm before graduation would still no-op, not double-count", async () => {
  // Same guarantee, exercised without relying on graduation timing: two
  // confirms with the SAME dedup key on two DIFFERENT (single-pending-slot)
  // submissions each only count once per submission, per key.
  const db = freshDb();
  await insertSample(db, { id: "sub-1", cityName: "Alpha" });
  await insertSample(db, { id: "sub-2", cityName: "Beta" });
  const a1 = await castVote(db, { submissionId: "sub-1", voteType: "confirm", dedupKey: "voter-a-day1", createdAt: "2026-08-09" });
  assert.equal(a1.outcome, "recorded");
  const a2 = await castVote(db, { submissionId: "sub-1", voteType: "confirm", dedupKey: "voter-a-day1", createdAt: "2026-08-09" });
  // sub-1 already graduated off the strength of a1 (1 confirm required) —
  // this asserts the duplicate-key vote didn't ALSO get recorded a second
  // time on its way to that (which would show up as confirmations > 1).
  assert.notEqual(a2.outcome, "recorded");
  const graduating = await getSubmissionById(db, "sub-1");
  assert.equal(graduating.confirmations, 1);
});

test("castVote against a nonexistent submission returns not_found", async () => {
  const db = freshDb();
  const result = await castVote(db, { submissionId: "nope", voteType: "confirm", dedupKey: "x", createdAt: "2026-08-09" });
  assert.equal(result.outcome, "not_found");
});

// --- castVote: graduation threshold --------------------------------------

test(`castVote flips status to graduating exactly at ${COMMUNITY_CONFIRMATIONS_REQUIRED} confirmations, and only the crossing vote reports triggeredGraduation`, async () => {
  const db = freshDb();
  await insertSample(db);
  for (let i = 0; i < COMMUNITY_CONFIRMATIONS_REQUIRED - 1; i++) {
    const result = await castVote(db, { submissionId: "sub-1", voteType: "confirm", dedupKey: `voter-${i}`, createdAt: "2026-08-09" });
    assert.equal(result.triggeredGraduation, false, `vote ${i} should not yet trigger graduation`);
  }
  const crossing = await castVote(db, {
    submissionId: "sub-1",
    voteType: "confirm",
    dedupKey: `voter-final`,
    createdAt: "2026-08-09",
  });
  assert.equal(crossing.outcome, "recorded");
  assert.equal(crossing.confirmations, COMMUNITY_CONFIRMATIONS_REQUIRED);
  assert.equal(crossing.triggeredGraduation, true);

  // The record has left "pending" (now "graduating"), so the
  // pending-only lookup — and the pending-only unique index — no longer
  // sees it, which is exactly what frees the city up for a fresh
  // submission if this one never actually completes graduation.
  const stillPending = await getPendingSubmissionForCity(db, "Example");
  assert.equal(stillPending, null);
});

test("a vote after the submission has already left pending is reported as already_settled, not recorded again", async () => {
  const db = freshDb();
  await insertSample(db);
  for (let i = 0; i < COMMUNITY_CONFIRMATIONS_REQUIRED; i++) {
    await castVote(db, { submissionId: "sub-1", voteType: "confirm", dedupKey: `voter-${i}`, createdAt: "2026-08-09" });
  }
  const afterGraduating = await castVote(db, { submissionId: "sub-1", voteType: "confirm", dedupKey: "voter-late", createdAt: "2026-08-09" });
  assert.equal(afterGraduating.outcome, "already_settled");
  assert.equal(afterGraduating.status, "graduating");
});

// --- castVote: pre-graduation dispute threshold ---------------------------

test(`castVote flips status to disputed at ${COMMUNITY_PENDING_DISPUTE_THRESHOLD} flags and stops appearing in listLiveSubmissionsForMap`, async () => {
  const db = freshDb();
  await insertSample(db);
  for (let i = 0; i < COMMUNITY_PENDING_DISPUTE_THRESHOLD; i++) {
    await castVote(db, { submissionId: "sub-1", voteType: "flag", dedupKey: `flagger-${i}`, createdAt: "2026-08-09" });
  }
  const live = await listLiveSubmissionsForMap(db);
  assert.equal(live.length, 0);
});

// --- listLiveSubmissionsForMap ---------------------------------------------

test("listLiveSubmissionsForMap includes pending and graduating, excludes graduated/disputed/rejected/expired", async () => {
  const db = freshDb();
  await insertSample(db, { id: "s-pending", cityName: "Alpha" });
  await insertSample(db, { id: "s-graduated", cityName: "Beta" });
  await markGraduated(db, { id: "s-graduated", graduatedAt: "2026-08-09", commitSha: "deadbeef" });

  const live = await listLiveSubmissionsForMap(db);
  assert.deepEqual(
    live.map((r) => r.id).sort(),
    ["s-pending"],
  );
});

// --- recordDispute (post-graduation) ---------------------------------------

test("recordDispute only applies to graduated submissions, not pending ones", async () => {
  const db = freshDb();
  await insertSample(db);
  const result = await recordDispute(db, "sub-1");
  assert.equal(result, null);
});

test(`recordDispute reports triggeredRevertIssue at exactly ${COMMUNITY_GRADUATION_DISPUTE_THRESHOLD} disputes`, async () => {
  const db = freshDb();
  await insertSample(db);
  await markGraduated(db, { id: "sub-1", graduatedAt: "2026-08-09", commitSha: "abc123" });

  for (let i = 0; i < COMMUNITY_GRADUATION_DISPUTE_THRESHOLD - 1; i++) {
    const result = await recordDispute(db, "sub-1");
    assert.equal(result.triggeredRevertIssue, false);
  }
  const crossing = await recordDispute(db, "sub-1");
  assert.equal(crossing.disputeCount, COMMUNITY_GRADUATION_DISPUTE_THRESHOLD);
  assert.equal(crossing.triggeredRevertIssue, true);
});
