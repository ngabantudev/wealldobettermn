-- migrations/0002_submission_rate_limit.sql
--
-- A dedicated, append-only log for POST /api/submissions rate limiting
-- (AGENTS.md §2.6's SSRF-safety discussion: "Submission creation is
-- itself rate-limited... so this can't become a cheap URL-probing
-- service"). Deliberately separate from `submissions` (0001): this table
-- logs one row per ATTEMPT, regardless of outcome (accepted, rejected for
-- an already-covered city, failed extraction, whatever) — a rate limit
-- keyed off only successful submissions would let someone bypass it for
-- free by making the request fail in some other way first.
--
-- `ip_hash` is a salted, one-way hash — see src/lib/voteDedup.ts's
-- hashIp(). No day-bucketing here unlike votes.dedup_key: rate limiting
-- wants a genuine rolling window (COUNT(*) WHERE created_at > now-24h),
-- not a fixed calendar-day bucket, so the hash itself doesn't need to
-- change value from one query to the next the way a vote dedup key does.

CREATE TABLE submission_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_submission_attempts_ip_hash_created ON submission_attempts(ip_hash, created_at);
