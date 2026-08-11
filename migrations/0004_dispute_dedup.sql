-- migrations/0004_dispute_dedup.sql
--
-- A dedicated dedup table for POST /api/submissions/:id/dispute — found
-- missing during live testing of the vote/dispute routes (piece 1 of the
-- vote/graduation build): recordDispute() had no per-voter dedup at all,
-- unlike castVote()'s votes.dedup_key. Without this, one person calling
-- the endpoint twice could single-handedly reach
-- COMMUNITY_GRADUATION_DISPUTE_THRESHOLD and trigger a revert dispatch —
-- the exact single-actor risk the confirm-side self-confirmation check
-- (migrations/0003) exists to close, just on the dispute side instead.
--
-- A separate table rather than reusing `votes` (0001): votes.vote_type
-- has a CHECK constraint limited to ('confirm', 'flag'), and SQLite can't
-- widen a CHECK constraint without recreating the table — a new,
-- purpose-built table is simpler and safer than that dance, and matches
-- 0002's own precedent (submission_attempts is its own dedicated table
-- too, not shoehorned into an existing one).
--
-- Same salted, day-bucketed dedup_key shape as votes.dedup_key (see
-- src/lib/voteDedup.ts's computeDedupKey) — a friction layer, not
-- identity verification, exactly as disclosed for votes.

CREATE TABLE submission_disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  dedup_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(submission_id, dedup_key)
);

CREATE INDEX idx_submission_disputes_submission ON submission_disputes(submission_id);
