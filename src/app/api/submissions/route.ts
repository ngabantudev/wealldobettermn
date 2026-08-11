// src/app/api/submissions/route.ts
//
// POST /api/submissions — the Community Contribution Pipeline's entry
// point (AGENTS.md §2.6). This app's first dynamic route ever, per that
// section's own §2.1 exception. Orchestrates, in order:
//   1. rate limiting (per hashed-IP, migrations/0002)
//   2. Turnstile verification (bot-check, not identity)
//   3. city recognition (cityMatch.ts) — real MN city? already covered?
//   4. duplicate-pending check (one live submission per city)
//   5. hostname shape checks (bare IP / blocked hostname, cheap and
//      local) THEN domain safety (domainSafety.ts — malware blocklist +
//      .gov/.mn.us signal) — shape checks run first so a bare IP or
//      *.internal host gets its own specific reason instead of being
//      misdiagnosed by the blocklist check
//   6. SSRF-safe fetch of the submitted URL (serverFetch.ts), followed
//      by a second domain-safety check against wherever it actually
//      landed (fetchResult.finalUrl) if that differs from step 5's
//      hostname — a redirect target never got the blocklist check otherwise
//   7. extraction behind the five-layer structural gate (communityExtraction.ts)
//   8. insert the resulting `pending` row (communitySubmissions.ts)
//
// Every rejection returns a typed `reason` and a plain-language `message`
// meant to be shown directly to the visitor — AGENTS.md §3.3 "never
// fabricate or infer": a submission that fails anywhere in this chain
// gets an honest explanation, never a guess, and never a partial insert.
//
// `env` typing: this repo has no `@cloudflare/workers-types` dependency
// and no generated cloudflare-env.d.ts (gitignored, requires a live
// `wrangler login`) — same reasoning as communitySubmissions.ts's
// hand-rolled D1DatabaseLike and communityExtraction.ts's
// CommunityAiBinding. RouteEnv below is a narrow, local cast rather than
// pulling in that dependency for two field names.

import { randomUUID } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse, type NextRequest } from "next/server";
import {
  COMMUNITY_SUBMISSION_RATE_LIMIT_PER_DAY,
  COMMUNITY_CONFIRMATIONS_REQUIRED,
} from "@/lib/communityConfig";
import { matchCity } from "@/lib/cityMatch";
import { checkDomainSafety } from "@/lib/domainSafety";
import { isBlockedHostname, looksLikeBareIp, serverFetch } from "@/lib/serverFetch";
import { extractOfficials, type CommunityAiBinding } from "@/lib/communityExtraction";
import {
  countRecentSubmissionAttempts,
  DuplicateSubmissionError,
  getPendingSubmissionForCity,
  insertSubmission,
  recordSubmissionAttempt,
  type D1DatabaseLike,
} from "@/lib/communitySubmissions";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { hashIp } from "@/lib/voteDedup";

interface RouteEnv {
  DB: D1DatabaseLike;
  AI: CommunityAiBinding;
  TURNSTILE_SECRET_KEY?: string;
  COMMUNITY_HASH_SALT?: string;
}

type RejectReason =
  | "invalid_request"
  | "rate_limited"
  | "turnstile_failed"
  | "city_not_recognized"
  | "city_already_covered"
  | "duplicate_pending"
  | "domain_flagged_malicious"
  | "invalid_url"
  | "unsupported_scheme"
  | "bare_ip_hostname"
  | "blocked_hostname"
  | "private_ip_target"
  | "too_many_redirects"
  | "response_too_large"
  | "timeout"
  | "unreachable"
  | "no_city_name_evidence"
  | "no_officials_survived"
  | "model_output_unparseable"
  | "model_error"
  // Server-side failures, never the visitor's fault — distinct from
  // every reason above, which describes something about their
  // submission. Caught in code review: both of these used to be
  // silently mislabeled as visitor-facing rejections (an unset secret
  // proceeding as if configured; any D1 failure reported as
  // "duplicate_pending" regardless of its real cause).
  | "server_misconfigured"
  | "internal_error";

function rejected(reason: RejectReason, message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ status: "rejected", reason, message, ...extra }, { status });
}

/**
 * The one rejection reachable from two places — the pre-fetch check
 * (step 4) and insertSubmission's idx_one_pending_per_city race-catch
 * (step 8) — kept as one builder so the wording can't drift between them.
 */
function duplicatePending(cityName: string, submissionId?: string) {
  return rejected(
    "duplicate_pending",
    `${cityName} already has a pending submission awaiting confirmation.`,
    409,
    submissionId ? { submissionId } : undefined,
  );
}

/**
 * Runs checkDomainSafety and builds the (identically-shaped, differently-
 * worded) rejection if it comes back flagged — called once for the
 * originally-submitted hostname and once for the post-redirect
 * fetchResult.finalUrl hostname (step 6's own comment explains why both
 * need checking). Returns the raw domainSafety result too: the first
 * call's result is what the success response ultimately reports back to
 * the visitor, so the caller still needs it even when nothing's flagged.
 */
async function checkDomainSafetyOrReject(hostname: string, cityName: string, flaggedMessage: string) {
  const domainSafety = await checkDomainSafety(hostname, cityName);
  const rejection = domainSafety.isFlaggedMalicious ? rejected("domain_flagged_malicious", flaggedMessage, 400) : null;
  return { domainSafety, rejection };
}

function getClientIp(request: NextRequest): string {
  // Cloudflare's own header, set at the edge — trustworthy inside a
  // Worker (unlike x-forwarded-for, which a client could forge). No
  // fallback to that forgeable header: this value gates both the
  // submission rate limit and vote dedup, so falling back to something
  // an attacker controls would let them bypass both by simply omitting
  // cf-connecting-ip and supplying their own x-forwarded-for instead.
  // "unknown" still hashes to a real (if shared-bucket) value, never a
  // crash, if this header is ever genuinely absent.
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rejected("invalid_request", "That request wasn't valid JSON.", 400);
  }
  const { cityName, sourceUrl, turnstileToken } = (body ?? {}) as Record<string, unknown>;
  if (typeof cityName !== "string" || !cityName.trim() || typeof sourceUrl !== "string" || !sourceUrl.trim()) {
    return rejected("invalid_request", "A city name and a URL are both required.", 400);
  }
  if (typeof turnstileToken !== "string" || !turnstileToken.trim()) {
    return rejected("invalid_request", "The bot-check didn't complete — please try again.", 400);
  }

  const { env } = await getCloudflareContext({ async: true });
  const typedEnv = env as unknown as RouteEnv;
  const db = typedEnv.DB;
  const ip = getClientIp(request);

  // Fail loudly, not silently: hashIp's entire security property (see
  // its own header) depends on this being a real per-deployment secret.
  // `?? ""` used to let a missing `wrangler secret put
  // COMMUNITY_HASH_SALT` silently degrade every rate-limit hash in this
  // deployment to sha256(":" + ip) — a plain, un-keyed, rainbow-table-
  // reversible hash of the visitor's real IP, defeating the "never
  // reconstructs the original IP" guarantee with no error anywhere.
  // Caught in code review.
  if (!typedEnv.COMMUNITY_HASH_SALT) {
    console.error("[api/submissions] COMMUNITY_HASH_SALT is not configured — refusing to hash IPs unsalted.");
    return rejected("server_misconfigured", "This feature isn't configured correctly right now — please try again later.", 500);
  }
  const salt = typedEnv.COMMUNITY_HASH_SALT;

  // 1. Rate limit — checked before doing any real work, so a limited
  // visitor's request is cheap to reject.
  const ipHash = await hashIp(salt, ip);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentAttempts = await countRecentSubmissionAttempts(db, ipHash, oneDayAgo);
  if (recentAttempts >= COMMUNITY_SUBMISSION_RATE_LIMIT_PER_DAY) {
    return rejected("rate_limited", "You've submitted a few of these already today — please try again tomorrow.", 429);
  }
  await recordSubmissionAttempt(db, ipHash, new Date().toISOString());

  // 2. Turnstile — a friction layer against casual bot abuse, not identity
  // verification (AGENTS.md §2.6).
  const turnstileOk = await verifyTurnstileToken(turnstileToken, { secretKey: typedEnv.TURNSTILE_SECRET_KEY ?? "" }, ip);
  if (!turnstileOk) {
    return rejected("turnstile_failed", "The bot-check didn't pass — please try again.", 400);
  }

  // 3. City recognition — real MN city we have an anchor point for, and
  // not already one this app has officials data for (§2.6 "Scope": brand-
  // new cities only; corrections to an existing roster are out of scope).
  const cityMatchResult = matchCity(cityName);
  if (!cityMatchResult.recognized) {
    return rejected("city_not_recognized", `"${cityName}" doesn't match a Minnesota city this map recognizes.`, 400);
  }
  if (cityMatchResult.alreadyCovered) {
    return rejected(
      "city_already_covered",
      `${cityMatchResult.canonicalName} already has officials data on this site. This pipeline is for brand-new cities only — see /privacy for how to report a correction instead.`,
      400,
    );
  }
  const canonicalCityName = cityMatchResult.canonicalName as string;

  // 4. Duplicate-pending check — a fast, friendly rejection before the
  // fetch/extraction work; idx_one_pending_per_city is the real guarantee
  // underneath this (see insertSubmission's own comment), so a race here
  // still can't produce two live submissions for the same city.
  const existingPending = await getPendingSubmissionForCity(db, canonicalCityName);
  if (existingPending) {
    return duplicatePending(canonicalCityName, existingPending.id);
  }

  // 5. Domain safety — a known-bad-domain blocklist check and a .gov/
  // .mn.us structural signal (domainSafety.ts). Neither proves
  // legitimacy; the blocklist hit is what actually disqualifies. Shape
  // checks (bare IP, blocked hostname) run FIRST and are cheap/local —
  // checking them before spending a network round trip on the blocklist
  // also avoids a real bug caught in code review: a bare-IP or
  // *.internal/*.local hostname would previously reach
  // checkDomainSafety first, get an inconclusive/NXDOMAIN-shaped
  // response from the security resolver, and come back mislabeled
  // "domain_flagged_malicious" ("known malware/phishing list") instead
  // of the correct, more specific bare_ip_hostname/blocked_hostname
  // reason serverFetch.ts already has a dedicated message for.
  let hostname: string;
  try {
    hostname = new URL(sourceUrl).hostname;
  } catch {
    return rejected("invalid_url", "That doesn't look like a valid URL.", 400);
  }
  if (looksLikeBareIp(hostname)) {
    return rejected("bare_ip_hostname", "A city's official site should be a domain name, not a bare IP address.", 400);
  }
  if (isBlockedHostname(hostname)) {
    return rejected("blocked_hostname", "That hostname isn't a publicly reachable government site.", 400);
  }
  const { domainSafety, rejection: maliciousRejection } = await checkDomainSafetyOrReject(
    hostname,
    canonicalCityName,
    "That site is on a known malware/phishing list and can't be accepted.",
  );
  if (maliciousRejection) return maliciousRejection;

  // 6. SSRF-safe fetch — see serverFetch.ts's own header for exactly what
  // this does and doesn't guarantee on this platform.
  const fetchResult = await serverFetch(sourceUrl);
  if (!fetchResult.ok) {
    return rejected(fetchResult.reason as RejectReason, fetchResult.message, 400);
  }

  // Domain safety only checked the ORIGINALLY submitted hostname above —
  // serverFetch can follow up to COMMUNITY_FETCH_MAX_REDIRECTS redirects
  // to a DIFFERENT hostname, and the content actually about to be fed to
  // the extraction model came from wherever it finally landed
  // (fetchResult.finalUrl), not necessarily the submitted URL. Re-check
  // that final hostname too — a clean, non-flagged URL that redirects to
  // a domain on the malware/phishing blocklist would otherwise sail
  // through the one blocklist check this pipeline has. Caught in code
  // review.
  const finalHostname = new URL(fetchResult.finalUrl).hostname;
  if (finalHostname !== hostname) {
    const { rejection: finalMaliciousRejection } = await checkDomainSafetyOrReject(
      finalHostname,
      canonicalCityName,
      "That site redirected to a page on a known malware/phishing list and can't be accepted.",
    );
    if (finalMaliciousRejection) return finalMaliciousRejection;
  }

  // 7. Extraction behind the five-layer structural gate — see
  // communityExtraction.ts's own header for what each layer catches.
  // extraction.rejectedMentions is NEVER included in the response below
  // (success or failure) — migrations/0001's own schema comment says so
  // explicitly ("audit only... never served to any client"), and AGENTS.md
  // §1b requires recording the office, never the person, for non-
  // supervisory staff. A denylisted mention is exactly a name the
  // extraction gate caught matching a "clerk"/"administrator"/"staff"
  // keyword near a role claim — serving it back to whoever submitted the
  // URL would leak that person's name in the one place this pipeline is
  // supposed to suppress it entirely. Caught in code review.
  const extraction = await extractOfficials({ ai: typedEnv.AI, pageHtml: fetchResult.text, cityName: canonicalCityName });
  if (!extraction.ok) {
    return rejected(extraction.reason as RejectReason, extraction.message, 400);
  }

  // 8. Insert the pending row. idx_one_pending_per_city is the last line
  // of defense against a race with step 4 above, and the ONLY realistic
  // way insertSubmission throws — but a bare `catch { return
  // duplicatePending(...) }` used to assume that for every possible
  // failure, including a transient D1 outage or a future schema
  // mismatch, telling the visitor a factually false "this city already
  // has a pending submission" instead of a genuine server error, with no
  // log anywhere to diagnose it (unlike the ai.run() catch a few lines
  // up in communityExtraction.ts, which does log). Caught in code
  // review: only treat it as the race this comment describes when
  // insertSubmission itself recognized the unique-constraint violation
  // it names (DuplicateSubmissionError, thrown right next to the SQL
  // that defines the constraint — see that module's own comment on why
  // it, not this route, is the right place to recognize it); log and
  // report anything else honestly as a server error.
  const submissionId = randomUUID();
  try {
    await insertSubmission(db, {
      id: submissionId,
      cityName: canonicalCityName,
      gnisId: cityMatchResult.gnisId,
      sourceUrl,
      officials: extraction.officials,
      submittedAt: new Date().toISOString(),
      // Reused from step 1's rate-limit check, not recomputed — see
      // CastVoteParams.voterIpHash's own comment for what this eventually
      // gets compared against (POST /api/submissions/:id/vote's
      // self-confirmation block).
      submitterIpHash: ipHash,
    });
  } catch (err) {
    if (err instanceof DuplicateSubmissionError) {
      return duplicatePending(canonicalCityName);
    }
    console.error("[api/submissions] insertSubmission failed:", err);
    return rejected("internal_error", "Something went wrong on our end — please try again shortly.", 500);
  }

  return NextResponse.json({
    status: "pending",
    submissionId,
    cityMatched: canonicalCityName,
    extracted: { officials: extraction.officials },
    confirmationsNeeded: COMMUNITY_CONFIRMATIONS_REQUIRED,
    domainSafety,
  });
}
