-- migrations/0001_community_submissions.sql
--
-- D1 schema for the Community Contribution Pipeline (AGENTS.md §2.6). This
-- is the app's first Cloudflare data binding — see wrangler.jsonc's
-- `d1_databases` entry. Applied via:
--   npx wrangler d1 migrations apply wealldobettermn-community --local
--   npx wrangler d1 migrations apply wealldobettermn-community --remote
--
-- Two tables only. `submissions` is one row per city-officials submission,
-- always in an "add a brand-new city" shape (never a diff against an
-- existing roster — see AGENTS.md §2.6's structural non-goals). `votes` is
-- one row per confirm/flag, deduplicated by a salted-IP-hash + day-bucket
-- key so a race between two simultaneous 3rd-confirm requests can only
-- ever flip a submission's status once (see the UNIQUE constraint below
-- and src/lib/communitySubmissions.ts's use of it).

CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  city_name TEXT NOT NULL,
  gnis_id INTEGER,                  -- from public/city-anchor-points.json; nullable only if that lookup ever fails after the plausibility gate already passed
  source_url TEXT NOT NULL,
  -- pending: extracted, live on the map with a "pending" badge, collecting confirmations.
  -- graduating: the atomic status flip that "won" the 3rd-confirm race has fired; the
  --   GitHub repository_dispatch is in flight but hasn't reported back yet.
  -- graduated: committed to public/mayors.geojson on main; graduation_commit_sha is set.
  -- disputed: pulled from /api/community-submissions after COMMUNITY_PENDING_DISPUTE_THRESHOLD
  --   pre-graduation flags (see src/lib/communityConfig.ts) — never resurfaces automatically.
  -- rejected: failed the plausibility/extraction gate at submission time; kept for audit only.
  -- expired: abandoned (never reached 3 confirmations within COMMUNITY_SUBMISSION_EXPIRY_DAYS),
  --   purged by the weekly cron, which frees the idx_one_pending_per_city slot below.
  status TEXT NOT NULL CHECK (status IN ('pending', 'graduating', 'graduated', 'disputed', 'rejected', 'expired')),
  extracted_json TEXT NOT NULL,     -- validated officeholder records (RepProperties-shaped subset) — see src/lib/communityExtraction.ts
  rejected_mentions_json TEXT,      -- audit only: names/roles the extraction gate dropped (denylist hit, unverifiable quote, etc.) — never served to any client, never joined into extracted_json
  confirmations INTEGER NOT NULL DEFAULT 0,
  flags INTEGER NOT NULL DEFAULT 0,
  dispute_count INTEGER NOT NULL DEFAULT 0,  -- post-graduation disputes only (POST /api/submissions/:id/dispute) — distinct counter from pre-graduation `flags`, per AGENTS.md §2.6's deliberately-asymmetric dispute design
  submitted_at TEXT NOT NULL,
  graduated_at TEXT,
  graduation_commit_sha TEXT
);

-- One live pending submission per city at a time — prevents vote-splitting
-- across two competing submissions for the same city, and gives
-- POST /api/submissions a cheap existence check before doing any fetch/
-- extraction work. A city returns to eligibility once its one pending row
-- moves to any other status (graduated, disputed, rejected, expired).
CREATE UNIQUE INDEX idx_one_pending_per_city ON submissions(city_name) WHERE status = 'pending';

CREATE TABLE votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  vote_type TEXT NOT NULL CHECK (vote_type IN ('confirm', 'flag')),
  dedup_key TEXT NOT NULL,          -- sha256(perDeploySalt + hashedIp + submissionId + dayBucket) — see src/lib/voteDedup.ts. Never derivable back to a raw IP from this column alone.
  created_at TEXT NOT NULL,
  UNIQUE(submission_id, dedup_key)
);

-- Read path for "does this submission's vote count need recomputing" and
-- for the weekly purge cron's dedup-row cleanup (rows older than
-- COMMUNITY_VOTE_DEDUP_WINDOW_DAYS whose parent submission is no longer
-- pending/graduating).
CREATE INDEX idx_votes_submission ON votes(submission_id);
