// src/lib/communityConfig.ts
//
// Thresholds and the Confidence Enum extension for the Community
// Contribution Pipeline (AGENTS.md §2.6). Same "encode it in config,
// don't remember it" convention as src/lib/electionConfig.ts — every
// number a route/script/component needs to reason about this feature's
// vote/expiry/dedup behavior lives here once, not scattered as magic
// literals across the API routes, the graduation script, and the UI.

/**
 * AGENTS.md §3.3's Confidence Enum, extended with the one new tier §2.6
 * introduces. `community_verified` is deliberately NOT folded into
 * `corroborated` — that tier means two independent lower-tier *sources*
 * (documents) agree; this one means three anonymous, Turnstile-gated
 * *votes* agreed an extraction matches its cited source. Different
 * epistemic category, kept as its own value so `corroborated` doesn't get
 * diluted for every other citation in the app that legitimately earns it.
 */
export type ConfidenceTier = "confirmed" | "corroborated" | "reported" | "lead" | "community_verified";

/**
 * Confirmations required before a pending submission graduates. Lowered
 * from an original design of 3 to 1, deliberately: the maintainer's own
 * framing is that one person acting is enough, and that a single
 * confirmation should be trustworthy IF the automated checks that precede
 * it (SSRF-safe fetch, domainSafety.ts's malware/phishing blocklist check
 * and .gov/.mn.us signal, communityExtraction.ts's four-layer role/quote/
 * denylist gate) are doing real work rather than being a formality the
 * crowd was there to paper over.
 *
 * Be honest about what this trades away, not just what it gains: three
 * independent human confirmations were themselves a real signal —
 * multiple people agreeing a page matches a city is evidence a machine
 * check can't fully replace. One confirmation removes that redundancy.
 * What offsets it is that a submission now has to survive MORE automated
 * scrutiny before a human ever votes on it (a category of protection the
 * 3-confirmation design didn't have at all — it leaned on the crowd to
 * catch what automation couldn't). This is a different risk allocation,
 * not a strictly safer one — see AGENTS.md §2.6's named risk acceptance,
 * updated for this number.
 *
 * A structural consequence worth knowing, not just this number in
 * isolation: at 1, the FIRST vote cast on a submission graduates it
 * immediately if that vote is a confirm — there's no multi-voter window
 * left for COMMUNITY_PENDING_DISPUTE_THRESHOLD below to matter unless the
 * first vote happens to be a flag instead. The real backstop is now
 * almost entirely COMMUNITY_GRADUATION_DISPUTE_THRESHOLD (post-graduation),
 * not this pre-graduation one — see that constant's own comment.
 */
export const COMMUNITY_CONFIRMATIONS_REQUIRED = 1;

/**
 * Post-graduation flags on `POST /api/submissions/:id/dispute` before the
 * Worker opens a GitHub issue with a pre-built revert PR attached.
 * Deliberately NOT the same mechanism as pre-graduation flagging (below) —
 * see AGENTS.md §2.6's "named risk acceptance": an automatic revert at
 * this bar would recreate the same Sybil risk one level later, letting two
 * bad-faith flaggers suppress an already-shipped, correct record. This
 * threshold only ever opens an issue for a human to act on; nothing
 * auto-merges past this point. With COMMUNITY_CONFIRMATIONS_REQUIRED at 1
 * (see its own comment), this is now the load-bearing backstop, not a
 * secondary one — a bad graduation is far more likely to be caught here,
 * after the fact, than at the pre-graduation stage below.
 */
export const COMMUNITY_GRADUATION_DISPUTE_THRESHOLD = 2;

/**
 * Pre-graduation flags before a still-`pending` submission is pulled from
 * `/api/community-submissions` and marked `disputed`. Left at 2, not
 * dropped to match COMMUNITY_CONFIRMATIONS_REQUIRED's 1 — flags and
 * confirms aren't symmetric even now: a false confirm ships a record, a
 * false flag only delays a real submission a resubmission-cycle's worth
 * (cheap, reversible), so keeping a slightly higher bar to disputing here
 * is still the right asymmetry. In practice, though, this rarely fires
 * before graduation at all now — see COMMUNITY_CONFIRMATIONS_REQUIRED's
 * comment on why the first vote usually decides the outcome outright.
 */
export const COMMUNITY_PENDING_DISPUTE_THRESHOLD = 2;

/**
 * A `pending` submission that never reaches
 * COMMUNITY_CONFIRMATIONS_REQUIRED within this many days is abandoned and
 * purged by the weekly cron, freeing the one-pending-submission-per-city
 * slot (see migrations/0001_community_submissions.sql's
 * idx_one_pending_per_city) so the city can be resubmitted.
 */
export const COMMUNITY_SUBMISSION_EXPIRY_DAYS = 60;

/**
 * One confirm/flag vote per hashed-IP per submission per this many days —
 * the dedup window `voteDedup.ts`'s `dedup_key` is bucketed against. Short
 * on purpose: it's a friction layer against casual repeat-clicking, not a
 * claim of durable identity (AGENTS.md §2.6 is explicit that Turnstile +
 * this hash is not identity verification).
 */
export const COMMUNITY_VOTE_DEDUP_WINDOW_DAYS = 1;

/**
 * Submission-creation rate limit per hashed-IP per day
 * (`POST /api/submissions`) — keeps the SSRF-mitigated fetch in
 * serverFetch.ts from being usable as a cheap URL-probing service, per
 * AGENTS.md §2.6's SSRF-safety discussion.
 */
export const COMMUNITY_SUBMISSION_RATE_LIMIT_PER_DAY = 5;

/**
 * SSRF/abuse caps for the single server-side fetch of a submitted URL
 * (src/lib/serverFetch.ts). Kept here, not hardcoded in serverFetch.ts
 * itself, so a future tuning pass (AGENTS.md §2.6 phase 2: "tune SSRF/size/
 * extraction-prompt against real Phase 1 volume") touches one file.
 */
export const COMMUNITY_FETCH_MAX_BYTES = 2 * 1024 * 1024; // ~2 MB
export const COMMUNITY_FETCH_TIMEOUT_MS = 10_000;
export const COMMUNITY_FETCH_MAX_REDIRECTS = 3;
